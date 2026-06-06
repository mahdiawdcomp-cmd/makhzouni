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
  clientRequestId?: string;
  couponCode?: string;
  originalInvoiceId?: string;
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

function isStockInflow(type: InvoiceType) {
  return type === InvoiceType.PURCHASE || type === InvoiceType.SALES_RETURN;
}

function isCustomerCreditInvoice(type: InvoiceType) {
  return type === InvoiceType.PURCHASE || type === InvoiceType.SALES_RETURN;
}

function productStock(product: {
  openingBalancePcs: number;
  cartonsAvailable: number;
  pcsPerCarton: number;
}) {
  return product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton;
}

function normalizeStock(balanceInPieces: number, pcsPerCarton: number) {
  if (balanceInPieces < 0) {
    return { openingBalancePcs: balanceInPieces, cartonsAvailable: 0 };
  }

  if (pcsPerCarton <= 0) {
    return { openingBalancePcs: balanceInPieces, cartonsAvailable: 0 };
  }

  const cartonsAvailable = Math.floor(balanceInPieces / pcsPerCarton);
  return {
    openingBalancePcs: balanceInPieces - cartonsAvailable * pcsPerCarton,
    cartonsAvailable,
  };
}

function openingBalanceForStock(
  desiredStock: number,
  product: { cartonsAvailable: number; pcsPerCarton: number }
) {
  return desiredStock - product.cartonsAvailable * product.pcsPerCarton;
}

async function couponDiscount(
  tx: Db,
  code: string | undefined,
  subtotal: number
) {
  const normalizedCode = code?.trim().toUpperCase();
  if (!normalizedCode) return { couponId: null as string | null, discount: 0 };

  const coupon = await tx.coupon.findUnique({
    where: { code: normalizedCode },
    include: { _count: { select: { redemptions: true } } },
  });

  const now = new Date();
  if (!coupon || !coupon.isActive) {
    throw new AppError("Coupon is not active", 400, "COUPON_INACTIVE");
  }
  if (coupon.startsAt && coupon.startsAt > now) {
    throw new AppError("Coupon has not started yet", 400, "COUPON_NOT_STARTED");
  }
  if (coupon.endsAt && coupon.endsAt < now) {
    throw new AppError("Coupon has expired", 400, "COUPON_EXPIRED");
  }
  if (coupon.maxUses !== null && coupon._count.redemptions >= coupon.maxUses) {
    throw new AppError("Coupon usage limit reached", 400, "COUPON_LIMIT_REACHED");
  }

  const raw =
    coupon.discountType === "PERCENT"
      ? subtotal * (toNumber(coupon.discountValue) / 100)
      : toNumber(coupon.discountValue);

  return {
    couponId: coupon.id,
    discount: Math.min(subtotal, Math.max(0, raw)),
  };
}

async function generateInvoiceNumber(tx: Db, date: Date) {
  const year = date.getFullYear();
  const counterKey = `invoice-${year}`;

  // Atomic increment using the Counter table — avoids text-sort race condition
  // that would fail after 9999 invoices/year.
  for (let attempt = 0; attempt < 50; attempt++) {
    const counter = await tx.counter.upsert({
      where: { key: counterKey },
      update: { value: { increment: 1 } },
      create: { key: counterKey, value: 1 },
    });
    const candidate = `INV-${year}-${String(counter.value).padStart(4, "0")}`;
    const exists = await tx.invoice.findUnique({
      where: { invoiceNumber: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }

  throw new AppError("Could not generate a unique invoice number", 409, "INVOICE_NUMBER_CONFLICT");
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

  const [saleTotals, creditInvoiceTotals, receiptTotals, paymentTotals, lastInvoice, lastVoucher] = await Promise.all([
    tx.invoice.aggregate({
      where: { customerId, status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE },
      _sum: { remainingAmount: true },
    }),
    tx.invoice.aggregate({
      where: { customerId, status: InvoiceStatus.ACTIVE, type: { in: [InvoiceType.PURCHASE, InvoiceType.SALES_RETURN] } },
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
    toNumber(creditInvoiceTotals._sum.remainingAmount) -
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
  const addsStock = isStockInflow(invoiceType);
  // PURCHASE and SALES_RETURN add stock; SALE subtracts.
  // Negative balanceAfter is allowed — the product will show negative stock as a warning.
  const balanceAfter = addsStock ? balanceBefore + quantityInPieces : balanceBefore - quantityInPieces;

  // Normalize carton / piece split so the display always reflects reality.
  // If stock is negative we keep cartonsAvailable = 0 and openingBalancePcs carries the deficit.
  const normalized = normalizeStock(balanceAfter, product.pcsPerCarton);

  await tx.product.update({
    where: { id: product.id },
    data: {
      openingBalancePcs: normalized.openingBalancePcs,
      cartonsAvailable: normalized.cartonsAvailable,
    },
  });

  await tx.stockMovement.create({
    data: {
      productId: product.id,
      branchId,
      invoiceId,
      type: addsStock ? StockMovementType.IN : StockMovementType.OUT,
      quantity: quantityInPieces,
      balanceBefore,
      balanceAfter,
    },
  });

  // Default unit price: SALE/SALES_RETURN use sale price; PURCHASE uses purchase price.
  const defaultPriceSource = invoiceType === InvoiceType.PURCHASE ? product.purchasePrice : product.salePrice;
  const unitPrice =
    item.unitPrice ?? defaultUnitPrice(item.unit, defaultPriceSource, product.pcsPerCarton);

  return {
    product,
    quantityInPieces,
    unitPrice,
    totalPrice: unitPrice * item.quantity,
  };
}

async function adjustProductStock(
  tx: Db,
  productId: string,
  quantityInPieces: number,
  direction: "IN" | "OUT"
) {
  const product = await tx.product.findUnique({
    where: { id: productId },
  });

  if (!product) return;

  const balanceBefore = productStock(product);
  const balanceAfter =
    direction === "IN" ? balanceBefore + quantityInPieces : balanceBefore - quantityInPieces;

  const normalized = normalizeStock(balanceAfter, product.pcsPerCarton);

  await tx.product.update({
    where: { id: product.id },
    data: {
      openingBalancePcs: normalized.openingBalancePcs,
      cartonsAvailable: normalized.cartonsAvailable,
    },
  });
}

async function reverseInvoiceItemsStock(tx: Db, invoiceId: string) {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: {
        include: { product: true },
      },
    },
  });

  if (!invoice) {
    throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
  }

  for (const item of invoice.items) {
    const quantityInPieces = unitToPieces(item.unit, item.quantity, item.product.pcsPerCarton);
    await adjustProductStock(
      tx,
      item.productId,
      quantityInPieces,
      isStockInflow(invoice.type) ? "OUT" : "IN"
    );
  }

  await tx.stockMovement.deleteMany({ where: { invoiceId } });
}

async function applyInvoiceItemsStock(tx: Db, invoiceId: string) {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: true },
  });

  if (!invoice) {
    throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
  }

  await tx.stockMovement.deleteMany({ where: { invoiceId } });

  for (const item of invoice.items) {
    await applyStockMovement(
      tx,
      invoice.id,
      {
        productId: item.productId,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: toNumber(item.unitPrice),
      },
      invoice.type,
      invoice.branchId
    );
  }
}

async function recalculateInvoiceBalances(tx: Db, invoiceId: string) {
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });

  if (!invoice) {
    throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
  }

  const { previousBalance } = await getCustomerBalance(tx, invoice.customerId);
  const balanceDelta = isCustomerCreditInvoice(invoice.type)
    ? -toNumber(invoice.remainingAmount)
    : toNumber(invoice.remainingAmount);

  const updated = await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      previousBalance,
      finalBalance: previousBalance + balanceDelta,
    },
    include: {
      customer: true,
      items: true,
      creator: {
        select: { id: true, name: true, username: true, role: true },
      },
    },
  });

  await recalculateCustomerBalanceInTransaction(tx, invoice.customerId);

  return serializeInvoice(updated);
}

async function createInvoiceInTransaction(
  tx: Db,
  input: CreateInvoiceInput,
  createdBy: string,
  existingInvoiceId?: string,
  existingInvoiceNumber?: string
) {
  const invoiceType = input.type ?? InvoiceType.SALE;
  const existingInvoice = existingInvoiceId
    ? await tx.invoice.findUnique({ where: { id: existingInvoiceId }, select: { date: true } })
    : null;
  const date = existingInvoice?.date ?? new Date();
  const manualDiscount = input.discount ?? 0;
  const tax = input.tax ?? 0;

  if (!existingInvoiceId && input.clientRequestId) {
    const existing = await tx.invoice.findUnique({
      where: { clientRequestId: input.clientRequestId },
      include: {
        customer: true,
        items: true,
        creator: {
          select: { id: true, name: true, username: true, role: true },
        },
      },
    });

    if (existing) {
      return serializeInvoice(existing);
    }
  }

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
          discount: manualDiscount,
          tax,
          totalAmount: 0,
          paidAmount: input.paidAmount,
          remainingAmount: 0,
          previousBalance,
          finalBalance: previousBalance,
          paymentType: input.paymentType ?? PaymentType.CREDIT,
          couponId: null,
          originalInvoiceId: input.originalInvoiceId,
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
          discount: manualDiscount,
          tax,
          totalAmount: 0,
          paidAmount: input.paidAmount,
          remainingAmount: 0,
          previousBalance,
          finalBalance: previousBalance,
          paymentType: input.paymentType ?? PaymentType.CREDIT,
          clientRequestId: input.clientRequestId,
          originalInvoiceId: input.originalInvoiceId,
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

  const coupon = await couponDiscount(tx, input.couponCode, subtotal);
  const discount = coupon.couponId ? coupon.discount : manualDiscount;
  const totalAmount = subtotal - discount + tax;
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
  const balanceDelta = isCustomerCreditInvoice(invoiceType) ? -remainingAmount : remainingAmount;

  const updatedInvoice = await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      subtotal,
      discount,
      totalAmount,
      paidAmount,
      remainingAmount,
      previousBalance,
      finalBalance: previousBalance + balanceDelta,
      paymentType,
      branchId,
      couponId: coupon.couponId,
      ...(existingInvoiceId ? {} : { createdBy }),
    },
    include: {
      customer: true,
      items: true,
      creator: {
        select: { id: true, name: true, username: true, role: true },
      },
    },
  });

  await tx.couponRedemption.deleteMany({ where: { invoiceId: invoice.id } });
  if (coupon.couponId && discount > 0) {
    await tx.couponRedemption.create({
      data: {
        couponId: coupon.couponId,
        invoiceId: invoice.id,
        customerId: input.customerId,
        amount: discount,
      },
    });
  }

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

export async function getLastSoldPrice(customerId: string, productId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: {
      customerId,
      type: InvoiceType.SALE,
      status: InvoiceStatus.ACTIVE,
      items: { some: { productId } },
    },
    include: {
      items: { where: { productId }, take: 1 },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  const item = invoice?.items[0];

  return invoice && item
    ? {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        date: invoice.date,
        unit: item.unit,
        unitPrice: toNumber(item.unitPrice),
      }
    : null;
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
    await reverseInvoiceItemsStock(tx, id);
    await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });

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
    await reverseInvoiceItemsStock(tx, id);

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

async function reactivateInvoiceInTransaction(tx: Db, id: string) {
    const invoice = await tx.invoice.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!invoice) {
      throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
    }

    if (invoice.status === InvoiceStatus.ACTIVE) {
      throw new AppError("Invoice is already active", 400, "INVOICE_ACTIVE");
    }

    await lockCustomer(tx, invoice.customerId);
    await applyInvoiceItemsStock(tx, id);

    await tx.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.ACTIVE },
    });

    return recalculateInvoiceBalances(tx, id);
}

export async function reactivateInvoice(id: string, db?: Db) {
  if (db) {
    return reactivateInvoiceInTransaction(db, id);
  }

  return prisma.$transaction((tx) => reactivateInvoiceInTransaction(tx, id));
}
