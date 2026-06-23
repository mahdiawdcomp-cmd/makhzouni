import { createHash, randomBytes } from "crypto";
import prisma from "../config/database";
import { getCustomerTransactions } from "./customer.service";
import { AppError } from "../utils/app-error";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function makeToken() {
  return `cpl_${randomBytes(32).toString("base64url")}`;
}

export async function createCustomerPortalLink(customerId: string, expiresInDays = 30) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, name: true, phone: true },
  });

  if (!customer) {
    throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  }

  const token = makeToken();
  const tokenHash = hashToken(token);
  const expiresAt =
    expiresInDays > 0
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  const link = await prisma.customerPortalLink.create({
    data: { token, tokenHash, customerId, expiresAt },
    select: { id: true, customerId: true, expiresAt: true, revokedAt: true },
  });

  return {
    token,
    urlPath: `/client/${token}`,
    expiresAt: link.expiresAt ?? null,
    customer,
  };
}

export async function revokeCustomerPortalLinks(customerId: string) {
  await prisma.customerPortalLink.updateMany({
    where: { customerId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getCustomerPortalByToken(token: string) {
  const tokenHash = hashToken(token);
  const link = await prisma.customerPortalLink.findUnique({
    where: { tokenHash },
    select: { id: true, customerId: true, expiresAt: true, revokedAt: true },
  });

  if (!link || link.revokedAt || (link.expiresAt && link.expiresAt.getTime() < Date.now())) {
    throw new AppError("Client link is invalid or expired", 404, "PORTAL_LINK_INVALID");
  }

  await prisma.customerPortalLink.update({
    where: { id: link.id },
    data: { lastViewedAt: new Date() },
  });

  const [customer, statement] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: link.customerId, deletedAt: null },
      select: {
        id: true,
        name: true,
        phone: true,
        openingBalance: true,
        currentBalance: true,
        lastTransactionAt: true,
      },
    }),
    getCustomerTransactions(link.customerId, { all: true }),
  ]);

  if (!customer) {
    throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  }

  return {
    customer: {
      ...customer,
      openingBalance: Number(customer.openingBalance),
      currentBalance: Number(customer.currentBalance),
    },
    transactions: statement.transactions,
    expiresAt: link.expiresAt,
  };
}

export async function getPublicInvoiceByToken(token: string, invoiceId: string) {
  const tokenHash = hashToken(token);
  const link = await prisma.customerPortalLink.findUnique({
    where: { tokenHash },
    select: { id: true, customerId: true, expiresAt: true, revokedAt: true },
  });

  if (!link || link.revokedAt || (link.expiresAt && link.expiresAt.getTime() < Date.now())) {
    throw new AppError("Client link is invalid or expired", 404, "PORTAL_LINK_INVALID");
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, customerId: link.customerId },
    include: {
      items: { include: { product: { select: { id: true, name: true, itemNumber: true } } } },
    },
  });

  if (!invoice) {
    throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
  }

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    date: invoice.date,
    type: invoice.type,
    status: invoice.status,
    paymentType: invoice.paymentType,
    totalAmount: Number(invoice.totalAmount),
    paidAmount: Number(invoice.paidAmount),
    remainingAmount: Number(invoice.remainingAmount),
    discount: Number(invoice.discount),
    items: invoice.items.map((item) => ({
      id: item.id,
      productName: item.product?.name ?? item.productId,
      itemNumber: item.product?.itemNumber ?? null,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      totalPrice: Number(item.totalPrice),
      unit: item.unit,
    })),
  };
}
