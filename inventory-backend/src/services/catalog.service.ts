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
  notifyNewCatalogLead,
} from "./order-preparation.service";
import { getSettings } from "./settings.service";
import { createCustomer } from "./customer.service";
import { sendWhatsAppText } from "./whatsapp.service";
import { hasFeature } from "../middleware/tenant.middleware";
import { getCatalogRankingSignals, withRanking } from "./catalog-ranking.service";
import { buildDeliveryLine } from "../utils/deliveryRegion";
import { normalizeOrderTiers, resolveOrderTier, DEFAULT_ORDER_TIERS } from "../utils/orderTiers";

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
    isSample?: boolean;
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

/** Shared with the storefront-login service — same identity rules for a
 *  phone number everywhere, so a login and a catalog link resolve alike. */
export function normalizeCustomerPhone(input: string) {
  return normalizePhone(input);
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

// Settings-driven order seed. "off" → keep the fixed category/name order;
// "daily" → one seed per day; "hourly" (default) → one seed per hour. Shared by
// all shoppers so the whole catalog reorders together on the boundary.
async function catalogOrderSeed(): Promise<number | null> {
  const settings = await getSettings().catch(() => null);
  const mode = settings?.catalogShuffleMode ?? "hourly";
  if (mode === "off") return null;
  const now = Date.now();
  if (mode === "daily") return Math.floor(now / (24 * 60 * 60 * 1000));
  return Math.floor(now / (60 * 60 * 1000));
}

function applyCatalogOrder<T>(items: T[], seed: number | null): T[] {
  return seed == null ? items : seededShuffle(items, seed);
}

// Record a guest visit through the phone gate (guest catalog mode only). The
// phone is stored once; repeat entries just bump the visit counter + timestamp.
// The first time a brand-new number appears we notify the admin (bell +
// WhatsApp) so they can follow up on the hot lead.
// Ceiling on outbound new-lead notifications: at most MAX per rolling hour.
// In-process is sufficient — it is a cost guard, not a security control.
const LEAD_NOTIFY_MAX_PER_HOUR = 20;
const LEAD_NOTIFY_WINDOW_MS = 60 * 60 * 1000;
let leadNotifyWindowStart = 0;
let leadNotifyCount = 0;

function allowLeadNotification(now = Date.now()): boolean {
  if (now - leadNotifyWindowStart > LEAD_NOTIFY_WINDOW_MS) {
    leadNotifyWindowStart = now;
    leadNotifyCount = 0;
  }
  if (leadNotifyCount >= LEAD_NOTIFY_MAX_PER_HOUR) return false;
  leadNotifyCount += 1;
  return true;
}

export async function recordGuestVisit(rawPhone: string) {
  await assertGuestCatalogEnabled();
  const phone = normalizePhone(String(rawPhone ?? ""));
  if (phone.length < 10) throw new AppError("رقم هاتف غير صالح", 400);
  const existing = await prisma.catalogVisitor.findUnique({ where: { phone } });
  if (!existing) {
    await prisma.catalogVisitor.create({ data: { phone } });
    // Fire-and-forget — a slow/failed notification must never block the shopper.
    //
    // Capped: this endpoint is unauthenticated at 60 req/min/IP, and every
    // previously-unseen phone sent one outbound WhatsApp on the merchant's
    // BILLED Meta account. A few IPs posting fabricated numbers was a metered
    // -cost flood that also destroyed the «الزوار الجدد» lead list's usefulness.
    // Genuine leads still notify; a burst degrades to rows-only, which the
    // merchant can still review in the visitors screen.
    if (allowLeadNotification()) {
      notifyNewCatalogLead(phone).catch(() => {});
    }
  } else {
    await prisma.catalogVisitor.update({
      where: { phone },
      data: { visits: { increment: 1 }, lastSeenAt: new Date() },
    });
  }
  return { ok: true };
}

// Admin: guest phone numbers that passed the gate, most recent first, each
// enriched with a matched existing customer (by normalized phone) when there is
// one, plus the total visit count across all of them.
export async function listCatalogVisitors() {
  const visitors = await prisma.catalogVisitor.findMany({
    orderBy: { lastSeenAt: "desc" },
  });
  const phones = visitors.map((v) => v.phone);
  const customers = phones.length
    ? await prisma.customer.findMany({
        where: { phone: { in: phones }, deletedAt: null },
        select: { id: true, name: true, phone: true },
      })
    : [];
  const byPhone = new Map(customers.map((c) => [c.phone, c]));

  // بند ١٠ — عدد المنتجات المُشاهَدة لكل رقم، لترتيب "أولوية الاتصال" (وقت
  // تصفح + عدد مشاهدات، بلا حاجة لتحميل تفاصيل كل زائر — استعلام وحد مجمّع).
  const viewCounts = phones.length
    ? await prisma.catalogVisitorProductView.groupBy({
        by: ["phone"],
        where: { phone: { in: phones } },
        _count: { _all: true },
      })
    : [];
  const viewCountByPhone = new Map(viewCounts.map((v) => [v.phone, v._count._all]));

  const rows = visitors.map((v) => {
    const match = byPhone.get(v.phone);
    return {
      ...v,
      customerId: match?.id ?? null,
      customerName: match?.name ?? null,
      viewCount: viewCountByPhone.get(v.phone) ?? 0,
    };
  });

  // أولوية الاتصال: زوار غير مسجّلين أولاً (هم المستهدفون فعلاً)، بعدين
  // الأعلى اهتماماً (وقت تصفح، وعدد مشاهدات كفاصل تعادل).
  rows.sort((a, b) => {
    const aReg = a.customerId ? 1 : 0;
    const bReg = b.customerId ? 1 : 0;
    if (aReg !== bReg) return aReg - bReg;
    if (b.totalTimeSeconds !== a.totalTimeSeconds) return b.totalTimeSeconds - a.totalTimeSeconds;
    return b.viewCount - a.viewCount;
  });

  const totalVisits = visitors.reduce((sum, v) => sum + v.visits, 0);
  return { visitors: rows, uniquePhones: visitors.length, totalVisits };
}

// Admin: turn a collected guest phone into a real customer. If a customer with
// that (normalized) phone already exists, returns it untouched; otherwise
// creates a minimal customer record. Optionally grants catalog access too.
/**
 * Turn a collected phone into a customer.
 *
 * Delegates the customer row itself to promoteVisitorToCustomer so this and
 * «احفظ كزبون بالمحل» cannot disagree. They used to: this path created a bare
 * customer while the other carried the visitor's login code, address and
 * province across — so which button the merchant happened to press decided
 * whether that person could still sign in afterwards.
 *
 * The optional catalog access link is kept for the legacy link flow.
 */
export async function convertVisitorToCustomer(
  rawPhone: string,
  opts?: { name?: string; grantAccess?: boolean; allowPrices?: boolean },
) {
  const phone = normalizePhone(String(rawPhone ?? ""));
  if (phone.length < 10) throw new AppError("رقم هاتف غير صالح", 400);

  const existing = await prisma.customer.findUnique({ where: { phone } });
  if (existing?.deletedAt) {
    throw new AppError(`هذا الرقم يخص زبون محذوف: «${existing.name}» — استرجعه من الزبائن المحذوفين`, 409);
  }
  const created = !existing;
  const { promoteVisitorToCustomer } = await import("./catalog-visitor.service");
  const promoted = await promoteVisitorToCustomer(phone).catch(() => null);
  const customer = existing
    ?? (promoted ? await prisma.customer.findUniqueOrThrow({ where: { id: promoted.customerId } })
      : await createCustomer({
          name: opts?.name?.trim() || `زبون كتلوك ${phone.slice(-4)}`,
          phone,
          openingBalance: 0,
        }));

  let access: Awaited<ReturnType<typeof createCatalogAccessLink>> | null = null;
  if (opts?.grantAccess) {
    access = await createCatalogAccessLink(customer.id, Boolean(opts.allowPrices));
  }

  return { customerId: customer.id, customerName: customer.name, created, access };
}

// Space consecutive WhatsApp sends out so a bulk blast doesn't trip provider
// spam/ban heuristics (especially personal-number channels).
const BROADCAST_DELAY_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Admin: send a WhatsApp message to collected guest numbers (all of them, or a
// specific subset). Runs in the BACKGROUND — for large lists a throttled
// sequential send would otherwise hold the HTTP request open for minutes and
// time out. Returns immediately with how many numbers were queued; each send is
// spaced by BROADCAST_DELAY_MS and one failure never aborts the rest.
export async function broadcastToVisitors(message: string, phones?: string[]) {
  const text = String(message ?? "").trim();
  if (!text) throw new AppError("الرسالة مطلوبة", 400);
  let targets: string[];
  if (phones && phones.length) {
    targets = phones.map((p) => normalizePhone(p)).filter((p) => p.length >= 10);
  } else {
    const all = await prisma.catalogVisitor.findMany({ select: { phone: true } });
    targets = all.map((v) => v.phone);
  }
  if (!targets.length) throw new AppError("لا توجد أرقام للإرسال", 400);

  // Detached throttled sender — never blocks the response.
  void (async () => {
    let sent = 0;
    let failed = 0;
    for (const phone of targets) {
      try { await sendWhatsAppText(phone, text); sent++; } catch { failed++; }
      await sleep(BROADCAST_DELAY_MS);
    }
    console.info(`[CatalogBroadcast] done: ${sent} sent, ${failed} failed of ${targets.length}`);
  })();

  return { started: true, total: targets.length };
}

// ── Catalog product analytics ────────────────────────────────────────────
// Record that a product card was opened. Fire-and-forget from the controller.
// `phone`, when the visitor is known (guest gate or an authenticated catalog
// session), ALSO logs a per-visitor row — the store-wide counter above stays
// anonymous/aggregate either way, this is additive, not a replacement.
export async function recordCatalogProductView(productId: string, phone?: string) {
  if (!productId) return { ok: false };
  await prisma.catalogProductStat.upsert({
    where: { productId },
    create: { productId, views: 1, lastViewedAt: new Date() },
    update: { views: { increment: 1 }, lastViewedAt: new Date() },
  });

  if (phone) {
    const normalized = normalizePhone(phone);
    // Only log against a phone that actually passed the guest gate — nothing
    // ties this call to a session, so without this check anyone could send an
    // arbitrary real phone number here and fabricate a "viewed this product"
    // history for it. Requiring a prior CatalogVisitor row keeps this scoped
    // to the same guest-funnel phones the admin visitors tab already trusts.
    const isKnownVisitor = normalized && await prisma.catalogVisitor.findUnique({ where: { phone: normalized }, select: { phone: true } });
    if (isKnownVisitor) {
      const product = await prisma.product.findUnique({ where: { id: productId }, select: { name: true } });
      if (product) {
        await prisma.catalogVisitorProductView.create({
          data: { phone: normalized, productId, productName: product.name },
        });
      }
    }
  }

  return { ok: true };
}

// Client heartbeat while the catalog tab is visible (~every 20s, see
// PublicCatalogPage.tsx) — accumulates time-on-catalog per visitor. Silently
// no-ops for an unknown phone (heartbeat fires before the gate ever completed,
// or a bogus value) rather than creating a visitor row out of band — that
// stays the job of recordGuestVisit/the phone gate.
export async function recordVisitorHeartbeat(rawPhone: string, seconds: number) {
  const phone = normalizePhone(String(rawPhone ?? ""));
  const delta = Math.max(0, Math.min(60, Math.round(Number(seconds) || 0))); // clamp: one heartbeat is never more than a minute
  if (!phone || delta <= 0) return { ok: false };
  const result = await prisma.catalogVisitor.updateMany({
    where: { phone },
    data: { totalTimeSeconds: { increment: delta } },
  });
  return { ok: result.count > 0 };
}

// Admin: what a specific visitor actually opened, most recent first — the
// per-visitor detail behind the "الزوار الجدد" list's aggregate counts.
export async function listVisitorProductViews(rawPhone: string, limit = 50) {
  const phone = normalizePhone(String(rawPhone ?? ""));
  if (!phone) return [];
  return prisma.catalogVisitorProductView.findMany({
    where: { phone },
    orderBy: { viewedAt: "desc" },
    take: Math.min(limit, 200),
  });
}

// Bump the order counter for each product in a submitted catalog order.
async function recordCatalogProductOrders(productIds: string[]) {
  const unique = [...new Set(productIds.filter(Boolean))];
  for (const productId of unique) {
    await prisma.catalogProductStat.upsert({
      where: { productId },
      create: { productId, orders: 1 },
      update: { orders: { increment: 1 } },
    });
  }
}

// Admin: top viewed + top ordered products, with product names resolved.
export async function listCatalogProductStats(limit = 20) {
  const stats = await prisma.catalogProductStat.findMany();
  if (!stats.length) return { topViewed: [], topOrdered: [], totalViews: 0, totalOrders: 0 };
  const products = await prisma.product.findMany({
    where: { id: { in: stats.map((s) => s.productId) } },
    select: { id: true, name: true, itemNumber: true, thumbnailUrl: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const enrich = (s: (typeof stats)[number]) => {
    const p = byId.get(s.productId);
    return {
      productId: s.productId,
      name: p?.name ?? "(منتج محذوف)",
      itemNumber: p?.itemNumber ?? null,
      thumbnailUrl: p?.thumbnailUrl ?? null,
      views: s.views,
      orders: s.orders,
    };
  };
  const enriched = stats.map(enrich);
  const topViewed = [...enriched].filter((s) => s.views > 0).sort((a, b) => b.views - a.views).slice(0, limit);
  const topOrdered = [...enriched].filter((s) => s.orders > 0).sort((a, b) => b.orders - a.orders).slice(0, limit);
  const totalViews = stats.reduce((sum, s) => sum + s.views, 0);
  const totalOrders = stats.reduce((sum, s) => sum + s.orders, 0);
  return { topViewed, topOrdered, totalViews, totalOrders };
}

export async function findApprovalRequester() {
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

/** The customer's current non-revoked catalog link, or null. */
export async function getCatalogAccessLinkFor(customerId: string) {
  const rows = await prisma.$queryRaw<CatalogAccessRow[]>`
    SELECT "id", "token", "customer_id", "allow_prices", "show_stock", "catalog_stock_filter", "revoked_at", "last_verified_at"
    FROM "catalog_access_links"
    WHERE "customer_id" = ${customerId}::uuid AND "revoked_at" IS NULL
    ORDER BY "created_at" DESC LIMIT 1
  `;
  return rows[0] ?? null;
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
  viewCount: number;
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
      view_count: number | null;
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
        cal.view_count,
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
      viewCount: row.view_count ?? 0,
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

/**
 * Same approval a public access request raises, but for someone who has
 * already signed in with their code — so the OTP precondition does not apply
 * (the code they used IS proof they own the number).
 */
export async function requestStorefrontAccountApproval(input: CatalogAccessInput) {
  const phone = normalizePhone(input.phone);
  const existingCustomer = await prisma.customer.findUnique({
    where: { phone },
    select: { id: true, name: true },
  });
  const customerName = existingCustomer ? existingCustomer.name : input.customerName.trim();

  const requester = await findApprovalRequester();
  const approval = await createPendingApproval(
    approvalRequestTypes.CATALOG_ACCESS,
    {
      source: "STOREFRONT_SIGNUP",
      customerName,
      phone,
      originalPhone: input.phone,
      address: input.address,
      notes: input.notes,
      allowPrices: false,
      isExistingCustomer: Boolean(existingCustomer),
      existingCustomerId: existingCustomer?.id ?? null,
      body: { customerName, phone, address: input.address, notes: input.notes },
    },
    requester.id,
  );

  setImmediate(() => {
    notifyCatalogAccessRequested(customerName, phone, input.address, input.notes)
      .catch((err) => console.error("[StorefrontSignup] notify failed:", err));
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

  // Handing the access token to anyone who merely KNOWS the phone number is an
  // account takeover: wholesale customer numbers are printed on invoices and
  // shared in WhatsApp/Telegram groups, and the token unlocks that customer's
  // price list, stock levels and — via POST /public/catalog/orders, which reads
  // customerId from the token — the ability to place orders billed to them.
  //
  // The token is therefore released only once this phone has actually proved
  // ownership via OTP, or when the merchant has switched OTP off entirely
  // (guest mode), which is the same rule requestCatalogAccess applies.
  //
  // Callers that get `approved: true` with no token must fall through to the
  // OTP step — do NOT reintroduce a shortcut around this.
  const settings = await getSettings();
  const requireOtp = settings.catalogRequireOtp !== false;
  if (requireOtp && !isVerified(normalizedPhone)) {
    return { approved: true };
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


/* ── Storefront layout, shared by both session payloads ──────────────── */

/**
 * The blocks between the header and the product grid, in the order the
 * storefront draws them when the shop has not said otherwise.
 *
 * Only these reorder. The search header, the product grid and the footer stay
 * where they are by design — a grid above its own search box, or a footer in
 * the middle of the page, is not an arrangement any shop wants, and offering
 * it would be a control that only ever breaks the page. Those blocks get
 * on/off switches instead (footerEnabled, reviewsEnabled, …).
 *
 * Keys are stable identifiers, not labels — renaming a section in the UI must
 * never reshuffle a shop's saved order.
 */
export const CATALOG_SECTION_KEYS = [
  "announcement",
  "priceBar",
  "badges",
  "banner",
  "featured",
  "incoming",
] as const;

export type CatalogSectionKey = (typeof CATALOG_SECTION_KEYS)[number];

/**
 * Merge the shop's saved section list with the built-in one.
 *
 * Saved entries keep their order and their switch; anything the shop has
 * never seen (a section added in a later release) is appended enabled. So a
 * new section appears for everyone without a data migration, and nobody's
 * arrangement is silently rewritten.
 */
export function resolveCatalogSections(
  saved: Array<{ key: string; enabled: boolean }> | undefined,
): Array<{ key: CatalogSectionKey; enabled: boolean }> {
  const known = new Set<string>(CATALOG_SECTION_KEYS);
  const seen = new Set<string>();
  const out: Array<{ key: CatalogSectionKey; enabled: boolean }> = [];

  for (const entry of saved ?? []) {
    if (!known.has(entry.key) || seen.has(entry.key)) continue;
    seen.add(entry.key);
    out.push({ key: entry.key as CatalogSectionKey, enabled: entry.enabled !== false });
  }
  for (const key of CATALOG_SECTION_KEYS) {
    if (!seen.has(key)) out.push({ key, enabled: true });
  }
  return out;
}

/** Everything the storefront needs to draw itself the way the shop set it up. */
export function buildCatalogLayout(settings: Awaited<ReturnType<typeof getSettings>>) {
  return {
    announcement:
      settings.catalogAnnouncementEnabled === true && settings.catalogAnnouncementText?.trim()
        ? settings.catalogAnnouncementText.trim()
        : null,
    sections: resolveCatalogSections(settings.catalogSections),
    texts: settings.catalogTexts ?? {},
    hiddenCategories: settings.catalogHiddenCategories ?? [],
    categoryOrder: settings.catalogCategoryOrder ?? [],
    featuredProductIds: settings.catalogFeaturedProductIds ?? [],
    defaultView: settings.catalogDefaultView ?? "grid",
    defaultPerRow: settings.catalogDefaultPerRow ?? 2,
    defaultSort: settings.catalogDefaultSort ?? "",
    reviewsEnabled: settings.catalogReviewsEnabled !== false,
    suggestionsEnabled: settings.catalogSuggestionsEnabled !== false,
    tutorialEnabled: settings.catalogTutorialEnabled !== false,
    orderTiers: normalizeOrderTiers(settings.catalogOrderTiers ?? DEFAULT_ORDER_TIERS),
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
    select: { id: true, name: true, phone: true, province: true },
  });

  if (!customer) {
    throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  }

  // بند ٤ — جملة توصيل واحدة حسب محافظة الزبون؛ null لو محافظته غير معروفة
  // (لا نعرض شي بدل تخمين خاطئ).
  const deliveryLine = buildDeliveryLine(customer.province, settings);
  const { province: _province, ...publicCustomer } = customer;

  // بند ٧ — كوبون أول طلب النشط لهذا الزبون تحديداً (لو موجود وما استُخدم
  // ولا انتهى)، لعرض العداد التنازلي بالكتلوك.
  const activeCoupon = await prisma.promoCode.findFirst({
    where: {
      customerId: customer.id,
      source: "FIRST_ORDER_WELCOME",
      active: true,
      usedCount: 0,
      expiresAt: { gt: new Date() },
    },
    select: { code: true, value: true, expiresAt: true },
  });

  const catalogDesign = {
    // Layout, wording and feature switches — the same shape the public
    // /catalog/design endpoint serves, so a signed-in customer and an
    // anonymous visitor can never see the page arranged differently.
    ...buildCatalogLayout(settings),
    primaryColor: settings.catalogDesignPrimaryColor ?? null,
    bgColor: settings.catalogDesignBgColor ?? null,
    defaultTheme: settings.catalogDesignDefaultTheme ?? "clean",
    logoUrl: settings.catalogDesignLogoUrl ?? null,
    welcomeMessage: settings.catalogDesignWelcomeMessage ?? null,
    bannerEnabled: settings.catalogDesignBannerEnabled ?? true,
    bannerImages: settings.catalogDesignBannerImages ?? [],
    footer: {
      enabled: settings.catalogDesignFooterEnabled ?? true,
      about: settings.catalogDesignFooterAbout ?? "",
      phone: settings.catalogDesignFooterPhone ?? "",
      whatsapp: settings.catalogDesignFooterWhatsapp ?? "",
      address: settings.catalogDesignFooterAddress ?? "",
      hours: settings.catalogDesignFooterHours ?? "",
      instagram: settings.catalogDesignFooterInstagram ?? "",
      facebook: settings.catalogDesignFooterFacebook ?? "",
      telegram: settings.catalogDesignFooterTelegram ?? "",
      tiktok: settings.catalogDesignFooterTiktok ?? "",
      deliveryAreas: settings.catalogDesignFooterDeliveryAreas ?? "",
      deliveryTime: settings.catalogDesignFooterDeliveryTime ?? "",
      minOrder: settings.catalogDesignFooterMinOrder ?? "",
      cashOnDelivery: settings.catalogDesignFooterCashOnDelivery ?? false,
    },
    trust: {
      badges: [
        { enabled: settings.catalogDesignTrust1Enabled ?? false, text: settings.catalogDesignTrust1Text ?? "" },
        { enabled: settings.catalogDesignTrust2Enabled ?? false, text: settings.catalogDesignTrust2Text ?? "" },
        { enabled: settings.catalogDesignTrust3Enabled ?? false, text: settings.catalogDesignTrust3Text ?? "" },
      ],
      lowStockCartons: settings.catalogDesignLowStockCartons ?? 0,
    },
  };

  // SaaS entitlement gates — display-time only, the stored per-link values are
  // never modified. Standalone/no-entitlements tenants always pass (hasFeature
  // fail-open). Each fallback matches this codebase's own existing default for
  // an unconfigured link, so a tenant without the paid feature just falls back
  // to the same baseline every new link already starts from.
  const [showHidePriceEnabled, showHideStockEnabled] = await Promise.all([
    hasFeature("catalogShowHidePrice"),
    hasFeature("catalogShowHideStock"),
  ]);
  const allowPrices = showHidePriceEnabled ? link.allow_prices : false;
  const showStock = showHideStockEnabled ? link.show_stock : true;
  // catalogFullCartonOnly is the merchant's single global switch (Settings):
  // ON forces full-carton-only for every customer, OFF forces all-products
  // for every customer. It is the sole source of truth for both directions —
  // the per-customer catalog_stock_filter column is intentionally not read
  // here anymore, by the merchant's request (one simple on/off, not a mix of
  // per-customer overrides).
  const stockFilter = settings.catalogFullCartonOnly
    ? CatalogStockFilter.FULL_CARTON_ONLY
    : CatalogStockFilter.ALL_PRODUCTS;

  return {
    customer: publicCustomer,
    allowPrices,
    showStock,
    stockFilter,
    needsOtp,
    catalogDesign,
    deliveryLine,
    firstOrderCoupon: activeCoupon
      ? { code: activeCoupon.code, percent: Number(activeCoupon.value), expiresAt: activeCoupon.expiresAt!.toISOString() }
      : null,
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
  // Count one catalog open per grid load (this runs once when the shopper opens
  // the catalog, unlike getCatalogAccess which fires on every sub-request).
  await prisma.$executeRaw`
    UPDATE "catalog_access_links"
    SET "view_count" = "view_count" + 1
    WHERE "token_hash" = ${hashToken(token)} AND "revoked_at" IS NULL
  `;
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
  const signals = await getCatalogRankingSignals();

  const mapped = products
    .map((product) => {
      const stock = totalStock(product);
      return withRanking({
        id: product.id,
        itemNumber: product.itemNumber,
        name: product.name,
        // Thumbnails are NOT sent with the grid: at ~8-16 KB of base64 each,
        // a few hundred products is several megabytes on the first open. The
        // client asks for just the ones it is about to draw, via
        // /catalog/thumbnails. hasImage lets a card reserve the right space
        // and show a placeholder only when there genuinely is no picture.
        hasImage: Boolean(product.thumbnailUrl),
        category: product.category,
        categoryTags: product.categoryTags,
        typeTags: product.typeTags,
        isNewArrival: product.isNewArrival,
        isOffer: product.isOffer,
        oldPrice: access.allowPrices && product.oldPrice != null ? toNumber(product.oldPrice) : null,
        offerEndsAt: product.offerEndsAt,
        createdAt: product.createdAt,
        salePrice: access.allowPrices ? toNumber(product.salePrice) : null,
        pcsPerCarton: product.pcsPerCarton,
        boxPieces: product.boxPieces,
        hiddenUnits: product.hiddenUnits,
        // Always send stock for cart max-quantity logic; showStock controls display only
        currentStock: stock,
        showStock: access.showStock,
      }, signals);
    })
    .filter((product) =>
      fullCartonOnly
        ? product.pcsPerCarton >= 1 && product.currentStock >= product.pcsPerCarton
        : product.currentStock > 0,
    );

  return applyCatalogOrder(mapped, await catalogOrderSeed());
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
  // Requiring a sign-in closes anonymous browsing outright — it has to win
  // over the older OTP switch, otherwise turning it on would appear to do
  // nothing on a shop that had guest mode left enabled.
  if (settings.catalogRequireLogin === true) return false;
  return settings.catalogRequireOtp === false;
}

async function assertGuestCatalogEnabled() {
  if (!(await isGuestCatalogEnabled())) {
    throw new AppError("الدخول المفتوح للكتالوج غير مفعّل", 403, "GUEST_CATALOG_DISABLED");
  }
}

/**
 * The open catalog grid — every in-stock product, no per-customer filtering.
 *
 * Shared by anonymous guest browsing and by a signed-in visitor, which differ
 * in exactly two ways: whether open browsing has to be enabled at all, and
 * whether prices are shown. Keeping one body means the two can never drift
 * into showing different products.
 */
async function listOpenCatalogProducts(opts: { withPrices: boolean }) {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    omit: { imageUrl: true },
    include: { warehouseStocks: { select: { quantityPieces: true } } },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  const signals = await getCatalogRankingSignals();

  const mapped = products
    .map((product) => {
      const stock = totalStock(product);
      return withRanking({
        id: product.id,
        itemNumber: product.itemNumber,
        name: product.name,
        // Thumbnails are NOT sent with the grid: at ~8-16 KB of base64 each,
        // a few hundred products is several megabytes on the first open. The
        // client asks for just the ones it is about to draw, via
        // /catalog/thumbnails. hasImage lets a card reserve the right space
        // and show a placeholder only when there genuinely is no picture.
        hasImage: Boolean(product.thumbnailUrl),
        category: product.category,
        categoryTags: product.categoryTags,
        typeTags: product.typeTags,
        isNewArrival: product.isNewArrival,
        isOffer: product.isOffer,
        oldPrice: null,
        offerEndsAt: product.offerEndsAt,
        createdAt: product.createdAt,
        // Hidden until the shop unlocks them for this visitor; a guest with
        // no account never gets them at all.
        salePrice: opts.withPrices ? Number(product.salePrice ?? 0) : null,
        pcsPerCarton: product.pcsPerCarton,
        boxPieces: product.boxPieces,
        hiddenUnits: product.hiddenUnits,
        currentStock: stock,
        showStock: true,
      }, signals);
    })
    .filter((product) => product.pcsPerCarton >= 1 && product.currentStock >= product.pcsPerCarton);

  return applyCatalogOrder(mapped, await catalogOrderSeed());
}

/**
 * Open browsing OR a signed-in visitor.
 *
 * A visitor proved a code, so the shop's anonymous-browsing switch has no say
 * over them. Gating their orders and images on it meant everything worked
 * only for shops that also left the catalog open to strangers — which is
 * nobody who turned on login.
 */
async function assertOpenOrVisitor(visitorToken?: string) {
  if (visitorToken?.trim()) {
    const { resolveVisitorSession } = await import("./catalog-visitor.service");
    const session = await resolveVisitorSession(visitorToken);
    if (session) return session;
  }
  await assertGuestCatalogEnabled();
  return null;
}

export async function listGuestCatalogProducts() {
  await assertGuestCatalogEnabled();
  return listOpenCatalogProducts({ withPrices: false });
}

/**
 * The grid for a signed-in visitor. No guest-mode gate: they proved a code,
 * so browsing is theirs whether or not the shop leaves anonymous browsing on.
 */
export async function listVisitorCatalogProducts(opts: { pricesUnlocked: boolean }) {
  return listOpenCatalogProducts({ withPrices: opts.pricesUnlocked });
}

export async function getGuestCatalogProductImage(productId: string, visitorToken?: string) {
  await assertOpenOrVisitor(visitorToken);
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
  items: Array<{ productId: string; unit: Unit; quantity: number; isSample?: boolean }>;
};

export async function submitGuestCatalogOrder(input: GuestCatalogOrderInput & { visitorToken?: string }) {
  // A signed-in visitor ordering is the whole point of letting them browse
  // without prices — refusing it because anonymous browsing is off left them
  // with a cart they could fill and never send.
  await assertOpenOrVisitor(input.visitorToken);

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
      isSample: item.isSample === true,
    };
  });

  const subtotal = normalizedItems.reduce((sum, item) => sum + item.totalPrice, 0);

  // A visitor's order earns the same offers a customer's does — the ladder is
  // about the size of the basket, not about who is holding it.
  const guestTierSettings = await getSettings().catch(() => null);
  const guestTier = resolveOrderTier(subtotal, guestTierSettings?.catalogOrderTiers ?? DEFAULT_ORDER_TIERS);

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
      isFreeDelivery: guestTier.freeDelivery,
      tierDiscount: guestTier.discountAmount,
      tierPercent: guestTier.discountPercent,
      finalTotal: subtotal - guestTier.discountAmount,
      body: {
        customerName,
        phone,
        address: input.address,
        notes: input.notes,
        discount: guestTier.discountAmount,
        isFreeDelivery: guestTier.freeDelivery,
        tierPercent: guestTier.discountPercent,
        items: normalizedItems.map((item) => ({
          productId: item.productId,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          isSample: item.isSample,
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
    recordCatalogProductOrders(normalizedItems.map((i) => i.productId)).catch(() => {});
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
      isSample: item.isSample === true,
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
    // Claim the use ATOMICALLY. `validatePromoCode` checked usedCount a moment
    // ago and this was an unconditional increment, so two concurrent orders
    // both passed the check and both incremented — sailing straight past
    // usageLimit. The conditional updateMany makes the limit the database's
    // job, which is what the retail path already does (resolveCoupon's claim in
    // retail-catalog.service.ts).
    if (promo.usageLimit != null) {
      const claimed = await prisma.promoCode.updateMany({
        where: { id: promo.id, usedCount: { lt: promo.usageLimit } },
        data: { usedCount: { increment: 1 } },
      });
      if (claimed.count === 0) {
        throw new AppError("انتهت صلاحية كود الخصم", 400, "PROMO_LIMIT_REACHED");
      }
    } else {
      await prisma.promoCode.update({
        where: { id: promo.id },
        data: { usedCount: { increment: 1 } },
      });
    }
  }

  // «عروض القائمة» — resolved HERE, from prices the server just computed.
  // A tier read from the request body would let anyone claim the top rung by
  // editing one number before pressing send.
  const tierSettings = await getSettings().catch(() => null);
  const tier = resolveOrderTier(subtotal, tierSettings?.catalogOrderTiers ?? DEFAULT_ORDER_TIERS);
  const tierDiscount = tier.discountAmount;
  const tierFreeDelivery = tier.freeDelivery;

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
      isFreeDelivery: isFreeDelivery || tierFreeDelivery,
      tierDiscount,
      tierPercent: tier.discountPercent,
      finalTotal: subtotal - promoDiscount - tierDiscount,
      body: {
        customerName: access.customer.name,
        phone: access.customer.phone,
        address: input.address,
        notes: input.notes,
        promoCode: input.promoCode,
        promoDiscount,
        isFreeDelivery: isFreeDelivery || tierFreeDelivery,
        // ONLY the tier discount. The promo code travels as couponCode and
        // createInvoice applies it itself, so adding promoDiscount here would
        // take the same discount off the invoice twice.
        discount: tierDiscount,
        tierPercent: tier.discountPercent,
        items: normalizedItems.map((item) => ({
          productId: item.productId,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          isSample: item.isSample,
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
    recordCatalogProductOrders(normalizedItems.map((i) => i.productId)).catch(() => {});
  });

  return { approvalId: approval.id, promoDiscount, isFreeDelivery, finalTotal: subtotal - promoDiscount };
}

/* ── Telegram bot orders (Phase 2) ────────────────────────────────── */

export type TelegramCatalogOrderInput = {
  customerName: string;
  phone: string;
  notes?: string;
  address?: string;
  items: Array<{ productId: string; unit: Unit; quantity: number; isSample?: boolean }>;
  couponCode?: string;
};

/**
 * Order submitted from the Telegram bot. Same pipeline as catalog orders
 * (CATALOG_ORDER approval → order preparation → invoice), so admins see the
 * exact same details/flow. The phone decides the linkage: a registered
 * customer's order carries their customerId (invoice lands on their account);
 * an unknown phone arrives as a lead — the order-preparations page offers a
 * one-click «إنشاء حساب» for it.
 */
export async function submitTelegramCatalogOrder(input: TelegramCatalogOrderInput) {
  const customerName = input.customerName.trim() || "زبون تيليگرام";
  const phone = normalizePhone(input.phone);
  if (!phone) throw new AppError("رقم الهاتف مطلوب", 400, "TELEGRAM_ORDER_INVALID");
  if (!input.items.length) throw new AppError("السلة فارغة", 400, "TELEGRAM_ORDER_EMPTY");

  const uniqueProductIds = [...new Set(input.items.map((item) => item.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: uniqueProductIds }, deletedAt: null },
    include: { warehouseStocks: { select: { quantityPieces: true } } },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const requestedPiecesByProduct = new Map<string, number>();

  for (const item of input.items) {
    const product = productById.get(item.productId);
    if (!product) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
    const requestedPieces = piecesFor(item.unit, item.quantity, product.pcsPerCarton, product.boxPieces);
    requestedPiecesByProduct.set(
      product.id,
      (requestedPiecesByProduct.get(product.id) ?? 0) + requestedPieces
    );
  }
  for (const product of products) {
    if ((requestedPiecesByProduct.get(product.id) ?? 0) > totalStock(product)) {
      throw new AppError(`الرصيد غير كافي للمادة: ${product.name}`, 400, "CATALOG_STOCK_NOT_ENOUGH");
    }
  }

  const normalizedItems = input.items.map((item) => {
    const product = productById.get(item.productId)!;
    const unitPrice = salePriceFor(item.unit, product.salePrice, product.pcsPerCarton, product.boxPieces);
    return {
      productId: product.id,
      productName: product.name,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice,
      totalPrice: unitPrice * item.quantity,
      availableStock: totalStock(product),
    };
  });
  const subtotal = normalizedItems.reduce((sum, item) => sum + item.totalPrice, 0);

  // Registered customer? Link the order to their account (invoice pre-selects them).
  const customer = await prisma.customer.findFirst({
    where: { phone, deletedAt: null },
    select: { id: true, name: true },
  });

  const requester = await findApprovalRequester();
  const approval = await createPendingApproval(
    approvalRequestTypes.CATALOG_ORDER,
    {
      source: "TELEGRAM_BOT",
      customerName: customer?.name ?? customerName,
      phone,
      customerId: customer?.id,
      isNewCustomer: !customer,
      address: input.address,
      notes: input.notes,
      subtotal,
      finalTotal: subtotal,
      body: {
        customerName: customer?.name ?? customerName,
        phone,
        address: input.address,
        notes: input.notes,
        couponCode: input.couponCode,
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
      customer?.name ?? customerName,
      phone,
      normalizedItems.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      })),
    ).catch((err) => console.error("[TelegramOrder] notify failed:", err));
    recordCatalogProductOrders(normalizedItems.map((i) => i.productId)).catch(() => {});
  });

  return {
    approvalId: approval.id,
    total: subtotal,
    matchedCustomerName: customer?.name ?? null,
    isNewCustomer: !customer,
    items: normalizedItems,
  };
}

/** Search available (in-stock, not deleted) products for the bot. */
export async function searchCatalogProductsForBot(term: string, limit = 8) {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: {
      id: true, itemNumber: true, name: true, category: true, salePrice: true,
      pcsPerCarton: true, boxPieces: true, thumbnailUrl: true,
      openingBalancePcs: true, cartonsAvailable: true,
      warehouseStocks: { select: { quantityPieces: true } },
    },
  });
  const inStock = products.filter((p) => totalStock(p) > 0);
  const t = term.trim().toLowerCase();
  const matches = inStock.filter(
    (p) => p.name.toLowerCase().includes(t) || p.itemNumber.toLowerCase().includes(t)
  );
  return matches.slice(0, limit);
}

/** Distinct categories of available products (bot browse). */
export async function listCatalogCategoriesForBot() {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: {
      category: true, openingBalancePcs: true, cartonsAvailable: true, pcsPerCarton: true,
      warehouseStocks: { select: { quantityPieces: true } },
    },
  });
  const counts = new Map<string, number>();
  for (const p of products) {
    if (totalStock(p) <= 0) continue;
    const cat = (p.category || "بدون صنف").trim() || "بدون صنف";
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}

/** Available products of one category, paged (bot browse). */
export async function listCatalogProductsByCategoryForBot(category: string, page = 0, pageSize = 6) {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: {
      id: true, itemNumber: true, name: true, category: true, salePrice: true,
      pcsPerCarton: true, boxPieces: true, thumbnailUrl: true,
      openingBalancePcs: true, cartonsAvailable: true,
      warehouseStocks: { select: { quantityPieces: true } },
    },
    orderBy: { name: "asc" },
  });
  const inCategory = products.filter((p) => {
    if (totalStock(p) <= 0) return false;
    const cat = (p.category || "بدون صنف").trim() || "بدون صنف";
    return cat === category;
  });
  return {
    total: inCategory.length,
    items: inCategory.slice(page * pageSize, page * pageSize + pageSize),
  };
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
  // بند ٧ — "FIRST_ORDER_WELCOME" for an auto-issued coupon; undefined for a
  // manually-created one (the existing behaviour, unchanged).
  source?: string;
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
      source: input.source ?? null,
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
