import { CatalogStockFilter, PromoCodeType, Unit } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { approvalRequestTypes, createPendingApproval } from "./approval.service";
import { isVerified } from "./otp.service";
import { totalStock } from "../utils/product-stock";
import { effectiveBoxPieces } from "../utils/financial";
import {
  notifyCatalogAccessRequested,
  notifyCatalogOrderSubmitted,
} from "./order-preparation.service";
import { getSettings } from "./settings.service";
import { hasFeature } from "../middleware/tenant.middleware";

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
  catalog_stock_filter: CatalogStockFilter;
  revoked_at: Date | null;
  last_verified_at: Date | null;
};

// A shopper must re-verify by OTP when the last successful verification is
// missing or older than this window. The access token itself never expires.
const VERIFY_WINDOW_MS = 183 * 24 * 60 * 60 * 1000; // ~6 months

function isVerificationFresh(lastVerifiedAt: Date | null) {
  if (!lastVerifiedAt) return false;
  return Date.now() - lastVerifiedAt.getTime() < VERIFY_WINDOW_MS;
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function piecesFor(unit: Unit, quantity: number, pcsPerCarton: number, boxPieces?: number | null) {
  const n = Math.max(1, pcsPerCarton);
  if (unit === Unit.CARTON) return quantity * n;
  if (unit === Unit.BOX) return quantity * effectiveBoxPieces(n, boxPieces);
  if (unit === Unit.DOZEN) return quantity * 12;
  return quantity; // PIECE
}

function salePriceFor(unit: Unit, salePrice: unknown, pcsPerCarton: number, boxPieces?: number | null) {
  const price = toNumber(salePrice);
  const n = Math.max(1, pcsPerCarton);
  if (unit === Unit.CARTON) return price * n;
  if (unit === Unit.BOX) return price * effectiveBoxPieces(n, boxPieces);
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

// Deterministic Fisher-Yates shuffle driven by a numeric seed. Same seed → same
// order, so every shopper who loads the catalog within the same hour sees the
// identical arrangement, and it reshuffles automatically when the hour rolls.
function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = items.slice();
  let state = (seed % 2147483647) || 1;
  const next = () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Seed that changes once per hour — shared by all shoppers so the whole catalog
// reorders together on the hour.
function hourlySeed() {
  return Math.floor(Date.now() / (60 * 60 * 1000));
}

// Record a guest visit through the phone gate (guest catalog mode only). The
// phone is stored once; repeat entries just bump the visit counter + timestamp.
export async function recordGuestVisit(rawPhone: string) {
  await assertGuestCatalogEnabled();
  const phone = normalizePhone(String(rawPhone ?? ""));
  if (phone.length < 10) throw new AppError("رقم هاتف غير صالح", 400);
  await prisma.catalogVisitor.upsert({
    where: { phone },
    create: { phone },
    update: { visits: { increment: 1 }, lastSeenAt: new Date() },
  });
  return { ok: true };
}

// Admin: list of guest phone numbers that passed the gate, most recent first,
// plus the total visit count across all of them.
export async function listCatalogVisitors() {
  const visitors = await prisma.catalogVisitor.findMany({
    orderBy: { lastSeenAt: "desc" },
  });
  const totalVisits = visitors.reduce((sum, v) => sum + v.visits, 0);
  return { visitors, uniquePhones: visitors.length, totalVisits };
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
  stockFilter: CatalogStockFilter = CatalogStockFilter.FULL_CARTON_ONLY,
) {
  await prisma.$executeRaw`
    UPDATE "catalog_access_links"
    SET "revoked_at" = NOW()
    WHERE "customer_id" = ${customerId}::uuid AND "revoked_at" IS NULL
  `;

  const token = makeToken();
  const tokenHash = hashToken(token);
  await prisma.$executeRaw`
    INSERT INTO "catalog_access_links" ("token", "token_hash", "customer_id", "allow_prices", "show_stock", "catalog_stock_filter")
    VALUES (${token}, ${tokenHash}, ${customerId}::uuid, ${allowPrices}, ${showStock}, ${stockFilter}::"CatalogStockFilter")
  `;

  return {
    token,
    urlPath: `/catalog?access=${token}`,
    allowPrices,
    showStock,
    stockFilter,
  };
}

export async function updateCatalogAccessLink(
  customerId: string,
  patch: { allowPrices?: boolean; showStock?: boolean; stockFilter?: CatalogStockFilter },
) {
  const rows = await prisma.$queryRaw<CatalogAccessRow[]>`
    SELECT "id", "token", "customer_id", "allow_prices", "show_stock", "catalog_stock_filter", "revoked_at", "last_verified_at"
    FROM "catalog_access_links"
    WHERE "customer_id" = ${customerId}::uuid AND "revoked_at" IS NULL
    ORDER BY "created_at" DESC LIMIT 1
  `;
  const link = rows[0];
  if (!link) throw new AppError("No active catalog link found", 404, "CATALOG_LINK_NOT_FOUND");

  const newAllowPrices = patch.allowPrices ?? link.allow_prices;
  const newShowStock = patch.showStock ?? link.show_stock;
  const newStockFilter = patch.stockFilter ?? link.catalog_stock_filter;

  await prisma.$executeRaw`
    UPDATE "catalog_access_links"
    SET "allow_prices" = ${newAllowPrices}, "show_stock" = ${newShowStock}, "catalog_stock_filter" = ${newStockFilter}::"CatalogStockFilter"
    WHERE "id" = ${link.id}::uuid
  `;

  return { allowPrices: newAllowPrices, showStock: newShowStock, stockFilter: newStockFilter, token: link.token };
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
  stockFilter: CatalogStockFilter;
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
      catalog_stock_filter: CatalogStockFilter | null;
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
        cal.catalog_stock_filter,
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
      stockFilter: row.catalog_stock_filter ?? CatalogStockFilter.FULL_CARTON_ONLY,
      token: row.token,
      lastViewedAt: row.last_viewed_at,
      createdAt: row.link_created_at,
      catalogLinkSentAt: row.catalog_link_sent_at,
    })),
  };
}

export async function requestCatalogAccess(input: CatalogAccessInput) {
  const phone = normalizePhone(input.phone);

  // OTP must be verified before submitting — unless the merchant has turned
  // off catalog OTP entirely (guest mode), in which case anyone can request
  // access without ever receiving a WhatsApp code.
  const settings = await getSettings();
  const requireOtp = settings.catalogRequireOtp !== false;
  if (requireOtp && !isVerified(phone)) {
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

export async function getCatalogAccess(token: string, opts?: { requireVerified?: boolean }) {
  const requireVerified = opts?.requireVerified ?? true;
  const tokenHash = hashToken(token);
  const rows = await prisma.$queryRaw<CatalogAccessRow[]>`
    SELECT "id", "token", "customer_id", "allow_prices", "show_stock", "catalog_stock_filter", "revoked_at", "last_verified_at"
    FROM "catalog_access_links"
    WHERE "token_hash" = ${tokenHash}
    LIMIT 1
  `;
  const link = rows[0];

  if (!link || link.revoked_at) {
    throw new AppError("Catalog access is invalid", 404, "CATALOG_ACCESS_INVALID");
  }

  const settings = await getSettings();

  // OTP re-verification window: the token stays valid forever, but browsing
  // requires a successful OTP within the last ~6 months. Legacy links
  // (last_verified_at NULL) simply prompt for OTP once on next open.
  // catalogRequireOtp === false (merchant opt-out) skips this entirely — the
  // token itself remains the only gate. Missing/undefined always means true
  // so existing tenants keep the current behavior unchanged.
  const catalogRequireOtp = settings.catalogRequireOtp !== false;
  const needsOtp = catalogRequireOtp && !isVerificationFresh(link.last_verified_at);
  if (requireVerified && needsOtp) {
    throw new AppError("يرجى تأكيد رقم الهاتف برمز OTP للمتابعة", 403, "CATALOG_OTP_REQUIRED");
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

  const catalogDesign = {
    primaryColor: settings.catalogDesignPrimaryColor ?? null,
    bgColor: settings.catalogDesignBgColor ?? null,
    defaultTheme: settings.catalogDesignDefaultTheme ?? "clean",
    logoUrl: settings.catalogDesignLogoUrl ?? null,
    welcomeMessage: settings.catalogDesignWelcomeMessage ?? null,
    bannerEnabled: settings.catalogDesignBannerEnabled ?? true,
    bannerImages: settings.catalogDesignBannerImages ?? [],
  };

  // SaaS entitlement gates — display-time only, the stored per-link values are
  // never modified. Standalone/no-entitlements tenants always pass (hasFeature
  // fail-open). Each fallback matches this codebase's own existing default for
  // an unconfigured link, so a tenant without the paid feature just falls back
  // to the same baseline every new link already starts from.
  const [showHidePriceEnabled, showHideStockEnabled, fullCartonFilterEnabled] = await Promise.all([
    hasFeature("catalogShowHidePrice"),
    hasFeature("catalogShowHideStock"),
    hasFeature("catalogFullCartonFilter"),
  ]);
  const allowPrices = showHidePriceEnabled ? link.allow_prices : false;
  const showStock = showHideStockEnabled ? link.show_stock : true;
  // catalogFullCartonOnly is a merchant-controlled master switch (Settings):
  // when on, it overrides every per-customer stockFilter and forces
  // full-carton-only display for everyone. Off (default) leaves the existing
  // per-link configuration untouched.
  const stockFilter = settings.catalogFullCartonOnly
    ? CatalogStockFilter.FULL_CARTON_ONLY
    : fullCartonFilterEnabled
      ? (link.catalog_stock_filter ?? CatalogStockFilter.FULL_CARTON_ONLY)
      : CatalogStockFilter.FULL_CARTON_ONLY;

  return {
    customer,
    allowPrices,
    showStock,
    stockFilter,
    needsOtp,
    catalogDesign,
  };
}

// Called after the shopper passes OTP for an existing (possibly stale) access
// link: stamps last_verified_at so the 6-month window restarts. No new admin
// approval and no new link — the same token keeps working.
export async function confirmCatalogVerification(token: string) {
  const session = await getCatalogAccess(token, { requireVerified: false });

  if (!isVerified(normalizePhone(session.customer.phone))) {
    throw new AppError("رقم الهاتف غير مُتحقق منه. أرسل رمز OTP أولاً.", 403, "PHONE_NOT_VERIFIED");
  }

  const tokenHash = hashToken(token);
  await prisma.$executeRaw`
    UPDATE "catalog_access_links"
    SET "last_verified_at" = NOW()
    WHERE "token_hash" = ${tokenHash} AND "revoked_at" IS NULL
  `;

  return getCatalogAccess(token);
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
    include: { warehouseStocks: { select: { quantityPieces: true } } },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const fullCartonOnly = access.stockFilter === CatalogStockFilter.FULL_CARTON_ONLY;

  const mapped = products
    .map((product) => {
      const stock = totalStock(product);
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
        boxPieces: product.boxPieces,
        hiddenUnits: product.hiddenUnits,
        // Always send stock for cart max-quantity logic; showStock controls display only
        currentStock: stock,
        showStock: access.showStock,
      };
    })
    .filter((product) =>
      fullCartonOnly
        ? product.pcsPerCarton >= 1 && product.currentStock >= product.pcsPerCarton
        : product.currentStock > 0,
    );

  return seededShuffle(mapped, hourlySeed());
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

// Guest catalog mode: when the merchant turns off catalogRequireOtp, anyone
// with the bare /catalog link can browse and order without a phone/OTP gate.
// Prices stay hidden until the shopper requests access (still OTP-free, but
// still admin-approved) — orders placed while browsing anonymously collect
// name/phone/address at checkout instead and go to the same approval queue.
export async function isGuestCatalogEnabled() {
  const settings = await getSettings();
  return settings.catalogRequireOtp === false;
}

async function assertGuestCatalogEnabled() {
  if (!(await isGuestCatalogEnabled())) {
    throw new AppError("الدخول المفتوح للكتالوج غير مفعّل", 403, "GUEST_CATALOG_DISABLED");
  }
}

export async function listGuestCatalogProducts() {
  await assertGuestCatalogEnabled();
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    omit: { imageUrl: true },
    include: { warehouseStocks: { select: { quantityPieces: true } } },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const mapped = products
    .map((product) => {
      const stock = totalStock(product);
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
        oldPrice: null,
        createdAt: product.createdAt,
        salePrice: null, // guests never see prices — request access first
        pcsPerCarton: product.pcsPerCarton,
        boxPieces: product.boxPieces,
        hiddenUnits: product.hiddenUnits,
        currentStock: stock,
        showStock: true,
      };
    })
    .filter((product) => product.pcsPerCarton >= 1 && product.currentStock >= product.pcsPerCarton);

  return seededShuffle(mapped, hourlySeed());
}

export async function getGuestCatalogProductImage(productId: string) {
  await assertGuestCatalogEnabled();
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { imageUrl: true },
  });
  return product?.imageUrl ?? null;
}

export type GuestCatalogOrderInput = {
  customerName: string;
  phone: string;
  address?: string;
  notes?: string;
  items: Array<{ productId: string; unit: Unit; quantity: number }>;
};

export async function submitGuestCatalogOrder(input: GuestCatalogOrderInput) {
  await assertGuestCatalogEnabled();

  const customerName = input.customerName.trim();
  const phone = normalizePhone(input.phone);
  if (!customerName || !phone) {
    throw new AppError("الاسم ورقم الهاتف مطلوبان", 400, "GUEST_ORDER_INVALID");
  }

  const uniqueProductIds = [...new Set(input.items.map((item) => item.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: uniqueProductIds }, deletedAt: null },
    include: { warehouseStocks: { select: { quantityPieces: true } } },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const requestedPiecesByProduct = new Map<string, number>();

  for (const item of input.items) {
    const product = productById.get(item.productId);
    if (!product) {
      throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
    }
    const requestedPieces = piecesFor(item.unit, item.quantity, product.pcsPerCarton, product.boxPieces);
    requestedPiecesByProduct.set(
      product.id,
      (requestedPiecesByProduct.get(product.id) ?? 0) + requestedPieces
    );
  }

  for (const product of products) {
    if ((requestedPiecesByProduct.get(product.id) ?? 0) > totalStock(product)) {
      throw new AppError("Product stock is not enough", 400, "CATALOG_STOCK_NOT_ENOUGH");
    }
  }

  const normalizedItems = input.items.map((item) => {
    const product = productById.get(item.productId);
    if (!product) {
      throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
    }
    const available = totalStock(product);
    if (available <= 0) {
      throw new AppError("Product stock is not enough", 400, "CATALOG_STOCK_NOT_ENOUGH");
    }
    const unitPrice = salePriceFor(item.unit, product.salePrice, product.pcsPerCarton, product.boxPieces);
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

  const subtotal = normalizedItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const requester = await findApprovalRequester();

  const approval = await createPendingApproval(
    approvalRequestTypes.CATALOG_ORDER,
    {
      source: "PUBLIC_CATALOG_GUEST",
      customerName,
      phone,
      address: input.address,
      notes: input.notes,
      subtotal,
      finalTotal: subtotal,
      body: {
        customerName,
        phone,
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
      customerName,
      phone,
      normalizedItems.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      })),
    ).catch((err) => console.error("[GuestCatalogOrder] notify failed:", err));
  });

  return { approvalId: approval.id };
}

export async function submitCatalogOrder(input: CatalogOrderInput, token: string) {
  const access = await getCatalogAccess(token);

  const uniqueProductIds = [...new Set(input.items.map((item) => item.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: uniqueProductIds }, deletedAt: null },
    include: { warehouseStocks: { select: { quantityPieces: true } } },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const requestedPiecesByProduct = new Map<string, number>();

  for (const item of input.items) {
    const product = productById.get(item.productId);
    if (!product) {
      throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
    }
    const requestedPieces = piecesFor(item.unit, item.quantity, product.pcsPerCarton, product.boxPieces);
    requestedPiecesByProduct.set(
      product.id,
      (requestedPiecesByProduct.get(product.id) ?? 0) + requestedPieces
    );
  }

  for (const product of products) {
    if ((requestedPiecesByProduct.get(product.id) ?? 0) > totalStock(product)) {
      throw new AppError("Product stock is not enough", 400, "CATALOG_STOCK_NOT_ENOUGH");
    }
  }

  const normalizedItems = input.items.map((item) => {
    const product = productById.get(item.productId);
    if (!product) {
      throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
    }

    const available = totalStock(product);
    if (available <= 0) {
      throw new AppError("Product stock is not enough", 400, "CATALOG_STOCK_NOT_ENOUGH");
    }

    const unitPrice = salePriceFor(item.unit, product.salePrice, product.pcsPerCarton, product.boxPieces);
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
