import { InvoiceStatus, InvoiceType, Prisma, VoucherType } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { calculateCustomerBalance } from "../utils/financial";
import { logger } from "../utils/logger";
import { normalizePhone } from "../utils/phone";
import { scoreCustomer } from "../utils/arabic-search";
import { getSettings } from "./settings.service";
import { sendWhatsAppImage, sendWhatsAppText } from "./whatsapp.service";
import { assistantTimezone, dayKeyInTz, zonedDayRange } from "./daily-assistant.service";

type Db = Prisma.TransactionClient | typeof prisma;
type DecimalLike = Prisma.Decimal | number | string | null | undefined;

export interface ListCustomersQuery {
  search?: string;
  hasDebt?: boolean;
  branchId?: string;
  isSupplier?: boolean;
  tags?: string[];
  customerIds?: string[];
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

function serializeCustomer<T extends { openingBalance: DecimalLike; currentBalance: DecimalLike; portalLinks?: any[] }>(
  customer: T
) {
  const { portalLinks, ...rest } = customer as any;
  return {
    ...rest,
    openingBalance: toNumber(rest.openingBalance),
    currentBalance: toNumber(rest.currentBalance),
    portalLinkEnabled: portalLinks && portalLinks.length > 0,
  };
}

function buildTransactionDateFilter(filter: TransactionFilter) {
  if (filter.all) return undefined;

  const dateFilter: Prisma.DateTimeFilter = {};

  if (filter.from) {
    dateFilter.gte = new Date(filter.from);
  }

  if (filter.to) {
    // Shop-timezone end of day, matching report.service. setHours() ran in the
    // container's zone (UTC), so a filter for 1 Aug also swept two early-morning
    // Iraq records belonging to 2 Aug — and the page total then disagreed with
    // the collections widget beside it.
    dateFilter.lte = zonedDayRange(filter.to.slice(0, 10), assistantTimezone()).end;
  }

  return Object.keys(dateFilter).length > 0 ? dateFilter : undefined;
}

function buildTransactionUpperDateFilter(filter: TransactionFilter) {
  if (filter.all || !filter.to) return undefined;

  return {
    lte: zonedDayRange(filter.to.slice(0, 10), assistantTimezone()).end,
  } satisfies Prisma.DateTimeFilter;
}

function startDateForFilter(filter: TransactionFilter) {
  if (filter.all || !filter.from) return null;
  return new Date(filter.from);
}

async function getCustomerOrThrow(id: string, db: Db = prisma) {
  const customer = await db.customer.findFirst({
    where: { id, deletedAt: null },
    include: {
      portalLinks: {
        where: { revokedAt: null },
        select: { id: true },
        take: 1,
      },
    },
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

/**
 * Re-derives the balance from the ledger. ALWAYS runs under a row lock.
 *
 * This is reachable from a READ endpoint — GET /customers/:id/balance →
 * getCustomerBalance() → here — which makes the race trivially easy to hit:
 * the five aggregates run, a receipt voucher commits in its own locked
 * transaction and correctly writes −500,000, and then this call writes its
 * stale 0 back over it. The stored balance then disagrees with the ledger
 * until the next write happens to correct it.
 *
 * Matches the locking already used by the invoice and voucher recalcs.
 */
async function recalculateCustomerBalanceLocked(db: Db, customerId: string) {
  await db.$queryRaw`SELECT "id" FROM "customers" WHERE "id" = ${customerId}::uuid FOR UPDATE`;
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
  //   SALE remaining  → +ve (customer owes us)
  //   PURCHASE remaining → -ve (we owe supplier)
  //   RECEIPT → -ve (reduces debt)
  //   PAYMENT → +ve (we paid out, increases what they owe or reduces our credit)
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

/**
 * Callers already inside a transaction pass their `db`; everyone else gets one
 * opened for them, so the lock above always has a transaction to hold it.
 */
export async function recalculateCustomerBalance(customerId: string, db?: Db) {
  // `db === prisma` means the caller had NO transaction and simply passed the
  // default client through (updateCustomer does exactly this). Running
  // SELECT … FOR UPDATE outside a transaction takes a lock that Postgres
  // releases immediately, i.e. no lock at all — so those callers get a
  // transaction opened for them here.
  if (db && db !== prisma) return recalculateCustomerBalanceLocked(db, customerId);
  return prisma.$transaction((tx) => recalculateCustomerBalanceLocked(tx, customerId));
}

export async function listCustomers(query: ListCustomersQuery) {
  const where: Prisma.CustomerWhereInput = {
    // includeDeleted=true → show all (including archived); default → active only
    ...(query.includeDeleted ? {} : { deletedAt: null }),
    ...(query.branchId ? { branchId: query.branchId } : {}),
    // isBoth customers appear in both customer list and supplier list
    ...(query.isSupplier !== undefined
      ? query.isSupplier
        ? { OR: [{ isSupplier: true }, { isBoth: true }] }
        : { isSupplier: false }
      : {}),
  };

  const hasTags = !!query.tags && query.tags.length > 0;
  const hasCustomerIds = !!query.customerIds && query.customerIds.length > 0;
  if (hasTags || hasCustomerIds) {
    const recipientOr: Prisma.CustomerWhereInput[] = [];
    if (hasTags) recipientOr.push({ tags: { hasSome: query.tags! } });
    if (hasCustomerIds) recipientOr.push({ id: { in: query.customerIds! } });
    // isSupplier already occupies `where.OR` above — combine both via AND so
    // neither condition silently clobbers the other.
    if (where.OR) {
      where.AND = [{ OR: where.OR as Prisma.CustomerWhereInput[] }, { OR: recipientOr }];
      delete where.OR;
    } else {
      where.OR = recipientOr;
    }
  }

  if (query.hasDebt !== undefined) {
    where.currentBalance = query.hasDebt ? { gt: 0 } : { lte: 0 };
  }

  const hasSearch = (query.search ?? "").trim().length > 0;

  // Search is Arabic-aware (أ/إ/آ→ا, ة/ه, ى/ي) + relevance-ranked + phone
  // matched on digits only, so it's evaluated in memory rather than via a plain
  // Prisma `contains`. Benefits web/desktop AND Android (same endpoint).
  if (hasSearch) {
    const all = await prisma.customer.findMany({ where, orderBy: [{ name: "asc" }] });
    const ranked = all
      .map((customer) => ({ customer, score: scoreCustomer(customer, query.search!) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.customer.name.localeCompare(b.customer.name, "ar"))
      .map((x) => x.customer);
    const total = ranked.length;
    const skip = (query.page - 1) * query.limit;
    return {
      data: ranked.slice(skip, skip + query.limit).map(serializeCustomer),
      pagination: { total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) },
    };
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
  const phone = normalizePhone(input.phone);

  // Phone is unique even across soft-deleted customers (their history must
  // stay intact), so a deleted customer's number stays "reserved". Give a
  // clear, actionable error instead of a raw constraint-violation message.
  const existing = await db.customer.findUnique({ where: { phone } });
  if (existing) {
    if (existing.deletedAt) {
      throw new AppError(
        `هذا الرقم يخص زبون محذوف: «${existing.name}» (رصيده ${Number(existing.currentBalance)}). ` +
          `استرجعه من «الزبائن المحذوفون» بدل إضافة زبون جديد بنفس الرقم.`,
        409,
        "PHONE_BELONGS_TO_DELETED_CUSTOMER"
      );
    }
    throw new AppError(`رقم الهاتف مستخدم من زبون آخر: «${existing.name}»`, 409, "PHONE_IN_USE");
  }

  const customer = await db.customer.create({
    data: {
      name: input.name,
      phone,
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

export async function getDeletedCustomers() {
  const customers = await prisma.customer.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
  });
  return customers.map(serializeCustomer);
}

export async function restoreCustomer(id: string) {
  const customer = await prisma.customer.findFirst({ where: { id, deletedAt: { not: null } } });
  if (!customer) throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");

  const restored = await prisma.customer.update({
    where: { id },
    data: { deletedAt: null },
  });
  return serializeCustomer(restored);
}

const customerStatementInvoiceInclude = {
  creator: { select: { id: true, name: true, username: true, role: true } },
  items: true,
} satisfies Prisma.InvoiceInclude;
type StatementInvoice = Prisma.InvoiceGetPayload<{ include: typeof customerStatementInvoiceInclude }>;

const customerStatementVoucherInclude = {
  creator: { select: { id: true, name: true, username: true, role: true } },
} satisfies Prisma.PaymentVoucherInclude;
type StatementVoucher = Prisma.PaymentVoucherGetPayload<{ include: typeof customerStatementVoucherInclude }>;

const customerStatementAuditInclude = {
  user: { select: { id: true, name: true, username: true, role: true } },
} satisfies Prisma.AuditLogInclude;
type StatementAuditLog = Prisma.AuditLogGetPayload<{ include: typeof customerStatementAuditInclude }>;

type StatementCustomer = { id: string; name: string; openingBalance: DecimalLike };

type StatementInvoiceItem = {
  productName: string;
  itemNumber: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

type StatementMovement = {
  date: Date;
  type: string;
  amount: number;
  referenceNumber: string;
  recordId: string;
  sortKey: number;
  createdAt: Date;
  creator?: { id: string; name: string; username: string; role: string } | null;
  lastAudit?: StatementAuditLog;
  status?: InvoiceStatus;
  items?: StatementInvoiceItem[];
  description?: string | null;
};

// Pure statement builder — shared by the single-customer endpoint and the
// bulk "all customers" export so the balance sign convention and audit-log
// enrichment logic only lives in one place.
function buildCustomerStatement(
  customer: StatementCustomer,
  invoices: StatementInvoice[],
  vouchers: StatementVoucher[],
  auditLogs: StatementAuditLog[],
  filter: TransactionFilter
) {
  const outputDateFilter = buildTransactionDateFilter(filter);
  const outputStartDate = startDateForFilter(filter);

  const latestAuditByRecord = new Map<string, StatementAuditLog>();
  for (const log of auditLogs) {
    if (log.recordId && !latestAuditByRecord.has(log.recordId)) {
      latestAuditByRecord.set(log.recordId, log);
    }
  }

  const invoiceMovements: StatementMovement[] = invoices.flatMap((invoice) => {
    const isSale = invoice.type === "SALE";
    const isReturn = invoice.type === "SALES_RETURN";
    const items: StatementInvoiceItem[] = invoice.items.map((item) => ({
      productName: item.productName,
      itemNumber: item.itemNumber,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: toNumber(item.unitPrice),
      totalPrice: toNumber(item.totalPrice),
    }));
    const movements: StatementMovement[] = [
      {
        date: invoice.date,
        // SALE_INVOICE adds to balance (customer owes us more → debit).
        // PURCHASE_INVOICE subtracts (we owe supplier → credit).
        // SALE_PAYMENT / PURCHASE_PAYMENT are the upfront-paid portions on the invoice itself.
        type: isReturn ? "SALES_RETURN_INVOICE" : isSale ? "SALE_INVOICE" : "PURCHASE_INVOICE",
        amount: toNumber(invoice.totalAmount),
        referenceNumber: invoice.invoiceNumber,
        recordId: invoice.id,
        sortKey: invoice.createdAt.getTime(),
        createdAt: invoice.createdAt,
        creator: invoice.creator,
        lastAudit: latestAuditByRecord.get(invoice.id),
        status: invoice.status,
        items,
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

  // Bucket both record types onto the same calendar day before sorting: old
  // vouchers carry a real timestamp (23:27 UTC = 02:27 next day in Baghdad)
  // while invoices use midnight-UTC of the business date.
  //
  // This used to be a hardcoded `+3h`, which silently assumed every tenant is
  // in Iraq — for a tenant at UTC+1 a 22:30Z voucher (23:30 local, same day)
  // was floored into the NEXT day and sorted after a sale it actually preceded,
  // so the running-balance column told the wrong story. The shop timezone is
  // the same one the reports bucket by.
  const statementTz = assistantTimezone();
  const dayKey = (date: Date) => dayKeyInTz(date, statementTz);
  const movements: StatementMovement[] = [
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
      description: voucher.description ?? voucher.notes ?? null,
    })),
  ].sort((a, b) => {
    const dayA = dayKey(a.date);
    const dayB = dayKey(b.date);
    return dayA < dayB ? -1 : dayA > dayB ? 1 : a.sortKey - b.sortKey;
  });

  // Cancelled vouchers are shown in the ledger for audit but, like cancelled
  // invoices, must NOT affect the running balance (keeps it consistent with the
  // canonical customer balance).
  const cancelledVoucherIds = new Set(vouchers.filter((v) => v.cancelledAt).map((v) => v.id));

  let runningBalance = toNumber(customer.openingBalance);

  const transactions = movements.flatMap((movement) => {
    // Sign convention (positive balance = customer owes us):
    //   Debit  (+): SALE invoice, PURCHASE payment (paid to supplier = reduces our debt), customer PAYMENT voucher
    //   Credit (−): PURCHASE invoice (we owe supplier), SALE payment upfront, RECEIPT voucher
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
      items: movement.items ?? null,
      description: movement.description ?? null,
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

export async function getCustomerTransactions(id: string, filter: TransactionFilter) {
  const customer = await getCustomerOrThrow(id);
  const upperDateFilter = buildTransactionUpperDateFilter(filter);

  const [invoices, vouchers] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        customerId: id,
        archivedAt: null,
        ...(upperDateFilter ? { date: upperDateFilter } : {}),
      },
      include: customerStatementInvoiceInclude,
      orderBy: { date: "asc" },
    }),
    prisma.paymentVoucher.findMany({
      where: {
        customerId: id,
        archivedAt: null,
        ...(upperDateFilter ? { date: upperDateFilter } : {}),
      },
      include: customerStatementVoucherInclude,
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
        include: customerStatementAuditInclude,
        orderBy: { createdAt: "desc" },
      })
    : [];

  return buildCustomerStatement(customer, invoices, vouchers, auditLogs, filter);
}

export interface CustomerStatementsExportParams {
  page: number;
  limit: number;
  // "all" (default) — every customer, including ones with no activity yet.
  // "withBalance" — only customers whose current balance isn't zero, even if
  //   they have no invoice/voucher rows at all (e.g. an opening-balance-only
  //   customer) — this must NOT depend on activity existing.
  // "inactive" — no transaction in the last `inactiveDays` days (or never).
  customerFilter?: "all" | "withBalance" | "inactive";
  inactiveDays?: number;
  from?: string;
  to?: string;
  all?: boolean;
}

export async function getAllCustomerStatements(params: CustomerStatementsExportParams) {
  const page = Math.max(1, params.page || 1);
  const limit = Math.max(1, Math.min(params.limit || 25, 100));
  // `all` defaults true when the caller sends no date bounds at all (mirrors
  // customerTransactionsSchema's `all` transform, which always yields `false`
  // rather than `undefined` for an absent query param — so this can't rely on
  // `params.all` alone to mean "no dates were requested").
  const filter: TransactionFilter = {
    from: params.from,
    to: params.to,
    all: params.all || (!params.from && !params.to),
  };

  let where: Prisma.CustomerWhereInput = { deletedAt: null };
  if (params.customerFilter === "withBalance") {
    where = { ...where, currentBalance: { not: 0 } };
  } else if (params.customerFilter === "inactive") {
    const cutoff = new Date(Date.now() - Math.max(0, params.inactiveDays ?? 30) * 24 * 60 * 60 * 1000);
    where = { ...where, OR: [{ lastTransactionAt: null }, { lastTransactionAt: { lt: cutoff } }] };
  }
  // "all" (or unspecified): no activity/balance requirement at all — a
  // customer with neither transactions nor a balance still appears, with an
  // empty transaction list, matching "save every customer" literally.

  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      select: { id: true, name: true, phone: true, openingBalance: true, currentBalance: true },
      orderBy: { name: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const customerIds = customers.map((c) => c.id);
  const upperDateFilter = buildTransactionUpperDateFilter(filter);

  const [invoices, vouchers] = customerIds.length
    ? await Promise.all([
        prisma.invoice.findMany({
          where: { customerId: { in: customerIds }, archivedAt: null, ...(upperDateFilter ? { date: upperDateFilter } : {}) },
          include: customerStatementInvoiceInclude,
          orderBy: { date: "asc" },
        }),
        prisma.paymentVoucher.findMany({
          where: { customerId: { in: customerIds }, archivedAt: null, ...(upperDateFilter ? { date: upperDateFilter } : {}) },
          include: customerStatementVoucherInclude,
          orderBy: { date: "asc" },
        }),
      ])
    : [[], []];

  const recordIds = [...invoices.map((invoice) => invoice.id), ...vouchers.map((voucher) => voucher.id)];
  const auditLogs = recordIds.length
    ? await prisma.auditLog.findMany({
        where: {
          recordId: { in: recordIds },
          entity: { in: ["invoices", "vouchers"] },
          action: { in: ["UPDATE", "DELETE", "REACTIVATE"] },
        },
        include: customerStatementAuditInclude,
        orderBy: { createdAt: "desc" },
      })
    : [];

  const invoicesByCustomer = new Map<string, StatementInvoice[]>();
  for (const invoice of invoices) {
    const list = invoicesByCustomer.get(invoice.customerId) ?? [];
    list.push(invoice);
    invoicesByCustomer.set(invoice.customerId, list);
  }
  const vouchersByCustomer = new Map<string, StatementVoucher[]>();
  for (const voucher of vouchers) {
    if (!voucher.customerId) continue;
    const list = vouchersByCustomer.get(voucher.customerId) ?? [];
    list.push(voucher);
    vouchersByCustomer.set(voucher.customerId, list);
  }
  const auditLogsByRecord = new Map<string, StatementAuditLog[]>();
  for (const log of auditLogs) {
    if (!log.recordId) continue;
    const list = auditLogsByRecord.get(log.recordId) ?? [];
    list.push(log);
    auditLogsByRecord.set(log.recordId, list);
  }

  const data = customers.map((customer) => {
    const customerInvoices = invoicesByCustomer.get(customer.id) ?? [];
    const customerVouchers = vouchersByCustomer.get(customer.id) ?? [];
    const customerRecordIds = [
      ...customerInvoices.map((invoice) => invoice.id),
      ...customerVouchers.map((voucher) => voucher.id),
    ];
    const customerAuditLogs = customerRecordIds.flatMap((id) => auditLogsByRecord.get(id) ?? []);
    const statement = buildCustomerStatement(customer, customerInvoices, customerVouchers, customerAuditLogs, filter);
    return {
      customer: { ...statement.customer, phone: customer.phone, currentBalance: toNumber(customer.currentBalance) },
      transactions: statement.transactions,
    };
  });

  return { data, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
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
            type: invoice.type,
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

export async function listCustomerTags() {
  // Union the canonical tag table with any tag still attached to a customer
  // (covers tags created before the table existed, or assigned out-of-band).
  const [tagRows, customerRows] = await Promise.all([
    prisma.customerTag.findMany({ select: { name: true } }),
    prisma.customer.findMany({
      where: { deletedAt: null, tags: { isEmpty: false } },
      select: { tags: true },
    }),
  ]);

  const tags = new Set<string>();
  for (const row of tagRows) tags.add(row.name);
  for (const row of customerRows) for (const tag of row.tags) tags.add(tag);

  return [...tags].sort((a, b) => a.localeCompare(b));
}

export async function createCustomerTag(name: string) {
  const clean = name.trim();
  if (!clean) throw new AppError("اسم التاك مطلوب", 400);
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
  if (!from || !to) throw new AppError("اسم التاك مطلوب", 400);
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
  if (!clean) throw new AppError("اسم التاك مطلوب", 400);
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
    `مرحبا حبيبي كيف حالك 🌹\n\n` +
    `هذا رابط كتلوك ${store} فيه كل البضاعة معروضة، ادخل عليه واكتب رقم تلفونك وتصفح وتسوق براحتك بدون تعب 🛍️\n\n` +
    `واحنا نجهزلك ونرسلك البضاعة لباب المحل 🚚` +
    (link ? `\n\n${link}` : "");
  const promo = promoCode?.trim();
  if (promo) message += `\n\n🎁 كود الخصم الخاص بك: ${promo}`;
  return message;
}

// Sends the public wholesale-catalog link to one customer over WhatsApp, with
// a friendly intro and an optional per-customer promo code appended.
export async function sendCatalogLinkToCustomer(id: string, promoCode?: string) {
  const customer = await getCustomerOrThrow(id);
  const settings = await getSettings().catch(() => null);
  const link = (settings?.catalogPublicUrl || "").trim();
  const store = (settings?.storeName || "متجرنا").trim();

  await sendWhatsAppText(customer.phone, buildCatalogLinkMessage(store, link, promoCode));
  await prisma.customer.update({ where: { id: customer.id }, data: { catalogLinkSentAt: new Date() } }).catch(() => {});
  return { phone: customer.phone };
}

// Bulk-sends the catalog link to every customer carrying any of the given tags.
// Throttled + fire-and-forget friendly; records catalogLinkSentAt per customer.
export async function broadcastCatalogLink(input: { tags: string[]; promoCode?: string }) {
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null, tags: { hasSome: input.tags } },
    select: { id: true, phone: true },
  });
  if (customers.length === 0) return { sent: 0, failed: 0, total: 0 };

  const settings = await getSettings().catch(() => null);
  const link = (settings?.catalogPublicUrl || "").trim();
  const store = (settings?.storeName || "متجرنا").trim();
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
  customerIds?: string[];
  productIds: string[];
  message: string;
}) {
  const hasTags = input.tags.length > 0;
  const hasCustomerIds = !!input.customerIds && input.customerIds.length > 0;
  if (!hasTags && !hasCustomerIds) return { sent: 0, failed: 0, total: 0, skippedProducts: 0 };

  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      OR: [
        ...(hasTags ? [{ tags: { hasSome: input.tags } }] : []),
        ...(hasCustomerIds ? [{ id: { in: input.customerIds! } }] : []),
      ],
    },
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

  const finalText = catalogLink ? `${input.message}\n\n🗂️ الكاتلوج: ${catalogLink}` : input.message;

  let sent = 0;
  let failed = 0;
  for (const customer of customers) {
    try {
      // Images first (each captioned with the product's WHOLESALE price —
      // salePrice, not retailPrice which is the مفرد/retail price), then the
      // typed message is sent on its own as the final, separate message.
      for (const { product, image } of productImages) {
        const priceLine = product.salePrice ? `\n${Number(product.salePrice)} د.ع` : "";
        const caption = `📦 ${product.name}${priceLine}`;
        await sendWhatsAppImage(customer.phone, caption, image.buffer, image.mime);
        await new Promise((r) => setTimeout(r, 400));
      }
      await sendWhatsAppText(customer.phone, finalText);
      sent++;
    } catch (err) {
      failed++;
      logger.warn(`[CustomerBroadcast] failed to ${customer.phone}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  return { sent, failed, total: customers.length, skippedProducts };
}
