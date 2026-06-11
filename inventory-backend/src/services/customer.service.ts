import { InvoiceStatus, InvoiceType, Prisma, VoucherType } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";

type Db = Prisma.TransactionClient | typeof prisma;
type DecimalLike = Prisma.Decimal | number | string | null | undefined;

export interface ListCustomersQuery {
  search?: string;
  hasDebt?: boolean;
  branchId?: string;
  isSupplier?: boolean;
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
  openingBalance: number;
  creditLimit?: number | null;
  branchId?: string;
  isSupplier?: boolean;
}

export interface UpdateCustomerInput {
  name?: string;
  phone?: string;
  address?: string | null;
  notes?: string | null;
  openingBalance?: number;
  creditLimit?: number | null;
  branchId?: string | null;
  isSupplier?: boolean;
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

/** Fetch a customer by ID regardless of deletedAt — used for account lookup */
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
        },
        _sum: { amount: true },
      }),
      db.paymentVoucher.aggregate({
        where: {
          customerId,
          type: VoucherType.PAYMENT,
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
        where: { customerId },
        orderBy: { date: "desc" },
      }),
    ]);

  // Sign convention: +ve = customer owes us; -ve = we owe them (supplier).
  //   SALE remaining  → +ve (customer owes us)
  //   PURCHASE remaining → -ve (we owe supplier)
  //   RECEIPT → -ve (reduces debt)
  //   PAYMENT → +ve (we paid out, increases what they owe or reduces our credit)
  const currentBalance =
    toNumber(customer.openingBalance) +
    toNumber(saleTotals._sum.remainingAmount) -
    toNumber(creditInvoiceTotals._sum.remainingAmount) -
    toNumber(receiptTotals._sum.amount) +
    toNumber(paymentTotals._sum.amount);

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
    // includeDeleted=true → show all (including archived); default → active only
    ...(query.includeDeleted ? {} : { deletedAt: null }),
    ...(query.branchId ? { branchId: query.branchId } : {}),
    ...(query.isSupplier !== undefined ? { isSupplier: query.isSupplier } : {}),
  };

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { phone: { contains: query.search, mode: "insensitive" } },
      { address: { contains: query.search, mode: "insensitive" } },
    ];
  }

  if (query.hasDebt !== undefined) {
    where.currentBalance = query.hasDebt ? { gt: 0 } : { lte: 0 };
  }

  const skip = (query.page - 1) * query.limit;

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
      phone: input.phone,
      address: input.address,
      notes: input.notes,
      openingBalance: input.openingBalance,
      currentBalance: input.openingBalance,
      creditLimit: input.creditLimit ?? null,
      branchId: input.branchId,
      isSupplier: input.isSupplier ?? false,
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
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.address !== undefined) data.address = input.address;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.openingBalance !== undefined) data.openingBalance = input.openingBalance;
  if (input.creditLimit !== undefined) data.creditLimit = input.creditLimit;
  if (input.branchId !== undefined) data.branchId = input.branchId;
  if (input.isSupplier !== undefined) data.isSupplier = input.isSupplier;

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
      // SALE_INVOICE adds to balance (customer owes us more → debit).
      // PURCHASE_INVOICE subtracts (we owe supplier → credit).
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
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.sortKey - b.sortKey);

  let runningBalance = toNumber(customer.openingBalance);

  const transactions = movements.flatMap((movement) => {
    // Sign convention (positive balance = customer owes us):
    //   Debit  (+): SALE invoice, PURCHASE payment (paid to supplier = reduces our debt), customer PAYMENT voucher
    //   Credit (−): PURCHASE invoice (we owe supplier), SALE payment upfront, RECEIPT voucher
    const isCancelledInvoice = movement.status === InvoiceStatus.CANCELLED;
    const isCredit =
      movement.type === "RECEIPT" ||
      movement.type === "SALE_PAYMENT" ||
      movement.type === "PURCHASE_INVOICE" ||
      movement.type === "SALES_RETURN_INVOICE";

    if (!isCancelledInvoice) {
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

    return [{
      id: movement.recordId,
      date: movement.date,
      type: displayType,
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
      debit: !isCancelledInvoice && !isCredit ? movement.amount : 0,
      credit: !isCancelledInvoice && isCredit ? movement.amount : 0,
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
      where: { customerId: id },
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
      name: "الزبون النقدي",
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
