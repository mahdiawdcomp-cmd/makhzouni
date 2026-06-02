import {
  InvoiceStatus,
  InvoiceType,
  PaymentType,
  Prisma,
  StockMovementType,
  Unit,
  VoucherType,
} from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";

type Db = Prisma.TransactionClient | typeof prisma;
type DecimalLike = Prisma.Decimal | number | string | null | undefined;

export interface ListInvoicesQuery {
  customerId?: string;
  status?: InvoiceStatus;
  type?: InvoiceType;
  paymentType?: PaymentType;
  branchId?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

export interface InvoiceItemInput {
  productId: string;
  unit: Unit;
  quantity: number;
  unitPrice?: number;
}

export interface CreateInvoiceInput {
  customerId: string;
  type?: InvoiceType;
  date?: string;
  discount: number;
  tax: number;
  paidAmount: number;
  paymentType?: PaymentType;
  branchId?: string;
  items: InvoiceItemInput[];
}

function toNumber(value: DecimalLike) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function serializeInvoice(invoice: any) {
  return {
    ...invoice,
    subtotal: toNumber(invoice.subtotal),
    discount: toNumber(invoice.discount),
    tax: toNumber(invoice.tax),
    totalAmount: toNumber(invoice.totalAmount),
    paidAmount: toNumber(invoice.paidAmount),
    remainingAmount: toNumber(invoice.remainingAmount),
    previousBalance: toNumber(invoice.previousBalance),
    finalBalance: toNumber(invoice.finalBalance),
    items: invoice.items?.map((item: any) => ({
      ...item,
      unitPrice: toNumber(item.unitPrice),
      totalPrice: toNumber(item.totalPrice),
    })),
  };
}

function unitToPieces(unit: Unit, quantity: number, pcsPerCarton: number) {
  if (unit === Unit.CARTON) return quantity * pcsPerCarton;
  if (unit === Unit.DOZEN) return quantity * 12;
  return quantity;
}

function defaultUnitPrice(unit: Unit, salePrice: DecimalLike, pcsPerCarton: number) {
  const price = toNumber(salePrice);
  if (unit === Unit.CARTON) return price * pcsPerCarton;
  if (unit === Unit.DOZEN) return price * 12;
  return price;
}

function productStock(product: {
  openingBalancePcs: number;
  cartonsAvailable: number;
  pcsPerCarton: number;
}) {
  return product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton;
}

function openingBalanceForStock(
  desiredStock: number,
  product: { cartonsAvailable: number; pcsPerCarton: number }
) {
  return desiredStock - product.cartonsAvailable * product.pcsPerCarton;
}

async function generateInvoiceNumber(tx: Db, date: Date) {
  const year = date.getFullYear();
  const prefix = `INV-${year}-`;
  const lastInvoice = await tx.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: "desc" },
  });
  const lastNumber = lastInvoice
    ? Number(lastInvoice.invoiceNumber.replace(prefix, ""))
    : 0;

  return `${prefix}${String(lastNumber + 1).padStart(4, "0")}`;
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

async function getCustomerBalance(tx: Db, customerId: string) {
  await lockCustomer(tx, customerId);

  const customer = await tx.customer.findFirst({
    where: { id: customerId, deletedAt: null },
  });

  if (!customer) {
    throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  }

  return {
    customer,
    previousBalance: toNumber(customer.currentBalance),
  };
}

async function recalculateCustomerBalanceInTransaction(tx: Db, customerId: string) {
  await lockCustomer(tx, customerId);

  const customer = await tx.customer.findFirst({
    where: { id: customerId },
  });

  if (!customer) {
    throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  }

  const [saleTotals, purchaseTotals, receiptTotals, paymentTotals, lastInvoice, lastVoucher] = await Promise.all([
    tx.invoice.aggregate({
      where: { customerId, status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE },
      _sum: { remainingAmount: true },
    }),
    tx.invoice.aggregate({
      where: { customerId, status: InvoiceStatus.ACTIVE, type: InvoiceType.PURCHASE },
      _sum: { remainingAmount: true },
    }),
    tx.paymentVoucher.aggregate({
      where: { customerId, type: VoucherType.RECEIPT },
      _sum: { amount: true },
    }),
    tx.paymentVoucher.aggregate({
      where: { customerId, type: VoucherType.PAYMENT },
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

  // Sign convention: positive = the customer owes US, negative = WE owe the customer (supplier).
  //   SALE invoice remaining → +ve (customer owes us)
  //   PURCHASE invoice remaining → -ve (we owe supplier)
  //   RECEIPT voucher → -ve (we received money from customer, reduces their debt)
  //   PAYMENT voucher → +ve (we paid customer, increases what they owe… or reduces our debt to supplier)
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

  await tx.customer.update({
    where: { id: customerId },
    data: { currentBalance, lastTransactionAt },
  });

  return currentBalance;
}

async function applyStockMovement(
  tx: Db,
  invoiceId: string,
  item: InvoiceItemInput,
  invoiceType: InvoiceType,
  branchId?: string | null
) {
  const product = await tx.product.findUnique({
    where: { id: item.productId },
  });

  if (!product || product.deletedAt) {
    throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
  }

  const quantityInPieces = unitToPieces(item.unit, item.quantity, product.pcsPerCarton);
  const balanceBefore = productStock(product);
  const isPurchase = invoiceType === InvoiceType.PURCHASE;
  // PURCHASE adds to stock (we're buying in); SALE subtracts (we're selling out).
  // Negative balanceAfter is allowed — the product will show negative stock as a warning.
  const balanceAfter = isPurchase ? balanceBefore + quantityInPieces : balanceBefore - quantityInPieces;

  // Normalize carton / piece split so the display always reflects reality.
  // If stock is negative we keep cartonsAvailable = 0 and openingBalancePcs carries the deficit.
  const normalizedCartons =
    balanceAfter >= 0 ? Math.floor(balanceAfter / product.pcsPerCarton) : 0;
  const normalizedPcs = balanceAfter - normalizedCartons * product.pcsPerCarton;

  await tx.product.update({
    where: { id: product.id },
    data: {
      openingBalancePcs: normalizedPcs,
      cartonsAvailable: normalizedCartons,
    },
  });

  await tx.stockMovement.create({
    data: {
      productId: product.id,
      branchId,
      invoiceId,
      type: isPurchase ? StockMovementType.IN : StockMovementType.OUT,
      quantity: quantityInPieces,
      balanceBefore,
      balanceAfter,
    },
  });

  // Default unit price: SALE uses sale price; PURCHASE uses purchase price.
  const defaultPriceSource = isPurchase ? product.purchasePrice : product.salePrice;
  const unitPrice =
    item.unitPrice ?? defaultUnitPrice(item.unit, defaultPriceSource, product.pcsPerCarton);

  return {
    product,
    quantityInPieces,
    unitPrice,
    totalPrice: unitPrice * item.quantity,
  };
}

// Reverse every stock movement booked against this invoice (regardless of direction),
// so it works for SALE (originally OUT → restore as IN) and PURCHASE (originally IN → restore as OUT).
async function restoreInvoiceStock(tx: Db, invoiceId: string) {
  const movements = await tx.stockMovement.findMany({
    where: { invoiceId },
    orderBy: { createdAt: "asc" },
  });

  for (const movement of movements) {
    const product = await tx.product.findUnique({
      where: { id: movement.productId },
    });

    if (!product) continue;

    const wasOut = movement.type === StockMovementType.OUT;
    const balanceBefore = productStock(product);
    // Allow negative restoration too — same policy as forward movements.
    const balanceAfter = wasOut ? balanceBefore + movement.quantity : balanceBefore - movement.quantity;

    // Normalize carton / piece split.
    const normalizedCartons =
      balanceAfter >= 0 ? Math.floor(balanceAfter / product.pcsPerCarton) : 0;
    const normalizedPcs = balanceAfter - normalizedCartons * product.pcsPerCarton;

    await tx.product.update({
      where: { id: product.id },
      data: {
        openingBalancePcs: normalizedPcs,
        cartonsAvailable: normalizedCartons,
      },
    });

    await tx.stockMovement.create({
      data: {
        productId: product.id,
        branchId: movement.branchId,
        invoiceId,
        type: wasOut ? StockMovementType.IN : StockMovementType.OUT,
        quantity: movement.quantity,
        balanceBefore,
        balanceAfter,
      },
    });
  }
}

async function createInvoiceInTransaction(
  tx: Db,
  input: CreateInvoiceInput,
  createdBy: string,
  existingInvoiceId?: string,
  existingInvoiceNumber?: string
) {
  const date = input.date ? new Date(input.date) : new Date();
  const invoiceType = input.type ?? InvoiceType.SALE;
  const { customer, previousBalance } = await getCustomerBalance(tx, input.customerId);
  const branchId = input.branchId ?? customer.branchId;
  const invoiceNumber =
    existingInvoiceNumber ?? (await generateInvoiceNumber(tx, date));

  const invoice = existingInvoiceId
    ? await tx.invoice.update({
        where: { id: existingInvoiceId },
        data: {
          type: invoiceType,
          customerId: input.customerId,
          branchId,
          date,
          subtotal: 0,
          discount: input.discount,
          tax: input.tax,
          totalAmount: 0,
          paidAmount: input.paidAmount,
          remainingAmount: 0,
          previousBalance,
          finalBalance: previousBalance,
          paymentType: input.paymentType ?? PaymentType.CREDIT,
          createdBy,
        },
      })
    : await tx.invoice.create({
        data: {
          invoiceNumber,
          type: invoiceType,
          customerId: input.customerId,
          branchId,
          date,
          subtotal: 0,
          discount: input.discount,
          tax: input.tax,
          totalAmount: 0,
          paidAmount: input.paidAmount,
          remainingAmount: 0,
          previousBalance,
          finalBalance: previousBalance,
          paymentType: input.paymentType ?? PaymentType.CREDIT,
          createdBy,
        },
      });

  let subtotal = 0;

  for (const item of input.items) {
    const pricedItem = await applyStockMovement(tx, invoice.id, item, invoiceType, branchId);
    subtotal += pricedItem.totalPrice;

    await tx.invoiceItem.create({
      data: {
        invoiceId: invoice.id,
        productId: pricedItem.product.id,
        productName: pricedItem.product.name,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: pricedItem.unitPrice,
        totalPrice: pricedItem.totalPrice,
      },
    });
  }

  const totalAmount = subtotal - input.discount + input.tax;
  if (totalAmount < 0) {
    throw new AppError(
      "Invoice discount cannot be greater than subtotal plus tax",
      400,
      "INVALID_INVOICE_TOTAL"
    );
  }

  const paidAmount = input.paidAmount;
  const remainingAmount = totalAmount - paidAmount; // FIXED: allow negative balance when the customer overpays.
  const paymentType =
    input.paymentType ??
    (remainingAmount <= 0
      ? PaymentType.CASH
      : paidAmount > 0
        ? PaymentType.PARTIAL
        : PaymentType.CREDIT);

  // finalBalance from our perspective: SALE adds remaining to what the customer owes,
  // PURCHASE subtracts (because the supplier now owes us less / we owe them more).
  const balanceDelta = invoiceType === InvoiceType.PURCHASE ? -remainingAmount : remainingAmount;

  const updatedInvoice = await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      subtotal,
      totalAmount,
      paidAmount,
      remainingAmount,
      previousBalance,
      finalBalance: previousBalance + balanceDelta,
      paymentType,
      createdBy,
      branchId,
    },
    include: {
      customer: true,
      items: true,
      creator: {
        select: { id: true, name: true, username: true, role: true },
      },
    },
  });

  await recalculateCustomerBalanceInTransaction(tx, input.customerId);

  return serializeInvoice(updatedInvoice);
}

export async function listInvoices(query: ListInvoicesQuery) {
  const dateFilter = getDateFilter(query.from, query.to);
  const where: Prisma.InvoiceWhereInput = {
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.branchId ? { branchId: query.branchId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.paymentType ? { paymentType: query.paymentType } : {}),
    ...(dateFilter ? { date: dateFilter } : {}),
  };
  const skip = (query.page - 1) * query.limit;

  const [total, invoices] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
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
    data: invoices.map(serializeInvoice),
    pagination: {
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.ceil(total / query.limit),
    },
  };
}

export async function getInvoiceById(id: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      customer: true,
      items: {
        include: { product: true },
      },
      stockMovements: true,
      creator: {
        select: { id: true, name: true, username: true, role: true },
      },
    },
  });

  if (!invoice) {
    throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
  }

  return serializeInvoice(invoice);
}

export async function createInvoice(
  input: CreateInvoiceInput,
  createdBy: string,
  db?: Db
) {
  if (db) {
    return createInvoiceInTransaction(db, input, createdBy);
  }

  return prisma.$transaction((tx) =>
    createInvoiceInTransaction(tx, input, createdBy)
  );
}

async function updateInvoiceInTransaction(
  tx: Db,
  id: string,
  input: CreateInvoiceInput,
  updatedBy: string
) {
    const invoice = await tx.invoice.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!invoice) {
      throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
    }

    if (invoice.status !== InvoiceStatus.ACTIVE) {
      throw new AppError("Only active invoices can be updated", 400, "INVOICE_CLOSED");
    }

    await lockCustomer(tx, invoice.customerId);

    await tx.invoice.update({
      where: { id },
      data: {
        subtotal: 0,
        totalAmount: 0,
        paidAmount: 0,
        remainingAmount: 0,
        finalBalance: invoice.previousBalance,
      },
    });
    await recalculateCustomerBalanceInTransaction(tx, invoice.customerId);
    await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
    await restoreInvoiceStock(tx, id);
    // Delete ALL movements for this invoice (original + the restore movements just created),
    // so createInvoiceInTransaction starts with a clean slate.
    await tx.stockMovement.deleteMany({ where: { invoiceId: id } });

    // Preserve the original invoice type if the caller didn't explicitly set one.
    return createInvoiceInTransaction(
      tx,
      { ...input, type: input.type ?? invoice.type, customerId: invoice.customerId },
      updatedBy,
      id,
      invoice.invoiceNumber
    );
}

export async function updateInvoice(
  id: string,
  input: CreateInvoiceInput,
  updatedBy: string,
  db?: Db
) {
  if (db) {
    return updateInvoiceInTransaction(db, id, input, updatedBy);
  }

  return prisma.$transaction((tx) =>
    updateInvoiceInTransaction(tx, id, input, updatedBy)
  );
}

async function cancelInvoiceInTransaction(tx: Db, id: string) {
    const invoice = await tx.invoice.findUnique({ where: { id } });

    if (!invoice) {
      throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new AppError("Invoice is already cancelled", 400, "INVOICE_CANCELLED");
    }

    await lockCustomer(tx, invoice.customerId);
    await restoreInvoiceStock(tx, id);

    const cancelled = await tx.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED },
      include: {
        customer: true,
        items: true,
      },
    });

    await recalculateCustomerBalanceInTransaction(tx, invoice.customerId); // FIXED

    return serializeInvoice(cancelled);
}

export async function cancelInvoice(id: string, db?: Db) {
  if (db) {
    return cancelInvoiceInTransaction(db, id);
  }

  return prisma.$transaction((tx) => cancelInvoiceInTransaction(tx, id));
}
