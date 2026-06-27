import { PromoCodeType, Unit } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { approvalRequestTypes, createPendingApproval } from "./approval.service";
import { isVerified } from "./otp.service";
import {
  notifyCatalogAccessRequested,
  notifyCatalogOrderSubmitted,
} from "./order-preparation.service";
import { getSettings } from "./settings.service";

type CatalogOrderInput = {
  customerName: string;
  phone: string;
  address?: string;
  notes?: string;
  promoCode?: string;
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

type CatalogAccessRow = {
  id: string;
  token: string;
  customer_id: string;
  allow_prices: boolean;
  show_stock: boolean;
  revoked_at: Date | null;
};

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function stockOf(product: { openingBalancePcs: number; cartonsAvailable: number; pcsPerCarton: number }) {
  return product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton;
}

function piecesFor(unit: Unit, quantity: number, pcsPerCarton: number) {
  const n = Math.max(1, pcsPerCarton);
  if (unit === Unit.CARTON) return quantity * n;
  if (unit === Unit.BOX) return quantity * Math.ceil(n / 2);
  if (unit === Unit.DOZEN) return quantity * 12;
  return quantity; // PIECE
}

function salePriceFor(unit: Unit, salePrice: unknown, pcsPerCarton: number) {
  const price = toNumber(salePrice);
  const n = Math.max(1, pcsPerCarton);
  if (unit === Unit.CARTON) return price * n;
  if (unit === Unit.BOX) return price * Math.ceil(n / 2);
  if (unit === Unit.DOZEN) return price * 12;
  return price; // PIECE
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
  await prisma.$executeRaw`
    UPDATE "catalog_access_links"
    SET "revoked_at" = NOW()
    WHERE "customer_id" = ${customerId}::uuid AND "revoked_at" IS NULL
  `;

  const token = makeToken();
  const tokenHash = hashToken(token);
  await prisma.$executeRaw`
    INSERT INTO "catalog_access_links" ("token", "token_hash", "customer_id", "allow_prices", "show_stock")
    VALUES (${token}, ${tokenHash}, ${customerId}::uuid, ${allowPrices}, ${showStock})
  `;

  return {
    token,
    urlPath: `/catalog?access=${token}`,
    allowPrices,
    showStock,
  };
}

export async function updateCatalogAccessLink(
  customerId: string,
  patch: { allowPrices?: boolean; showStock?: boolean },
) {
  const rows = await prisma.$queryRaw<CatalogAccessRow[]>`
    SELECT "id", "token", "customer_id", "allow_prices", "show_stock", "revoked_at"
    FROM "catalog_access_links"
    WHERE "customer_id" = ${customerId}::uuid AND "revoked_at" IS NULL
    ORDER BY "created_at" DESC LIMIT 1
  `;
  const link = rows[0];
  if (!link) throw new AppError("No active catalog link found", 404, "CATALOG_LINK_NOT_FOUND");

  const newAllowPrices = patch.allowPrices ?? link.allow_prices;
  const newShowStock = patch.showStock ?? link.show_stock;

  await prisma.$executeRaw`
    UPDATE "catalog_access_links"
    SET "allow_prices" = ${newAllowPrices}, "show_stock" = ${newShowStock}
    WHERE "id" = ${link.id}::uuid
  `;

  return { allowPrices: newAllowPrices, showStock: newShowStock, token: link.token };
}

export async function revokeCatalogAccess(customerId: string) {
  await prisma.$executeRaw`
    UPDATE "catalog_access_links"
    SET "revoked_at" = NOW()
    WHERE "customer_id" = ${customerId}::uuid AND "revoked_at" IS NULL
  `;
}

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

export async function listCustomersWithCatalogStatus(opts?: {
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: CatalogCustomerRow[]; total: number }> {
  const search = opts?.search?.trim() ?? "";
  const limit = opts?.limit ?? 100;
  const offset = opts?.offset ?? 0;
  const searchPattern = `%${search}%`;

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<Array<{
      id: string;
      name: string;
      phone: string;
      token: string | null;
      allow_prices: boolean | null;
      show_stock: boolean | null;
      last_viewed_at: Date | null;
      link_created_at: Date | null;
      catalog_link_sent_at: Date | null;
    }>>`
      SELECT
        c.id, c.name, c.phone,
        c.catalog_link_sent_at,
        cal.token,
        cal.allow_prices,
        cal.show_stock,
        cal.last_viewed_at,
        cal.created_at AS link_created_at
      FROM customers c
      LEFT JOIN catalog_access_links cal
        ON cal.customer_id = c.id AND cal.revoked_at IS NULL
      WHERE c.deleted_at IS NULL
        AND (${search} = '' OR c.name ILIKE ${searchPattern} OR c.phone ILIKE ${searchPattern})
      ORDER BY c.name ASC
      LIMIT ${limit} OFFSET ${offset}
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count FROM customers c
      WHERE c.deleted_at IS NULL
        AND (${search} = '' OR c.name ILIKE ${searchPattern} OR c.phone ILIKE ${searchPattern})
    `,
  ]);

  const total = Number((countRows[0] as { count: bigint }).count);
  return {
    total,
    rows: rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      hasAccess: row.token !== null,
      allowPrices: row.allow_prices ?? false,
      showStock: row.show_stock ?? true,
      token: row.token,
      lastViewedAt: row.last_viewed_at,
      createdAt: row.link_created_at,
      catalogLinkSentAt: row.catalog_link_sent_at,
    })),
  };
}

export async function requestCatalogAccess(input: CatalogAccessInput) {
  const phone = normalizePhone(input.phone);

  // OTP must be verified before submitting
  if (!isVerified(phone)) {
    throw new AppError("رقم الهاتف غير مُتحقق منه. أرسل رمز OTP أولاً.", 403, "PHONE_NOT_VERIFIED");
  }

  // Smart customer: if phone exists in DB, use stored name (phone is the identity)
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
      body: {
        customerName,
        phone,
        address: input.address,
        notes: input.notes,
      },
    },
    requester.id
  );

  setImmediate(() => {
    notifyCatalogAccessRequested(
      customerName,
      phone,
      input.address,
      input.notes,
    ).catch((err) => console.error("[CatalogAccess] request notify failed:", err));
  });

  return { approvalId: approval.id };
}

export async function lookupCatalogAccess(phone: string) {
  const normalizedPhone = normalizePhone(phone);
  const customer = await prisma.customer.findUnique({
    where: { phone: normalizedPhone },
    select: { id: true, name: true, phone: true },
  });

  if (!customer) {
    return { approved: false };
  }

  const rows = await prisma.$queryRaw<Array<{ token: string; allow_prices: boolean; show_stock: boolean }>>`
    SELECT "token", "allow_prices", "show_stock"
    FROM "catalog_access_links"
    WHERE "customer_id" = ${customer.id}::uuid AND "revoked_at" IS NULL
    ORDER BY "created_at" DESC
    LIMIT 1
  `;
  const link = rows[0];

  if (!link) {
    return { approved: false };
  }

  return {
    approved: true,
    customer: { id: customer.id, name: customer.name, phone: customer.phone },
    token: link.token,
    urlPath: `/catalog?access=${link.token}`,
    allowPrices: link.allow_prices,
    showStock: link.show_stock,
  };
}

export async function getCatalogAccess(token: string) {
  const tokenHash = hashToken(token);
  const rows = await prisma.$queryRaw<CatalogAccessRow[]>`
    SELECT "id", "token", "customer_id", "allow_prices", "show_stock", "revoked_at"
    FROM "catalog_access_links"
    WHERE "token_hash" = ${tokenHash}
    LIMIT 1
  `;
  const link = rows[0];

  if (!link || link.revoked_at) {
    throw new AppError("Catalog access is invalid", 404, "CATALOG_ACCESS_INVALID");
  }

  await prisma.$executeRaw`
    UPDATE "catalog_access_links"
    SET "last_viewed_at" = NOW()
    WHERE "id" = ${link.id}::uuid
  `;

  const customer = await prisma.customer.findFirst({
    where: { id: link.customer_id, deletedAt: null },
    select: { id: true, name: true, phone: true },
  });

  if (!customer) {
    throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  }

  const settings = await getSettings();
  const catalogDesign = {
    primaryColor: settings.catalogDesignPrimaryColor ?? null,
    bgColor: settings.catalogDesignBgColor ?? null,
    defaultTheme: settings.catalogDesignDefaultTheme ?? "clean",
    logoUrl: settings.catalogDesignLogoUrl ?? null,
    welcomeMessage: settings.catalogDesignWelcomeMessage ?? null,
    bannerEnabled: settings.catalogDesignBannerEnabled ?? true,
    bannerImages: settings.catalogDesignBannerImages ?? [],
  };

  return {
    customer,
    allowPrices: link.allow_prices,
    showStock: link.show_stock,
    catalogDesign,
  };
}

export async function listCatalogProducts(token: string) {
  const access = await getCatalogAccess(token);
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    // The catalog list never needs the full-resolution image — sending only the
    // lightweight thumbnail keeps the payload tiny (was 2-3 min to load with all
    // full images). The full image is fetched on demand when a shopper taps to
    // zoom (see getCatalogProductImage).
    omit: { imageUrl: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  return products
    .map((product) => {
      const stock = stockOf(product);
      return {
        id: product.id,
        itemNumber: product.itemNumber,
        name: product.name,
        thumbnailUrl: product.thumbnailUrl,
        category: product.category,
        categoryTags: product.categoryTags,
        typeTags: product.typeTags,
        isNewArrival: product.isNewArrival,
        isOffer: product.isOffer,
        oldPrice: access.allowPrices && product.oldPrice != null ? toNumber(product.oldPrice) : null,
        createdAt: product.createdAt,
        salePrice: access.allowPrices ? toNumber(product.salePrice) : null,
        pcsPerCarton: product.pcsPerCarton,
        // Always send stock for cart max-quantity logic; showStock controls display only
        currentStock: stock,
        showStock: access.showStock,
      };
    })
    .filter((product) => product.currentStock > 0);
}

// Fetch the full-resolution image for a single catalog product on demand.
// Called when a shopper taps the thumbnail to zoom — keeps the list payload
// lightweight while still serving the full picture when actually needed.
export async function getCatalogProductImage(token: string, productId: string) {
  await getCatalogAccess(token); // validates access — throws if token invalid/revoked
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { imageUrl: true },
  });
  return product?.imageUrl ?? null;
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
    if (!product) {
      throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
    }
    const requestedPieces = piecesFor(item.unit, item.quantity, product.pcsPerCarton);
    requestedPiecesByProduct.set(
      product.id,
      (requestedPiecesByProduct.get(product.id) ?? 0) + requestedPieces
    );
  }

  for (const product of products) {
    if ((requestedPiecesByProduct.get(product.id) ?? 0) > stockOf(product)) {
      throw new AppError("Product stock is not enough", 400, "CATALOG_STOCK_NOT_ENOUGH");
    }
  }

  const normalizedItems = input.items.map((item) => {
    const product = productById.get(item.productId);
    if (!product) {
      throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
    }

    const available = stockOf(product);
    if (available <= 0) {
      throw new AppError("Product stock is not enough", 400, "CATALOG_STOCK_NOT_ENOUGH");
    }

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

  // Promo code
  let promoDiscount = 0;
  let promoLabel: string | undefined;
  let isFreeDelivery = false;
  const subtotal = normalizedItems.reduce((sum, item) => sum + item.totalPrice, 0);

  if (input.promoCode) {
    const promo = await validatePromoCode(input.promoCode, access.customer.id);
    if (promo.type === PromoCodeType.PERCENT) {
      promoDiscount = Math.round(subtotal * (Number(promo.value) / 100));
      promoLabel = `خصم ${promo.value}%`;
    } else if (promo.type === PromoCodeType.AMOUNT) {
      promoDiscount = Math.min(Number(promo.value), subtotal);
      promoLabel = `خصم ${Number(promo.value).toLocaleString()} د.ع`;
    } else if (promo.type === PromoCodeType.FREE_DELIVERY) {
      isFreeDelivery = true;
      promoLabel = "توصيل مجاني";
    }
    // Increment usage
    await prisma.promoCode.update({ where: { id: promo.id }, data: { usedCount: { increment: 1 } } });
  }

  // Check if this is customer's first order
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
      subtotal,
      promoCode: input.promoCode,
      promoDiscount,
      promoLabel,
      isFreeDelivery,
      finalTotal: subtotal - promoDiscount,
      body: {
        customerName: access.customer.name,
        phone: access.customer.phone,
        address: input.address,
        notes: input.notes,
        promoCode: input.promoCode,
        promoDiscount,
        isFreeDelivery,
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

  // Fire-and-forget: WhatsApp + system notification (non-blocking)
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

  return { approvalId: approval.id, promoDiscount, isFreeDelivery, finalTotal: subtotal - promoDiscount };
}

/* ── Promo Code Services ──────────────────────────────────────────── */

export async function validatePromoCode(code: string, customerId: string) {
  const promo = await prisma.promoCode.findUnique({ where: { code: code.trim().toUpperCase() } });

  if (!promo || !promo.active) throw new AppError("كود الخصم غير صحيح أو منتهي", 400, "PROMO_INVALID");
  if (promo.expiresAt && promo.expiresAt < new Date()) throw new AppError("انتهت صلاحية كود الخصم", 400, "PROMO_EXPIRED");
  if (promo.usageLimit !== null && promo.usedCount >= promo.usageLimit) throw new AppError("كود الخصم استُنفد", 400, "PROMO_EXHAUSTED");
  if (promo.customerId && promo.customerId !== customerId) throw new AppError("كود الخصم غير مخصص لهذا الحساب", 400, "PROMO_WRONG_CUSTOMER");

  return promo;
}

export async function listPromoCodes() {
  return prisma.promoCode.findMany({
    orderBy: { createdAt: "desc" },
    include: { customer: { select: { id: true, name: true, phone: true } } },
  });
}

export async function createPromoCode(input: {
  code: string;
  type: PromoCodeType;
  value?: number;
  customerId?: string;
  expiresAt?: Date;
  usageLimit?: number;
  description?: string;
}) {
  const code = input.code.trim().toUpperCase();
  const existing = await prisma.promoCode.findUnique({ where: { code } });
  if (existing) throw new AppError("كود الخصم موجود مسبقاً", 400, "PROMO_DUPLICATE");

  return prisma.promoCode.create({
    data: {
      code,
      type: input.type,
      value: input.value ?? null,
      customerId: input.customerId ?? null,
      expiresAt: input.expiresAt ?? null,
      usageLimit: input.usageLimit ?? null,
      description: input.description ?? null,
    },
    include: { customer: { select: { id: true, name: true, phone: true } } },
  });
}

export async function deletePromoCode(id: string) {
  await prisma.promoCode.delete({ where: { id } });
}

export async function togglePromoCode(id: string, active: boolean) {
  return prisma.promoCode.update({ where: { id }, data: { active } });
}
