import { Unit } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { approvalRequestTypes, createPendingApproval } from "./approval.service";
import { isVerified } from "./otp.service";
import {
  notifyCatalogAccessRequested,
  notifyCatalogOrderSubmitted,
} from "./order-preparation.service";

type CatalogOrderInput = {
  customerName: string;
  phone: string;
  address?: string;
  notes?: string;
  items: Array<{
    productId: string;
    unit: Unit;
    quantity: number;
  }>;
};

type CatalogAccessInput = {
  customerName: string;
  phone: string;
  address?: string;
  notes?: string;
};

export type CatalogCustomerRow = {
  id: string;
  name: string;
  phone: string;
  hasAccess: boolean;
  allowPrices: boolean;
  showStock: boolean;
  token: string | null;
  lastViewedAt: Date | null;
  createdAt: Date | null;
  catalogLinkSentAt: Date | null;
};

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function stockOf(product: { openingBalancePcs: number; cartonsAvailable: number; pcsPerCarton: number }) {
  return product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton;
}

function piecesFor(unit: Unit, quantity: number, pcsPerCarton: number) {
  if (unit === Unit.CARTON) return quantity * pcsPerCarton;
  if (unit === Unit.DOZEN) return quantity * 12;
  return quantity;
}

function salePriceFor(unit: Unit, salePrice: unknown, pcsPerCarton: number) {
  const price = toNumber(salePrice);
  if (unit === Unit.CARTON) return price * pcsPerCarton;
  if (unit === Unit.DOZEN) return price * 12;
  return price;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function makeToken() {
  return `cat_${randomBytes(32).toString("base64url")}`;
}

function normalizePhone(input: string) {
  let digits = input.replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("964")) return digits;
  if (digits.startsWith("0")) return `964${digits.slice(1)}`;
  if (digits.startsWith("7")) return `964${digits}`;
  return digits;
}

async function findApprovalRequester() {
  const requester = await prisma.user.findFirst({
    where: { isActive: true },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  if (!requester) {
    throw new AppError("No active user exists to own catalog approvals", 500, "NO_APPROVAL_REQUESTER");
  }
  return requester;
}

export async function createCatalogAccessLink(
  customerId: string,
  allowPrices: boolean,
  showStock = true,
) {
  // Revoke existing links
  await prisma.catalogAccessLink.updateMany({
    where: { customerId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const token = makeToken();
  const tokenHash = hashToken(token);
  await prisma.catalogAccessLink.create({
    data: { token, tokenHash, customerId, allowPrices, showStock },
  });

  return { token, urlPath: `/catalog?access=${token}`, allowPrices, showStock };
}

export async function updateCatalogAccessLink(
  customerId: string,
  patch: { allowPrices?: boolean; showStock?: boolean },
) {
  const link = await prisma.catalogAccessLink.findFirst({
    where: { customerId, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!link) throw new AppError("No active catalog link found", 404, "CATALOG_LINK_NOT_FOUND");

  const newAllowPrices = patch.allowPrices ?? link.allowPrices;
  const newShowStock = patch.showStock ?? link.showStock;

  await prisma.catalogAccessLink.update({
    where: { id: link.id },
    data: { allowPrices: newAllowPrices, showStock: newShowStock },
  });

  return { allowPrices: newAllowPrices, showStock: newShowStock, token: link.token };
}

export async function revokeCatalogAccess(customerId: string) {
  await prisma.catalogAccessLink.updateMany({
    where: { customerId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function listCustomersWithCatalogStatus(): Promise<CatalogCustomerRow[]> {
  const [customers, links] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, phone: true, catalogLinkSentAt: true },
      orderBy: { name: "asc" },
    }),
    prisma.catalogAccessLink.findMany({
      where: { revokedAt: null },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Keep only the most recent active link per customer
  const linkByCustomer = new Map<string, typeof links[0]>();
  for (const link of links) {
    if (!linkByCustomer.has(link.customerId)) {
      linkByCustomer.set(link.customerId, link);
    }
  }

  return customers.map((c) => {
    const link = linkByCustomer.get(c.id);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      hasAccess: !!link,
      allowPrices: link?.allowPrices ?? false,
      showStock: link?.showStock ?? true,
      token: link?.token ?? null,
      lastViewedAt: link?.lastViewedAt ?? null,
      createdAt: link?.createdAt ?? null,
      catalogLinkSentAt: c.catalogLinkSentAt,
    };
  });
}

export async function requestCatalogAccess(input: CatalogAccessInput) {
  const phone = normalizePhone(input.phone);

  if (!isVerified(phone)) {
    throw new AppError("رقم الهاتف غير مُتحقق منه. أرسل رمز OTP أولاً.", 403, "PHONE_NOT_VERIFIED");
  }

  const existingCustomer = await prisma.customer.findUnique({
    where: { phone },
    select: { id: true, name: true },
  });
  const isExistingCustomer = Boolean(existingCustomer);
  const customerName = existingCustomer ? existingCustomer.name : input.customerName.trim();

  const requester = await findApprovalRequester();
  const approval = await createPendingApproval(
    approvalRequestTypes.CATALOG_ACCESS,
    {
      source: "PUBLIC_CATALOG_ACCESS",
      customerName,
      phone,
      originalPhone: input.phone,
      address: input.address,
      notes: input.notes,
      allowPrices: false,
      isExistingCustomer,
      existingCustomerId: existingCustomer?.id ?? null,
      body: { customerName, phone, address: input.address, notes: input.notes },
    },
    requester.id
  );

  setImmediate(() => {
    notifyCatalogAccessRequested(customerName, phone, input.address, input.notes)
      .catch((err) => console.error("[CatalogAccess] request notify failed:", err));
  });

  return { approvalId: approval.id };
}

export async function lookupCatalogAccess(phone: string) {
  const normalizedPhone = normalizePhone(phone);
  const customer = await prisma.customer.findUnique({
    where: { phone: normalizedPhone },
    select: { id: true, name: true, phone: true },
  });

  if (!customer) return { approved: false };

  const link = await prisma.catalogAccessLink.findFirst({
    where: { customerId: customer.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { token: true, allowPrices: true, showStock: true },
  });

  if (!link) return { approved: false };

  return {
    approved: true,
    customer: { id: customer.id, name: customer.name, phone: customer.phone },
    token: link.token,
    urlPath: `/catalog?access=${link.token}`,
    allowPrices: link.allowPrices,
    showStock: link.showStock,
  };
}

export async function getCatalogAccess(token: string) {
  const tokenHash = hashToken(token);
  const link = await prisma.catalogAccessLink.findUnique({
    where: { tokenHash },
    select: { id: true, token: true, customerId: true, allowPrices: true, showStock: true, revokedAt: true },
  });

  if (!link || link.revokedAt) {
    throw new AppError("Catalog access is invalid", 404, "CATALOG_ACCESS_INVALID");
  }

  await prisma.catalogAccessLink.update({
    where: { id: link.id },
    data: { lastViewedAt: new Date() },
  });

  const customer = await prisma.customer.findFirst({
    where: { id: link.customerId, deletedAt: null },
    select: { id: true, name: true, phone: true },
  });

  if (!customer) {
    throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  }

  return { customer, allowPrices: link.allowPrices, showStock: link.showStock };
}

export async function listCatalogProducts(token: string) {
  const access = await getCatalogAccess(token);
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  return products
    .map((product) => {
      const stock = stockOf(product);
      return {
        id: product.id,
        itemNumber: product.itemNumber,
        name: product.name,
        imageUrl: product.imageUrl,
        category: product.category,
        categoryTags: product.categoryTags as string[],
        typeTags: product.typeTags as string[],
        isNewArrival: product.isNewArrival,
        isOffer: product.isOffer,
        oldPrice: access.allowPrices && product.oldPrice != null ? toNumber(product.oldPrice) : null,
        createdAt: product.createdAt,
        salePrice: access.allowPrices ? toNumber(product.salePrice) : null,
        pcsPerCarton: product.pcsPerCarton,
        currentStock: stock,
        showStock: access.showStock,
      };
    })
    .filter((product) => product.currentStock > 0);
}

export async function submitCatalogOrder(input: CatalogOrderInput, token: string) {
  const access = await getCatalogAccess(token);
  const uniqueProductIds = [...new Set(input.items.map((item) => item.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: uniqueProductIds }, deletedAt: null },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const requestedPiecesByProduct = new Map<string, number>();

  for (const item of input.items) {
    const product = productById.get(item.productId);
    if (!product) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
    const requestedPieces = piecesFor(item.unit, item.quantity, product.pcsPerCarton);
    requestedPiecesByProduct.set(product.id, (requestedPiecesByProduct.get(product.id) ?? 0) + requestedPieces);
  }

  for (const product of products) {
    if ((requestedPiecesByProduct.get(product.id) ?? 0) > stockOf(product)) {
      throw new AppError("Product stock is not enough", 400, "CATALOG_STOCK_NOT_ENOUGH");
    }
  }

  const normalizedItems = input.items.map((item) => {
    const product = productById.get(item.productId);
    if (!product) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
    const available = stockOf(product);
    if (available <= 0) throw new AppError("Product stock is not enough", 400, "CATALOG_STOCK_NOT_ENOUGH");
    const unitPrice = salePriceFor(item.unit, product.salePrice, product.pcsPerCarton);
    return {
      productId: product.id,
      productName: product.name,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice,
      totalPrice: unitPrice * item.quantity,
      availableStock: available,
    };
  });

  const invoiceCount = await prisma.invoice.count({
    where: { customerId: access.customer.id, status: "ACTIVE" },
  });
  const isFirstOrder = invoiceCount === 0;

  const requester = await findApprovalRequester();
  const approval = await createPendingApproval(
    approvalRequestTypes.CATALOG_ORDER,
    {
      source: "PUBLIC_CATALOG",
      customerName: access.customer.name,
      phone: access.customer.phone,
      customerId: access.customer.id,
      isFirstOrder,
      address: input.address,
      notes: input.notes,
      subtotal: normalizedItems.reduce((sum, item) => sum + item.totalPrice, 0),
      body: {
        customerName: access.customer.name,
        phone: access.customer.phone,
        address: input.address,
        notes: input.notes,
        items: normalizedItems.map((item) => ({
          productId: item.productId,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      },
      displayItems: normalizedItems,
    },
    requester.id
  );

  setImmediate(() => {
    notifyCatalogOrderSubmitted(
      access.customer.name,
      access.customer.phone,
      normalizedItems.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      })),
    ).catch((err) => console.error("[CatalogOrder] submit notify failed:", err));
  });

  return { approvalId: approval.id };
}
