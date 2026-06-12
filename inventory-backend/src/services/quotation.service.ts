import { Prisma, QuotationStatus } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { roundMoney } from "../utils/financial";
import { createInvoice } from "./invoice.service";

type Db = Prisma.TransactionClient | typeof prisma;

type QuotationInput = {
  customerId: string;
  discount: number;
  expiresAt?: string;
  notes?: string;
  items: Array<{
    productId: string;
    unit: "PIECE" | "DOZEN" | "CARTON";
    quantity: number;
    unitPrice?: number;
  }>;
};

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function unitPriceFor(product: { salePrice: unknown; pcsPerCarton: number }, unit: string) {
  const price = toNumber(product.salePrice);
  if (unit === "CARTON") return roundMoney(price * product.pcsPerCarton);
  if (unit === "DOZEN") return roundMoney(price * 12);
  return roundMoney(price);
}

function serialize(q: any) {
  return {
    ...q,
    subtotal: toNumber(q.subtotal),
    discount: toNumber(q.discount),
    totalAmount: toNumber(q.totalAmount),
    items: q.items?.map((item: any) => ({
      ...item,
      unitPrice: toNumber(item.unitPrice),
      totalPrice: toNumber(item.totalPrice),
    })),
  };
}

async function generateQuotationNumber(db: Db) {
  const year = new Date().getFullYear();
  const counterKey = `quotation-${year}`;

  for (let attempt = 0; attempt < 50; attempt++) {
    const counter = await db.counter.upsert({
      where: { key: counterKey },
      update: { value: { increment: 1 } },
      create: { key: counterKey, value: 1 },
    });
    const candidate = `QUO-${year}-${String(counter.value).padStart(4, "0")}`;
    const exists = await db.quotation.findUnique({
      where: { quotationNumber: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }

  throw new AppError("Could not generate a unique quotation number", 409, "QUOTATION_NUMBER_CONFLICT");
}

export async function listQuotations(query: { customerId?: string; status?: QuotationStatus; page?: number; limit?: number }) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const where: Prisma.QuotationWhereInput = {
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.quotation.count({ where }),
    prisma.quotation.findMany({
      where,
      include: { customer: true, creator: { select: { id: true, name: true, username: true, role: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return { data: rows.map(serialize), pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
}

export async function getQuotation(id: string) {
  const quotation = await prisma.quotation.findUnique({
    where: { id },
    include: { customer: true, items: true, invoice: true, creator: { select: { id: true, name: true, username: true, role: true } } },
  });
  if (!quotation) throw new AppError("Quotation not found", 404, "QUOTATION_NOT_FOUND");
  return serialize(quotation);
}

export async function createQuotation(input: QuotationInput, userId: string) {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, deletedAt: null } });
    if (!customer) throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");

    const quotationNumber = await generateQuotationNumber(tx);
    const quotation = await tx.quotation.create({
      data: {
        quotationNumber,
        customerId: input.customerId,
        discount: input.discount,
        subtotal: 0,
        totalAmount: 0,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        notes: input.notes,
        createdBy: userId,
      },
    });

    let subtotal = 0;
    for (const item of input.items) {
      const product = await tx.product.findFirst({ where: { id: item.productId, deletedAt: null } });
      if (!product) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
      const unitPrice = roundMoney(item.unitPrice ?? unitPriceFor(product, item.unit));
      const totalPrice = roundMoney(unitPrice * item.quantity);
      subtotal = roundMoney(subtotal + totalPrice);
      await tx.quotationItem.create({
        data: {
          quotationId: quotation.id,
          productId: product.id,
          productName: product.name,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice,
          totalPrice,
        },
      });
    }

    const totalAmount = roundMoney(subtotal - input.discount);
    if (totalAmount < 0) throw new AppError("Quotation discount cannot exceed subtotal", 400, "INVALID_QUOTATION_TOTAL");
    await tx.quotation.update({
      where: { id: quotation.id },
      data: { subtotal, totalAmount },
    });
    const saved = await tx.quotation.findUnique({
      where: { id: quotation.id },
      include: { customer: true, items: true, creator: { select: { id: true, name: true, username: true, role: true } } },
    });
    return serialize(saved);
  });
}

export async function updateQuotationStatus(id: string, status: "ACCEPTED" | "REJECTED" | "EXPIRED") {
  const quotation = await prisma.quotation.update({ where: { id }, data: { status } });
  return serialize(quotation);
}

export async function convertQuotationToInvoice(id: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const quotation = await tx.quotation.findUnique({ where: { id }, include: { items: true } });
    if (!quotation) throw new AppError("Quotation not found", 404, "QUOTATION_NOT_FOUND");
    if (quotation.status === QuotationStatus.CONVERTED) throw new AppError("Quotation already converted", 400, "QUOTATION_CONVERTED");
    if (quotation.status === QuotationStatus.REJECTED) throw new AppError("Rejected quotation cannot be converted", 400, "QUOTATION_REJECTED");
    if (quotation.expiresAt && quotation.expiresAt < new Date()) throw new AppError("Quotation expired", 400, "QUOTATION_EXPIRED");

    const invoice = await createInvoice(
      {
        customerId: quotation.customerId,
        type: "SALE" as any,
        discount: toNumber(quotation.discount),
        tax: 0,
        paidAmount: 0,
        paymentType: "CREDIT" as any,
        items: quotation.items.map((item) => ({
          productId: item.productId,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: toNumber(item.unitPrice),
        })),
      },
      userId,
      tx
    );

    await tx.invoice.update({ where: { id: invoice.id }, data: { sourceQuotationId: quotation.id } });
    await tx.quotation.update({ where: { id }, data: { status: QuotationStatus.CONVERTED } });
    return invoice;
  });
}
