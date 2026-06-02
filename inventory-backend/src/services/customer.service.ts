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
  page: number;
  limit: number;
}

export interface CreateCustomerInput {
  name: string;
  phone: string;
  address?: string;
  notes?: string;
  openingBalance: number;
  branchId?: string;
  isSupplier?: boolean;
}

export interface UpdateCustomerInput {
  name?: string;
  phone?: string;
  address?: string | null;
  notes?: string | null;
  openingBalance?: number;
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

export async function recalculateCustomerBalance(customerId: string, db: Db = prisma) {
  const customer = await getCustomerOrThrow(customerId, db);

  const [saleTotals, purchaseTotals, receiptTotals, paymentTotals, lastInvoice, lastVoucher] =
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
          type: InvoiceType.PURCHASE,
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
    toNumber(purchaseTotals._sum.remainingAmount) -
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
    deletedAt: null,
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
        status: InvoiceStatus.ACTIVE,
        ...(upperDateFilter ? { date: upperDateFilter } : {}),
      },
      orderBy: { date: "asc" },
    }),
    prisma.paymentVoucher.findMany({
      where: {
        customerId: id,
        ...(upperDateFilter ? { date: upperDateFilter } : {}),
      },
      orderBy: { date: "asc" },
    }),
  ]);

  const invoiceMovements = invoices.flatMap((invoice) => {
    const isSale = invoice.type !== "PURCHASE";
    const movements: Array<{
      date: Date;
      // SALE_INVOICE adds to balance (customer owes us more → debit).
      // PURCHASE_INVOICE subtracts (we owe supplier → credit).
      // SALE_PAYMENT / PURCHASE_PAYMENT are the upfront-paid portions on the invoice itself.
      type: "SALE_INVOICE" | "SALE_PAYMENT" | "PURCHASE_INVOICE" | "PURCHASE_PAYMENT";
      amount: number;
      referenceNumber: string;
      sortKey: number;
    }> = [
      {
        date: invoice.date,
        type: isSale ? "SALE_INVOICE" : "PURCHASE_INVOICE",
        amount: toNumber(invoice.totalAmount),
        referenceNumber: invoice.invoiceNumber,
        sortKey: invoice.createdAt.getTime(),
      },
    ];

    const paidAmount = toNumber(invoice.paidAmount);
    if (paidAmount > 0) {
      movements.push({
        date: invoice.date,
        type: isSale ? "SALE_PAYMENT" : "PURCHASE_PAYMENT",
        amount: paidAmount,
        referenceNumber: invoice.invoiceNumber,
        sortKey: invoice.createdAt.getTime() + 1,
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
      sortKey: voucher.createdAt.getTime(),
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.sortKey - b.sortKey);

  let runningBalance = toNumber(customer.openingBalance);

  const transactions = movements.flatMap((movement) => {
    // Sign convention (positive balance = customer owes us):
    //   Debit  (+): SALE invoice, PURCHASE payment (paid to supplier = reduces our debt), customer PAYMENT voucher
    //   Credit (−): PURCHASE invoice (we owe supplier), SALE payment upfront, RECEIPT voucher
    const isCredit =
      movement.type === "RECEIPT" ||
      movement.type === "SALE_PAYMENT" ||
      movement.type === "PURCHASE_INVOICE";

    if (isCredit) {
      runningBalance -= movement.amount;
    } else {
      runningBalance += movement.amount;
    }

    if (outputStartDate && movement.date < outputStartDate) {
      return [];
    }

    if (outputDateFilter?.lte && movement.date > outputDateFilter.lte) {
      return [];
    }

    // Map internal movement types to display types for the client
    const displayType =
      movement.type === "SALE_INVOICE" || movement.type === "PURCHASE_INVOICE"
        ? "INVOICE"
        : movement.type === "SALE_PAYMENT" || movement.type === "PURCHASE_PAYMENT"
          ? "INVOICE_PAYMENT"
          : movement.type;

    return [{
      id: `${movement.type}-${movement.referenceNumber}-${movement.sortKey}`,
      date: movement.date,
      type: displayType,
      amount: movement.amount,
      referenceNumber: movement.referenceNumber,
      debit: !isCredit ? movement.amount : 0,
      credit: isCredit ? movement.amount : 0,
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
