import { InvoiceStatus, InvoiceType, Prisma, VoucherType } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { calculateCustomerBalance } from "../utils/financial";

type Db = Prisma.TransactionClient | typeof prisma;
type DecimalLike = Prisma.Decimal | number | string | null | undefined;

export interface ListVouchersQuery {
  customerId?: string;
  branchId?: string;
  type?: VoucherType;
  from?: string;
  to?: string;
  page: number;
  limit: number;
  showCancelled?: boolean;
}

export interface CreateVoucherInput {
  customerId?: string;
  amount: number;
  type: VoucherType;
  branchId?: string;
  date?: string;
  notes?: string;
  description?: string;
}

export interface UpdateVoucherInput {
  customerId?: string;
  amount?: number;
  date?: string;
  notes?: string;
  description?: string;
}

function toNumber(value: DecimalLike) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function serializeVoucher(voucher: any) {
  return {
    ...voucher,
    amount: toNumber(voucher.amount),
  };
}

function getDateFilter(from?: string, to?: string) {
  const date: Prisma.DateTimeFilter = {};
  if (from) date.gte = new Date(from);
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    date.lte = toDate;
  }
  return Object.keys(date).length ? date : undefined;
}

async function lockCustomer(tx: Db, customerId: string) {
  await tx.$queryRaw`SELECT "id" FROM "customers" WHERE "id" = ${customerId}::uuid FOR UPDATE`;
}

async function generateVoucherNumber(tx: Db, type: VoucherType, date: Date) {
  const year = date.getFullYear();
  const prefix =
    type === VoucherType.RECEIPT ? `REC-${year}-` :
    type === VoucherType.PAYMENT ? `PAY-${year}-` :
    `EXP-${year}-`;
  const counterKey = `voucher-${prefix}`;

  for (let attempt = 0; attempt < 50; attempt++) {
    const counter = await tx.counter.upsert({
      where: { key: counterKey },
      update: { value: { increment: 1 } },
      create: { key: counterKey, value: 1 },
    });
    const candidate = `${prefix}${String(counter.value).padStart(4, "0")}`;
    const exists = await tx.paymentVoucher.findFirst({
      where: { voucherNumber: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }

  throw new AppError("Could not generate a unique voucher number", 409, "VOUCHER_NUMBER_CONFLICT");
}

async function recalculateCustomerBalanceInTransaction(tx: Db, customerId: string) {
  await lockCustomer(tx, customerId);

  const customer = await tx.customer.findFirst({
    where: { id: customerId, deletedAt: null },
  });

  if (!customer) {
    throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  }

  const [saleTotals, creditInvoiceTotals, receiptTotals, paymentTotals, lastInvoice, lastVoucher] =
    await Promise.all([
      tx.invoice.aggregate({
        where: { customerId, status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE },
        _sum: { remainingAmount: true },
      }),
      tx.invoice.aggregate({
        where: { customerId, status: InvoiceStatus.ACTIVE, type: { in: [InvoiceType.PURCHASE, InvoiceType.SALES_RETURN] } },
        _sum: { remainingAmount: true },
      }),
      tx.paymentVoucher.aggregate({
        where: { customerId, type: VoucherType.RECEIPT, cancelledAt: null },
        _sum: { amount: true },
      }),
      tx.paymentVoucher.aggregate({
        where: { customerId, type: VoucherType.PAYMENT, cancelledAt: null },
        _sum: { amount: true },
      }),
      tx.invoice.findFirst({
        where: { customerId, status: InvoiceStatus.ACTIVE },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      }),
      tx.paymentVoucher.findFirst({
        where: { customerId },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      }),
  ]);

  // Same sign convention as invoice.service: +ve = customer owes us, -ve = we owe customer/supplier.
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

  await tx.customer.update({
    where: { id: customerId },
    data: {
      currentBalance,
      lastTransactionAt,
    },
  });

  return currentBalance;
}

export async function listVouchers(query: ListVouchersQuery) {
  const dateFilter = getDateFilter(query.from, query.to);
  const where: Prisma.PaymentVoucherWhereInput = {
    archivedAt: null, // hide accounting-safe-deleted vouchers from lists
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.branchId ? { branchId: query.branchId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(dateFilter ? { date: dateFilter } : {}),
    ...(query.showCancelled ? { cancelledAt: { not: null } } : { cancelledAt: null }),
  };
  const skip = (query.page - 1) * query.limit;

  const [total, vouchers] = await Promise.all([
    prisma.paymentVoucher.count({ where }),
    prisma.paymentVoucher.findMany({
      where,
      include: {
        customer: true,
        creator: {
          select: { id: true, name: true, username: true, role: true },
        },
      },
      orderBy: { date: "desc" },
      skip,
      take: query.limit,
    }),
  ]);

  return {
    data: vouchers.map(serializeVoucher),
    pagination: {
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.ceil(total / query.limit),
    },
  };
}

export async function getVoucherById(id: string) {
  const voucher = await prisma.paymentVoucher.findUnique({
    where: { id },
    include: {
      customer: true,
      creator: {
        select: { id: true, name: true, username: true, role: true },
      },
    },
  });

  if (!voucher) {
    throw new AppError("Voucher not found", 404, "VOUCHER_NOT_FOUND");
  }

  return serializeVoucher(voucher);
}

async function createVoucherInTransaction(
  tx: Db,
  input: CreateVoucherInput,
  createdBy: string
) {
  const date = input.date ? new Date(input.date) : new Date();
  const voucherNumber = await generateVoucherNumber(tx, input.type, date);

  // EXPENSE vouchers have no customer — they reduce the cashier and are tracked separately.
  if (input.type === VoucherType.EXPENSE) {
    const voucher = await tx.paymentVoucher.create({
      data: {
        voucherNumber,
        customerId: null,
        branchId: input.branchId ?? null,
        amount: input.amount,
        type: input.type,
        date,
        notes: input.notes,
        description: input.description,
        createdBy,
      },
      include: {
        customer: true,
        creator: { select: { id: true, name: true, username: true, role: true } },
      },
    });
    return serializeVoucher(voucher);
  }

  if (!input.customerId) {
    throw new AppError("customerId is required for this voucher type", 400, "CUSTOMER_REQUIRED");
  }

  await lockCustomer(tx, input.customerId);

  const customer = await tx.customer.findFirst({
    where: { id: input.customerId, deletedAt: null },
  });

  if (!customer) {
    throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  }

  const voucher = await tx.paymentVoucher.create({
    data: {
      voucherNumber,
      customerId: input.customerId,
      branchId: input.branchId ?? customer.branchId,
      amount: input.amount,
      type: input.type,
      date,
      notes: input.notes,
      description: input.description,
      createdBy,
    },
    include: {
      customer: true,
      creator: { select: { id: true, name: true, username: true, role: true } },
    },
  });

  await recalculateCustomerBalanceInTransaction(tx, input.customerId);

  return serializeVoucher(voucher);
}

export async function createVoucher(
  input: CreateVoucherInput,
  createdBy: string,
  db?: Db
) {
  if (db) {
    return createVoucherInTransaction(db, input, createdBy);
  }

  return prisma.$transaction((tx) =>
    createVoucherInTransaction(tx, input, createdBy)
  );
}

async function updateVoucherInTransaction(
  tx: Db,
  id: string,
  input: UpdateVoucherInput
) {
  const existing = await tx.paymentVoucher.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError("Voucher not found", 404, "VOUCHER_NOT_FOUND");
  }

  // EXPENSE vouchers cannot change customer; the rest cannot become EXPENSE on the fly either.
  const oldCustomerId = existing.customerId;
  const newCustomerId = input.customerId ?? oldCustomerId;

  const data: Prisma.PaymentVoucherUpdateInput = {};
  if (input.amount !== undefined) data.amount = input.amount;
  if (input.date !== undefined) data.date = new Date(input.date);
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.description !== undefined) data.description = input.description;
  if (existing.type !== VoucherType.EXPENSE && input.customerId !== undefined) {
    data.customer = { connect: { id: input.customerId } };
  }

  const updated = await tx.paymentVoucher.update({
    where: { id },
    data,
    include: {
      customer: true,
      creator: { select: { id: true, name: true, username: true, role: true } },
    },
  });

  // Recompute balance for both old and new customer (if changed).
  const affected = new Set<string>();
  if (oldCustomerId) affected.add(oldCustomerId);
  if (newCustomerId) affected.add(newCustomerId);
  for (const cid of affected) {
    await recalculateCustomerBalanceInTransaction(tx, cid);
  }

  return serializeVoucher(updated);
}

export async function updateVoucher(id: string, input: UpdateVoucherInput, db?: Db) {
  if (db) return updateVoucherInTransaction(db, id, input);
  return prisma.$transaction((tx) => updateVoucherInTransaction(tx, id, input));
}

// Accounting-safe "delete": the voucher row is RETAINED for audit, marked
// archived (and cancelled) so it is excluded from lists, reports, and balance
// calculations — never physically removed.
async function deleteVoucherInTransaction(tx: Db, id: string, deletedBy?: string, reason?: string) {
  const existing = await tx.paymentVoucher.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError("Voucher not found", 404, "VOUCHER_NOT_FOUND");
  }
  if (existing.archivedAt) return serializeVoucher(existing); // idempotent

  await tx.paymentVoucher.update({
    where: { id },
    data: {
      archivedAt: new Date(),
      deletedBy: deletedBy ?? null,
      deleteReason: reason ?? null,
      cancelledAt: existing.cancelledAt ?? new Date(),
    },
  });

  if (existing.customerId) {
    await recalculateCustomerBalanceInTransaction(tx, existing.customerId);
  }

  return serializeVoucher(existing);
}

export async function deleteVoucher(id: string, db?: Db, deletedBy?: string, reason?: string) {
  if (db) return deleteVoucherInTransaction(db, id, deletedBy, reason);
  return prisma.$transaction((tx) => deleteVoucherInTransaction(tx, id, deletedBy, reason));
}

async function cancelVoucherInTransaction(tx: Db, id: string) {
  const existing = await tx.paymentVoucher.findUnique({ where: { id } });
  if (!existing) throw new AppError("Voucher not found", 404, "VOUCHER_NOT_FOUND");
  if (existing.cancelledAt) throw new AppError("السند ملغى مسبقاً", 400, "VOUCHER_ALREADY_CANCELLED");

  const cancelled = await tx.paymentVoucher.update({
    where: { id },
    data: { cancelledAt: new Date() },
    include: { customer: true, creator: { select: { id: true, name: true, username: true, role: true } } },
  });

  if (existing.customerId) {
    await recalculateCustomerBalanceInTransaction(tx, existing.customerId);
  }

  return serializeVoucher(cancelled);
}

export async function cancelVoucher(id: string, db?: Db) {
  if (db) return cancelVoucherInTransaction(db, id);
  return prisma.$transaction((tx) => cancelVoucherInTransaction(tx, id));
}

async function restoreVoucherInTransaction(tx: Db, id: string) {
  const existing = await tx.paymentVoucher.findUnique({ where: { id } });
  if (!existing) throw new AppError("Voucher not found", 404, "VOUCHER_NOT_FOUND");
  if (existing.archivedAt) throw new AppError("لا يمكن استرجاع سند محذوف", 400, "VOUCHER_ARCHIVED");
  if (!existing.cancelledAt) throw new AppError("السند نشط مسبقاً", 400, "VOUCHER_ALREADY_ACTIVE");

  const restored = await tx.paymentVoucher.update({
    where: { id },
    data: { cancelledAt: null },
    include: { customer: true, creator: { select: { id: true, name: true, username: true, role: true } } },
  });

  if (existing.customerId) {
    await recalculateCustomerBalanceInTransaction(tx, existing.customerId);
  }

  return serializeVoucher(restored);
}

export async function restoreVoucher(id: string, db?: Db) {
  if (db) return restoreVoucherInTransaction(db, id);
  return prisma.$transaction((tx) => restoreVoucherInTransaction(tx, id));
}
