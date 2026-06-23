import { InvoiceStatus, InvoiceType, Prisma, VoucherType } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { calculateCustomerBalance } from "../utils/financial";
import { logger } from "../utils/logger";
import { normalizePhone } from "../utils/phone";
import { getSettings } from "./settings.service";
import { sendWhatsAppImage, sendWhatsAppText } from "./whatsapp.service";

type Db = Prisma.TransactionClient | typeof prisma;
type DecimalLike = Prisma.Decimal | number | string | null | undefined;

export interface ListCustomersQuery {
  search?: string;
  hasDebt?: boolean;
  branchId?: string;
  isSupplier?: boolean;
  tags?: string[];
  /** When true, includes soft-deleted customers (used by account lookup) */
  includeDeleted?: boolean;
  page: number;
  limit: number;
}

export interface CreateCustomerInput {
  name: string;
  phone: string;
  address?: string;
  notes?: string;
  tags?: string[];
  openingBalance: number;
  creditLimit?: number | null;
  branchId?: string;
  isSupplier?: boolean;
  isBoth?: boolean;
}

export interface UpdateCustomerInput {
  name?: string;
  phone?: string;
  address?: string | null;
  notes?: string | null;
  tags?: string[];
  openingBalance?: number;
  creditLimit?: number | null;
  branchId?: string | null;
  isSupplier?: boolean;
  isBoth?: boolean;
}

export interface TransactionFilter {
  from?: string;
  to?: string;
  all?: boolean;
}

function toNumber(value: DecimalLike) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function serializeCustomer<T extends { openingBalance: DecimalLike; currentBalance: DecimalLike }>(
  customer: T
) {
  return {
    ...customer,
    openingBalance: toNumber(customer.openingBalance),
    currentBalance: toNumber(customer.currentBalance),
  };
}

function buildTransactionDateFilter(filter: TransactionFilter) {
  if (filter.all) return undefined;

  const dateFilter: Prisma.DateTimeFilter = {};

  if (filter.from) {
    dateFilter.gte = new Date(filter.from);
  }

  if (filter.to) {
    const toDate = new Date(filter.to);
    toDate.setHours(23, 59, 59, 999);
    dateFilter.lte = toDate;
  }

  return Object.keys(dateFilter).length > 0 ? dateFilter : undefined;
}

function buildTransactionUpperDateFilter(filter: TransactionFilter) {
  if (filter.all || !filter.to) return undefined;

  const toDate = new Date(filter.to);
  toDate.setHours(23, 59, 59, 999);

  return { lte: toDate } satisfies Prisma.DateTimeFilter;
}

function startDateForFilter(filter: TransactionFilter) {
  if (filter.all || !filter.from) return null;
  return new Date(filter.from);
}

async function getCustomerOrThrow(id: string, db: Db = prisma) {
  const customer = await db.customer.findFirst({
    where: { id, deletedAt: null },
  });

  if (!customer) {
    throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  }

  return customer;
}

/** Fetch a customer by ID regardless of deletedAt â€” used for account lookup */
export async function getCustomerByIdAny(id: string) {
  const customer = await prisma.customer.findFirst({ where: { id } });
  if (!customer) {
    throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  }
  return serializeCustomer(customer);
}

export async function recalculateCustomerBalance(customerId: string, db: Db = prisma) {
  const customer = await getCustomerOrThrow(customerId, db);

  const [saleTotals, creditInvoiceTotals, receiptTotals, paymentTotals, lastInvoice, lastVoucher] =
    await Promise.all([
      db.invoice.aggregate({
        where: {
          customerId,
          status: InvoiceStatus.ACTIVE,
          type: InvoiceType.SALE,
        },
        _sum: { remainingAmount: true },
      }),
      db.invoice.aggregate({
        where: {
          customerId,
          status: InvoiceStatus.ACTIVE,
          type: { in: [InvoiceType.PURCHASE, InvoiceType.SALES_RETURN] },
        },
        _sum: { remainingAmount: true },
      }),
      db.paymentVoucher.aggregate({
        where: {
          customerId,
          type: VoucherType.RECEIPT,
          archivedAt: null,
          cancelledAt: null,
        },
        _sum: { amount: true },
      }),
      db.paymentVoucher.aggregate({
        where: {
          customerId,
          type: VoucherType.PAYMENT,
          archivedAt: null,
          cancelledAt: null,
        },
        _sum: { amount: true },
      }),
      db.invoice.findFirst({
        where: {
          customerId,
          status: InvoiceStatus.ACTIVE,
        },
        orderBy: { date: "desc" },
      }),
      db.paymentVoucher.findFirst({
        where: { customerId, archivedAt: null, cancelledAt: null },
        orderBy: { date: "desc" },
      }),
    ]);

  // Sign convention: +ve = customer owes us; -ve = we owe them (supplier).
  //   SALE remaining  â†’ +ve (customer owes us)
  //   PURCHASE remaining â†’ -ve (we owe supplier)
  //   RECEIPT â†’ -ve (reduces debt)
  //   PAYMENT â†’ +ve (we paid out, increases what they owe or reduces our credit)
  const currentBalance = calculateCustomerBalance({
    openingBalance: toNumber(customer.openingBalance),
    salesRemaining: toNumber(saleTotals._sum.remainingAmount),
    purchasesRemaining: toNumber(creditInvoiceTotals._sum.remainingAmount),
    receipts: toNumber(receiptTotals._sum.amount),
    payments: toNumber(paymentTotals._sum.amount),
  });

  const lastTransactionAt =
    lastInvoice && lastVoucher
      ? lastInvoice.date > lastVoucher.date
        ? lastInvoice.date
        : lastVoucher.date
      : lastInvoice?.date ?? lastVoucher?.date ?? null;

  const updatedCustomer = await db.customer.update({
    where: { id: customerId },
    data: {
      currentBalance,
      lastTransactionAt,
    },
  });

  return serializeCustomer(updatedCustomer);
}

export async function listCustomers(query: ListCustomersQuery) {
  const where: Prisma.CustomerWhereInput = {
    // includeDeleted=true â†’ show all (including archived); default â†’ active only
    ...(query.includeDeleted ? {} : { deletedAt: null }),
    ...(query.branchId ? { branchId: query.branchId } : {}),
    // isBoth customers appear in both customer list and supplier list
    ...(query.isSupplier !== undefined
      ? query.isSupplier
        ? { OR: [{ isSupplier: true }, { isBoth: true }] }
        : { isSupplier: false }
      : {}),
    // SQLite: Json arrays don't support hasSome; filter in-memory after fetch
  };

  if (query.search) {
    where.OR = [
      { name: { contains: query.search } },
      { phone: { contains: query.search } },
      { address: { contains: query.search } },
    ];
  }

  if (query.hasDebt !== undefined) {
    where.currentBalance = query.hasDebt ? { gt: 0 } : { lte: 0 };
  }

  const skip = (query.page - 1) * query.limit;

  // SQLite: tags filter is done in JS after fetch (no hasSome support)
  const tagFilter = query.tags && query.tags.length > 0 ? query.tags : null;

  if (tagFilter) {
    // Fetch all matching rows, filter by tags, then paginate manually
    const all = await prisma.customer.findMany({ where, orderBy: [{ name: "asc" }] });
    const filtered = all.filter((c) => {
      const tags = Array.isArray(c.tags) ? (c.tags as string[]) : [];
      return tagFilter.some((t) => tags.includes(t));
    });
    return {
      data: filtered.slice(skip, skip + query.limit).map(serializeCustomer),
      pagination: {
        total: filtered.length,
        page: query.page,
        limit: query.limit,
        pages: Math.ceil(filtered.length / query.limit),
      },
    };
  }

  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: [{ name: "asc" }],
      skip,
      take: query.limit,
    }),
  ]);

  return {
    data: customers.map(serializeCustomer),
    pagination: {
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.ceil(total / query.limit),
    },
  };
}

export async function getCustomerById(id: string) {
  const customer = await getCustomerOrThrow(id);
  return serializeCustomer(customer);
}

export async function createCustomer(input: CreateCustomerInput, db: Db = prisma) {
  const customer = await db.customer.create({
    data: {
      name: input.name,
      phone: normalizePhone(input.phone),
      address: input.address,
      notes: input.notes,
      tags: input.tags ?? [],
      openingBalance: input.openingBalance,
      currentBalance: input.openingBalance,
      creditLimit: input.creditLimit ?? null,
      branchId: input.branchId,
      isSupplier: input.isSupplier ?? false,
      isBoth: input.isBoth ?? false,
    },
  });

  return serializeCustomer(customer);
}

export async function updateCustomer(
  id: string,
  input: UpdateCustomerInput,
  db: Db = prisma
) {
  await getCustomerOrThrow(id, db);

  const data: Prisma.CustomerUncheckedUpdateInput = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.phone !== undefined) data.phone = normalizePhone(input.phone);
  if (input.address !== undefined) data.address = input.address;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.tags !== undefined) data.tags = input.tags;
  if (input.openingBalance !== undefined) data.openingBalance = input.openingBalance;
  if (input.creditLimit !== undefined) data.creditLimit = input.creditLimit;
  if (input.branchId !== undefined) data.branchId = input.branchId;
  if (input.isSupplier !== undefined) data.isSupplier = input.isSupplier;
  if (input.isBoth !== undefined) data.isBoth = input.isBoth;

  await db.customer.update({
    where: { id },
    data,
  });

  return recalculateCustomerBalance(id, db);
}

export async function softDeleteCustomer(id: string, db: Db = prisma) {
  await getCustomerOrThrow(id, db);

  const customer = await db.customer.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return serializeCustomer(customer);
}

export async function getCustomerTransactions(id: string, filter: TransactionFilter) {
  const customer = await getCustomerOrThrow(id);
  const upperDateFilter = buildTransactionUpperDateFilter(filter);
  const outputDateFilter = buildTransactionDateFilter(filter);
  const outputStartDate = startDateForFilter(filter);

  const [invoices, vouchers] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        customerId: id,
        archivedAt: null,
        ...(upperDateFilter ? { date: upperDateFilter } : {}),
      },
      include: {
        creator: {
          select: { id: true, name: true, username: true, role: true },
        },
      },
      orderBy: { date: "asc" },
    }),
    prisma.paymentVoucher.findMany({
      where: {
        customerId: id,
        archivedAt: null,
        ...(upperDateFilter ? { date: upperDateFilter } : {}),
      },
      include: {
        creator: {
          select: { id: true, name: true, username: true, role: true },
        },
      },
      orderBy: { date: "asc" },
    }),
  ]);

  const recordIds = [...invoices.map((invoice) => invoice.id), ...vouchers.map((voucher) => voucher.id)];
  const auditLogs = recordIds.length
    ? await prisma.auditLog.findMany({
        where: {
          recordId: { in: recordIds },
          entity: { in: ["invoices", "vouchers"] },
          action: { in: ["UPDATE", "DELETE", "REACTIVATE"] },
        },
        include: {
          user: { select: { id: true, name: true, username: true, role: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const latestAuditByRecord = new Map<string, (typeof auditLogs)[number]>();
  for (const log of auditLogs) {
    if (log.recordId && !latestAuditByRecord.has(log.recordId)) {
      latestAuditByRecord.set(log.recordId, log);
    }
  }

  const invoiceMovements = invoices.flatMap((invoice) => {
    const isSale = invoice.type === "SALE";
    const isReturn = invoice.type === "SALES_RETURN";
    const movements: Array<{
      date: Date;
      // SALE_INVOICE adds to balance (customer owes us more â†’ debit).
      // PURCHASE_INVOICE subtracts (we owe supplier â†’ credit).
      // SALE_PAYMENT / PURCHASE_PAYMENT are the upfront-paid portions on the invoice itself.
      type: "SALE_INVOICE" | "SALE_PAYMENT" | "PURCHASE_INVOICE" | "PURCHASE_PAYMENT" | "SALES_RETURN_INVOICE";
      amount: number;
      referenceNumber: string;
      recordId: string;
      sortKey: number;
      createdAt: Date;
      creator?: { id: string; name: string; username: string; role: string } | null;
      lastAudit?: (typeof auditLogs)[number];
      status?: InvoiceStatus;
    }> = [
      {
        date: invoice.date,
        type: isReturn ? "SALES_RETURN_INVOICE" : isSale ? "SALE_INVOICE" : "PURCHASE_INVOICE",
        amount: toNumber(invoice.totalAmount),
        referenceNumber: invoice.invoiceNumber,
        recordId: invoice.id,
        sortKey: invoice.createdAt.getTime(),
        createdAt: invoice.createdAt,
        creator: invoice.creator,
        lastAudit: latestAuditByRecord.get(invoice.id),
        status: invoice.status,
      },
    ];

    const paidAmount = toNumber(invoice.paidAmount);
    if (paidAmount > 0) {
      movements.push({
        date: invoice.date,
        type: isSale ? "SALE_PAYMENT" : "PURCHASE_PAYMENT",
        amount: paidAmount,
        referenceNumber: invoice.invoiceNumber,
        recordId: invoice.id,
        sortKey: invoice.createdAt.getTime() + 1,
        createdAt: invoice.createdAt,
        creator: invoice.creator,
        lastAudit: latestAuditByRecord.get(invoice.id),
        status: invoice.status,
      });
    }

    return movements;
  });

  // Shift by UTC+3 before flooring: old vouchers carry a real UTC timestamp
  // (e.g. 23:27 UTC = 02:27 AM Iraq next day) while invoices use midnight UTC
  // of the business date. Adding 3 h converts both to the correct Iraq calendar day.
  const UTC3 = 3 * 60 * 60 * 1000;
  const movements = [
    ...invoiceMovements,
    ...vouchers.map((voucher) => ({
      date: voucher.date,
      type: voucher.type as string,
      amount: toNumber(voucher.amount),
      referenceNumber: voucher.voucherNumber,
      recordId: voucher.id,
      sortKey: voucher.createdAt.getTime(),
      createdAt: voucher.createdAt,
      creator: voucher.creator,
      lastAudit: latestAuditByRecord.get(voucher.id),
      status: undefined,
    })),
  ].sort((a, b) => {
    const dayA = Math.floor((a.date.getTime() + UTC3) / 86_400_000);
    const dayB = Math.floor((b.date.getTime() + UTC3) / 86_400_000);
    return dayA - dayB || a.sortKey - b.sortKey;
  });

  // Cancelled vouchers are shown in the ledger for audit but, like cancelled
  // invoices, must NOT affect the running balance (keeps it consistent with the
  // canonical customer balance).
  const cancelledVoucherIds = new Set(vouchers.filter((v) => v.cancelledAt).map((v) => v.id));

  let runningBalance = toNumber(customer.openingBalance);

  const transactions = movements.flatMap((movement) => {
    // Sign convention (positive balance = customer owes us):
    //   Debit  (+): SALE invoice, PURCHASE payment (paid to supplier = reduces our debt), customer PAYMENT voucher
    //   Credit (âˆ’): PURCHASE invoice (we owe supplier), SALE payment upfront, RECEIPT voucher
    const isCancelledInvoice = movement.status === InvoiceStatus.CANCELLED;
    const isCancelledVoucher = cancelledVoucherIds.has(movement.recordId);
    const isCancelled = isCancelledInvoice || isCancelledVoucher;
    const isCredit =
      movement.type === "RECEIPT" ||
      movement.type === "SALE_PAYMENT" ||
      movement.type === "PURCHASE_INVOICE" ||
      movement.type === "SALES_RETURN_INVOICE";

    if (!isCancelled) {
      if (isCredit) {
        runningBalance -= movement.amount;
      } else {
        runningBalance += movement.amount;
      }
    }

    if (outputStartDate && movement.date < outputStartDate) {
      return [];
    }

    if (outputDateFilter?.lte && movement.date > outputDateFilter.lte) {
      return [];
    }

    // Map internal movement types to display types for the client
    const displayType =
      movement.type === "SALE_INVOICE" || movement.type === "PURCHASE_INVOICE" || movement.type === "SALES_RETURN_INVOICE"
        ? "INVOICE"
        : movement.type === "SALE_PAYMENT" || movement.type === "PURCHASE_PAYMENT"
          ? "INVOICE_PAYMENT"
          : movement.type;
    const invoiceType =
      movement.type === "SALE_INVOICE"
        ? "SALE"
        : movement.type === "PURCHASE_INVOICE"
          ? "PURCHASE"
          : movement.type === "SALES_RETURN_INVOICE"
            ? "SALES_RETURN"
            : null;

    return [{
      id: movement.recordId,
      date: movement.date,
      type: displayType,
      invoiceType,
      amount: movement.amount,
      referenceNumber: movement.referenceNumber,
      status: movement.status,
      createdAt: movement.createdAt,
      createdByName: movement.creator?.name ?? movement.creator?.username ?? null,
      createdBy: movement.creator
        ? {
            id: movement.creator.id,
            name: movement.creator.name,
            username: movement.creator.username,
            role: movement.creator.role,
          }
        : null,
      lastAction: movement.lastAudit?.action ?? null,
      lastChangedAt: movement.lastAudit?.createdAt ?? null,
      lastChangedByName:
        movement.lastAudit?.user?.name ?? movement.lastAudit?.user?.username ?? null,
      lastChangedBy: movement.lastAudit?.user ?? null,
      lastChangeSummary:
        movement.lastAudit?.metadata &&
        typeof movement.lastAudit.metadata === "object" &&
        "changes" in movement.lastAudit.metadata
          ? (movement.lastAudit.metadata as { changes?: unknown }).changes
          : null,
      debit: !isCancelled && !isCredit ? movement.amount : 0,
      credit: !isCancelled && isCredit ? movement.amount : 0,
      runningBalance,
    }];
  });

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      openingBalance: toNumber(customer.openingBalance),
    },
    transactions,
  };
}

export async function getLastCustomerTransaction(id: string) {
  await getCustomerOrThrow(id);

  const [invoice, voucher] = await Promise.all([
    prisma.invoice.findFirst({
      where: {
        customerId: id,
        status: InvoiceStatus.ACTIVE,
      },
      orderBy: { date: "desc" },
    }),
    prisma.paymentVoucher.findFirst({
      where: { customerId: id, archivedAt: null, cancelledAt: null },
      orderBy: { date: "desc" },
    }),
  ]);

  const movements = [
    ...(invoice
      ? [
          {
            date: invoice.date,
            type: "INVOICE",
            amount: toNumber(invoice.totalAmount),
            referenceNumber: invoice.invoiceNumber,
            sortKey: invoice.createdAt.getTime(),
          },
          ...(toNumber(invoice.paidAmount) > 0
            ? [{
                date: invoice.date,
                type: "INVOICE_PAYMENT",
                amount: toNumber(invoice.paidAmount),
                referenceNumber: invoice.invoiceNumber,
                sortKey: invoice.createdAt.getTime() + 1,
              }]
            : []),
        ]
      : []),
    ...(voucher
      ? [{
          date: voucher.date,
          type: voucher.type,
          amount: toNumber(voucher.amount),
          referenceNumber: voucher.voucherNumber,
          sortKey: voucher.createdAt.getTime(),
        }]
      : []),
  ] as Array<{
    date: Date;
    type: string;
    amount: number;
    referenceNumber: string;
    sortKey: number;
  }>;

  return movements.sort(
    (a, b) => b.date.getTime() - a.date.getTime() || b.sortKey - a.sortKey
  )[0] ?? null;
}

export async function getCustomerBalance(id: string) {
  const customer = await recalculateCustomerBalance(id);

  return {
    customerId: customer.id,
    openingBalance: customer.openingBalance,
    currentBalance: customer.currentBalance,
    previousBalance: customer.openingBalance,
    lastTransactionAt: customer.lastTransactionAt,
  };
}

export async function listCustomersWithDebts() {
  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      currentBalance: { gt: 0 },
    },
    orderBy: {
      currentBalance: "desc",
    },
  });

  const now = Date.now();

  return customers.map((customer) => {
    const lastDate = customer.lastTransactionAt ?? customer.createdAt;
    const inactiveDays = Math.floor(
      (now - lastDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      ...serializeCustomer(customer),
      inactiveDays,
    };
  });
}

const WALK_IN_PHONE = "0000000000";

export async function getOrCreateWalkInCustomer() {
  const existing = await prisma.customer.findFirst({
    where: { phone: WALK_IN_PHONE, deletedAt: null },
  });
  if (existing) return serializeCustomer(existing);

  const created = await prisma.customer.create({
    data: {
      name: "Ø§Ù„Ø²Ø¨ÙˆÙ† Ø§Ù„Ù†Ù‚Ø¯ÙŠ",
      phone: WALK_IN_PHONE,
      openingBalance: 0,
      currentBalance: 0,
      isSupplier: false,
    },
  });
  return serializeCustomer(created);
}

export async function listInactiveCustomers(days: number) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      OR: [{ lastTransactionAt: null }, { lastTransactionAt: { lt: cutoffDate } }],
    },
    orderBy: [{ lastTransactionAt: "asc" }, { createdAt: "asc" }],
  });

  const now = Date.now();

  return customers.map((customer) => {
    const lastDate = customer.lastTransactionAt ?? customer.createdAt;
    const inactiveDays = Math.floor(
      (now - lastDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      ...serializeCustomer(customer),
      inactiveDays,
    };
  });
}

export async function listCustomerTags() {
  // Union the canonical tag table with any tag still attached to a customer
  // (covers tags created before the table existed, or assigned out-of-band).
  const [tagRows, customerRows] = await Promise.all([
    prisma.customerTag.findMany({ select: { name: true } }),
    prisma.customer.findMany({
      where: { deletedAt: null },
      select: { tags: true },
    }),
  ]);

  const tags = new Set<string>();
  for (const row of tagRows) tags.add(row.name);
  for (const row of customerRows) {
    const arr = Array.isArray(row.tags) ? (row.tags as string[]) : [];
    for (const tag of arr) tags.add(tag);
  }

  return [...tags].sort((a, b) => a.localeCompare(b));
}

export async function createCustomerTag(name: string) {
  const clean = name.trim();
  if (!clean) throw new AppError("Ø§Ø³Ù… Ø§Ù„ØªØ§Ùƒ Ù…Ø·Ù„ÙˆØ¨", 400);
  await prisma.customerTag.upsert({
    where: { name: clean },
    update: {},
    create: { name: clean },
  });
  return listCustomerTags();
}

export async function renameCustomerTag(oldName: string, newName: string) {
  const from = oldName.trim();
  const to = newName.trim();
  if (!from || !to) throw new AppError("Ø§Ø³Ù… Ø§Ù„ØªØ§Ùƒ Ù…Ø·Ù„ÙˆØ¨", 400);
  if (from === to) return listCustomerTags();

  // Rename in the canonical table (merge into existing if `to` already exists).
  const existingTarget = await prisma.customerTag.findUnique({ where: { name: to } });
  if (existingTarget) {
    await prisma.customerTag.delete({ where: { name: from } }).catch(() => {});
  } else {
    await prisma.customerTag.updateMany({ where: { name: from }, data: { name: to } });
  }

  // Replace the tag inside every customer's tags array, de-duplicating.
  await prisma.$executeRaw`
    UPDATE "customers"
    SET "tags" = (
      SELECT array_agg(DISTINCT t)
      FROM unnest(array_replace("tags", ${from}, ${to})) AS t
    )
    WHERE ${from} = ANY("tags")
  `;
  return listCustomerTags();
}

export async function deleteCustomerTag(name: string) {
  const clean = name.trim();
  if (!clean) throw new AppError("Ø§Ø³Ù… Ø§Ù„ØªØ§Ùƒ Ù…Ø·Ù„ÙˆØ¨", 400);
  await prisma.customerTag.deleteMany({ where: { name: clean } });
  await prisma.$executeRaw`
    UPDATE "customers"
    SET "tags" = array_remove("tags", ${clean})
    WHERE ${clean} = ANY("tags")
  `;
  return listCustomerTags();
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

function buildCatalogLinkMessage(store: string, link: string, promoCode?: string) {
  let message =
    `Ù…Ø±Ø­Ø¨Ø§ Ø­Ø¨ÙŠØ¨ÙŠ ÙƒÙŠÙ Ø­Ø§Ù„Ùƒ ðŸŒ¹\n\n` +
    `Ù‡Ø°Ø§ Ø±Ø§Ø¨Ø· ÙƒØªÙ„ÙˆÙƒ ${store} ÙÙŠÙ‡ ÙƒÙ„ Ø§Ù„Ø¨Ø¶Ø§Ø¹Ø© Ù…Ø¹Ø±ÙˆØ¶Ø©ØŒ Ø§Ø¯Ø®Ù„ Ø¹Ù„ÙŠÙ‡ ÙˆØ§ÙƒØªØ¨ Ø±Ù‚Ù… ØªÙ„ÙÙˆÙ†Ùƒ ÙˆØªØµÙØ­ ÙˆØªØ³ÙˆÙ‚ Ø¨Ø±Ø§Ø­ØªÙƒ Ø¨Ø¯ÙˆÙ† ØªØ¹Ø¨ ðŸ›ï¸\n\n` +
    `ÙˆØ§Ø­Ù†Ø§ Ù†Ø¬Ù‡Ø²Ù„Ùƒ ÙˆÙ†Ø±Ø³Ù„Ùƒ Ø§Ù„Ø¨Ø¶Ø§Ø¹Ø© Ù„Ø¨Ø§Ø¨ Ø§Ù„Ù…Ø­Ù„ ðŸšš` +
    (link ? `\n\n${link}` : "");
  const promo = promoCode?.trim();
  if (promo) message += `\n\nðŸŽ ÙƒÙˆØ¯ Ø§Ù„Ø®ØµÙ… Ø§Ù„Ø®Ø§Øµ Ø¨Ùƒ: ${promo}`;
  return message;
}

// Sends the public wholesale-catalog link to one customer over WhatsApp, with
// a friendly intro and an optional per-customer promo code appended.
export async function sendCatalogLinkToCustomer(id: string, promoCode?: string) {
  const customer = await getCustomerOrThrow(id);
  const settings = await getSettings().catch(() => null);
  const link = (settings?.catalogPublicUrl || "").trim();
  const store = (settings?.storeName || "Ù…ØªØ¬Ø±Ù†Ø§").trim();

  await sendWhatsAppText(customer.phone, buildCatalogLinkMessage(store, link, promoCode));
  await prisma.customer.update({ where: { id: customer.id }, data: { catalogLinkSentAt: new Date() } }).catch(() => {});
  return { phone: customer.phone };
}

// Bulk-sends the catalog link to every customer carrying any of the given tags.
// Throttled + fire-and-forget friendly; records catalogLinkSentAt per customer.
export async function broadcastCatalogLink(input: { tags: string[]; promoCode?: string }) {
  const allCustomers = await prisma.customer.findMany({
    where: { deletedAt: null },
    select: { id: true, phone: true, tags: true },
  });
  const customers = allCustomers.filter((c) => {
    const tags = Array.isArray(c.tags) ? (c.tags as string[]) : [];
    return input.tags.some((t) => tags.includes(t));
  });
  if (customers.length === 0) return { sent: 0, failed: 0, total: 0 };

  const settings = await getSettings().catch(() => null);
  const link = (settings?.catalogPublicUrl || "").trim();
  const store = (settings?.storeName || "Ù…ØªØ¬Ø±Ù†Ø§").trim();
  const message = buildCatalogLinkMessage(store, link, input.promoCode);

  let sent = 0;
  let failed = 0;
  for (const customer of customers) {
    try {
      await sendWhatsAppText(customer.phone, message);
      await prisma.customer.update({ where: { id: customer.id }, data: { catalogLinkSentAt: new Date() } }).catch(() => {});
      sent++;
    } catch (err) {
      failed++;
      logger.warn(`[CatalogLinkBroadcast] failed to ${customer.phone}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return { sent, failed, total: customers.length };
}

export async function broadcastToCustomers(input: {
  tags: string[];
  productIds: string[];
  message: string;
}) {
  const allForBroadcast = await prisma.customer.findMany({ where: { deletedAt: null } });
  const customers = allForBroadcast.filter((c) => {
    const tags = Array.isArray(c.tags) ? (c.tags as string[]) : [];
    return input.tags.some((t) => tags.includes(t));
  });
  if (customers.length === 0) return { sent: 0, failed: 0, total: 0, skippedProducts: 0 };

  const productsRaw = await prisma.product.findMany({
    where: { id: { in: input.productIds }, deletedAt: null },
  });
  const productsById = new Map(productsRaw.map((p) => [p.id, p]));
  const orderedProducts = input.productIds
    .map((id) => productsById.get(id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);

  const productImages = orderedProducts
    .map((p) => ({ product: p, image: p.imageUrl ? dataUrlToBuffer(p.imageUrl) : null }))
    .filter((x): x is { product: typeof orderedProducts[number]; image: { buffer: Buffer; mime: string } } => x.image !== null);
  const skippedProducts = orderedProducts.length - productImages.length;

  const settings = await getSettings().catch(() => null);
  const catalogLink = settings?.catalogPublicUrl?.trim() || "";

  let sent = 0;
  let failed = 0;
  for (const customer of customers) {
    try {
      if (productImages.length > 0) {
        for (let idx = 0; idx < productImages.length; idx++) {
          const { product, image } = productImages[idx];
          const priceLine = product.retailPrice ? `\n${Number(product.retailPrice)} Ø¯.Ø¹` : "";
          let caption = `ðŸ“¦ ${product.name}${priceLine}`;
          if (idx === 0) {
            caption = catalogLink ? `${input.message}\n\n${caption}\n\nðŸ—‚ï¸ Ø§Ù„ÙƒØ§ØªÙ„ÙˆØ¬: ${catalogLink}` : `${input.message}\n\n${caption}`;
          }
          await sendWhatsAppImage(customer.phone, caption, image.buffer, image.mime);
          await new Promise((r) => setTimeout(r, 400));
        }
      } else {
        const caption = catalogLink ? `${input.message}\n\nðŸ—‚ï¸ Ø§Ù„ÙƒØ§ØªÙ„ÙˆØ¬: ${catalogLink}` : input.message;
        await sendWhatsAppText(customer.phone, caption);
      }
      sent++;
    } catch (err) {
      failed++;
      logger.warn(`[CustomerBroadcast] failed to ${customer.phone}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  return { sent, failed, total: customers.length, skippedProducts };
}
