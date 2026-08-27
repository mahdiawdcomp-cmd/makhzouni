import crypto from "node:crypto";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
import { normalizePhone } from "../utils/phone";
import { getSettings } from "./settings.service";
import { storefrontPricesDefaultVisible } from "./customer-login.service";

/* ══════════════════════════════════════════════════════════════════════
   Catalog visitors as a standing identity.

   A phone that signs into the storefront is NOT a shop customer. It browses,
   it can send an order, and it shows up in the storefront accounts list — but
   nothing writes it into the accounting customer list until the shop presses
   «احفظ كزبون بالمحل», or approves that visitor's first order (an invoice has
   to belong to a customer).

   Wholesale prices are the thing being protected here, not the door. A
   visitor sees every product and every detail with the price replaced by
   «اطلب عرض سعر»; approving that request is what reveals prices, and it costs
   the shop nothing on the books.
══════════════════════════════════════════════════════════════════════ */

const SESSION_BYTES = 32;

function hashSession(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Every spelling of a phone this shop might have stored. */
function phoneCandidates(raw: string): string[] {
  const trimmed = String(raw ?? "").trim();
  const digits = trimmed.replace(/\D/g, "");
  let international = digits;
  if (international.startsWith("00")) international = international.slice(2);
  if (international.startsWith("0")) international = `964${international.slice(1)}`;
  else if (international.startsWith("7")) international = `964${international}`;
  const local = international.startsWith("964") ? `0${international.slice(3)}` : "";
  return [...new Set([trimmed, digits, international, local, `+${international}`].filter(Boolean))];
}

/**
 * Start a browsing session for a visitor who just proved their code.
 *
 * Deliberately not a CatalogAccessLink: that table's token is bound to a
 * Customer row by a non-null foreign key, and minting a Customer just to hand
 * out a token is the exact behaviour this replaces.
 */
export async function issueVisitorSession(phone: string): Promise<string> {
  const token = crypto.randomBytes(SESSION_BYTES).toString("base64url");

  // Someone already on the shop's books does not have to ask for prices they
  // are quoted every day in person. Resolved once, at sign-in, rather than on
  // every request — and recorded, so the storefront, the admin list and the
  // order all agree about why this shopper can see prices.
  const settings = await getSettings().catch(() => null);
  const autoUnlock = settings?.catalogAutoUnlockForCustomers !== false;
  const knownCustomer = autoUnlock
    ? await prisma.customer.findFirst({
        where: { phone: { in: phoneCandidates(phone) }, deletedAt: null },
        select: { id: true },
      })
    : null;

  await prisma.catalogVisitor.update({
    where: { phone },
    data: {
      sessionTokenHash: hashSession(token),
      sessionIssuedAt: new Date(),
      ...(knownCustomer ? { pricesUnlockedAt: new Date(), priceRequestedAt: null } : {}),
    },
  });
  return token;
}

/**
 * Whether this visitor sees wholesale prices.
 *
 * Three states, in this order:
 *   1. explicitly closed  → never, whatever the shop-wide default says
 *   2. explicitly opened   → always
 *   3. neither             → whatever «إظهار الأسعار افتراضياً» currently is
 *
 * The same shape customers use (catalogPricesHidden over the global default),
 * so one rule covers everyone and the merchant can predict the answer without
 * remembering which screen they last touched.
 */
export function resolveVisitorPrices(
  visitor: { pricesHidden?: boolean | null; pricesUnlockedAt?: Date | null },
  shopDefaultVisible: boolean,
): boolean {
  if (visitor.pricesHidden) return false;
  if (visitor.pricesUnlockedAt) return true;
  return shopDefaultVisible;
}

export type VisitorSession = {
  phone: string;
  name: string | null;
  address: string | null;
  notes: string | null;
  province: string | null;
  businessType: string | null;
  detailsSubmitted: boolean;
  pricesUnlocked: boolean;
  priceRequestPending: boolean;
  customerId: string | null;
};

/** Resolve a browsing session, or null when the token is unknown/cleared. */
export async function resolveVisitorSession(token: string | undefined): Promise<VisitorSession | null> {
  const raw = String(token ?? "").trim();
  if (!raw) return null;
  const visitor = await prisma.catalogVisitor.findFirst({
    where: { sessionTokenHash: hashSession(raw) },
    select: {
      phone: true, name: true, address: true, notes: true, province: true,
      businessType: true, detailsSubmittedAt: true, pricesUnlockedAt: true,
      pricesHidden: true, priceRequestedAt: true, customerId: true,
    },
  });
  if (!visitor) return null;
  return {
    phone: visitor.phone,
    name: visitor.name,
    address: visitor.address,
    notes: visitor.notes,
    province: visitor.province,
    businessType: visitor.businessType,
    detailsSubmitted: Boolean(visitor.detailsSubmittedAt),
    pricesUnlocked: resolveVisitorPrices(visitor, await storefrontPricesDefaultVisible()),
    priceRequestPending: Boolean(visitor.priceRequestedAt) && !visitor.pricesUnlockedAt,
    customerId: visitor.customerId,
  };
}

/** Same, but throws the shape the public catalog routes already expect. */
export async function requireVisitorSession(token: string | undefined): Promise<VisitorSession> {
  const session = await resolveVisitorSession(token);
  if (!session) throw new AppError("سجّل الدخول أولاً", 401, "VISITOR_SESSION_INVALID");
  return session;
}

/**
 * Who they are — asked once, before any browsing.
 *
 * Stored on the visitor row rather than filed as an approval request: the
 * shop no longer approves the person, only their prices, so there is nothing
 * for a queue to decide here.
 */
export async function saveVisitorDetails(
  token: string,
  input: { name: string; address?: string; notes?: string; province?: string; businessType?: string },
) {
  const session = await requireVisitorSession(token);
  const name = String(input.name ?? "").trim();
  if (name.length < 2) throw new AppError("الاسم مطلوب", 400, "NAME_REQUIRED");

  const businessType = input.businessType?.trim() || null;

  await prisma.catalogVisitor.update({
    where: { phone: session.phone },
    data: {
      name,
      address: input.address?.trim() || null,
      notes: input.notes?.trim() || null,
      province: input.province?.trim() || null,
      ...(businessType ? { businessType } : {}),
      detailsSubmittedAt: new Date(),
    },
  });
  return { ok: true };
}

/* ── Price access ──────────────────────────────────────────────────── */

/**
 * «اطلب عرض سعر». Records the request and tells the shop; the visitor keeps
 * browsing meanwhile. Idempotent — pressing it twice does not queue twice.
 */
export async function requestPriceAccess(token: string) {
  const session = await requireVisitorSession(token);
  if (session.pricesUnlocked) return { alreadyUnlocked: true, pending: false };
  if (session.priceRequestPending) return { alreadyUnlocked: false, pending: true };

  await prisma.catalogVisitor.update({
    where: { phone: session.phone },
    data: { priceRequestedAt: new Date() },
  });

  // Best-effort: the request is recorded either way, and a failed
  // notification must not read to the visitor as a failed request.
  try {
    const { notifyAdmin } = await import("./app-notification.service");
    await notifyAdmin({
      type: "catalog_price_request",
      category: "catalog",
      severity: "info",
      title: "طلب عرض أسعار",
      message: `${session.name || "زائر"} — ${session.phone} يطلب فتح أسعار الجملة`,
      entityType: "catalog_visitor",
      entityId: session.phone,
    });
  } catch (err) {
    logger.warn(`[CatalogVisitor] price-request notify failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { alreadyUnlocked: false, pending: true };
}

/** Admin: reveal wholesale prices to this visitor, and tell them. */
export async function grantPriceAccess(rawPhone: string) {
  const phone = normalizePhone(String(rawPhone ?? ""));
  const visitor = await prisma.catalogVisitor.findFirst({
    where: { phone: { in: phoneCandidates(rawPhone) } },
    select: { phone: true, name: true, pricesUnlockedAt: true },
  });
  if (!visitor) throw new AppError("الزائر غير موجود", 404, "VISITOR_NOT_FOUND");
  if (visitor.pricesUnlockedAt) return { phone: visitor.phone, alreadyUnlocked: true };

  await prisma.catalogVisitor.update({
    where: { phone: visitor.phone },
    data: { pricesUnlockedAt: new Date(), pricesHidden: false, priceRequestedAt: null },
  });

  try {
    const settings = await getSettings().catch(() => null);
    const link = settings?.catalogPublicUrl?.trim();
    const { sendWhatsAppText } = await import("./whatsapp.service");
    await sendWhatsAppText(
      phone || visitor.phone,
      `تم فتح الأسعار لحسابك ✅\nتكدر تشوف أسعار الجملة الآن${link ? `:\n${link}` : "."}`,
    );
  } catch (err) {
    logger.warn(`[CatalogVisitor] price-grant notify failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { phone: visitor.phone, alreadyUnlocked: false };
}

/** Admin: stop showing prices to this visitor again. */
export async function revokePriceAccess(rawPhone: string) {
  const visitor = await prisma.catalogVisitor.findFirst({
    where: { phone: { in: phoneCandidates(rawPhone) } },
    select: { phone: true },
  });
  if (!visitor) throw new AppError("الزائر غير موجود", 404, "VISITOR_NOT_FOUND");
  await prisma.catalogVisitor.update({
    where: { phone: visitor.phone },
    // Explicitly closed, not merely "un-opened" — otherwise a shop whose
    // default is open would hand the prices straight back.
    data: { pricesUnlockedAt: null, pricesHidden: true, priceRequestedAt: null },
  });
  return { phone: visitor.phone };
}

/* ── Promotion ─────────────────────────────────────────────────────── */

/**
 * «احفظ كزبون بالمحل» — the ONLY thing that puts a visitor on the books,
 * besides approving their first order.
 *
 * Their login code comes along unchanged. Rotating it here would silently
 * kill the code they are holding, which is what the old auto-approval flow
 * did: the shopper ended up with two codes and only the newer one worked.
 */
export async function promoteVisitorToCustomer(rawPhone: string) {
  const visitor = await prisma.catalogVisitor.findFirst({
    where: { phone: { in: phoneCandidates(rawPhone) } },
    select: {
      phone: true, name: true, address: true, notes: true, province: true,
      businessType: true, accessCodeHash: true, accessCodeSetAt: true, customerId: true,
    },
  });
  if (!visitor) throw new AppError("الزائر غير موجود", 404, "VISITOR_NOT_FOUND");

  const phone = normalizePhone(visitor.phone) || visitor.phone;
  const existing = await prisma.customer.findFirst({ where: { phone: { in: phoneCandidates(phone) } } });
  if (existing?.deletedAt) {
    throw new AppError(
      `هذا الرقم يخص زبون محذوف: «${existing.name}» — استرجعه من الزبائن المحذوفين`,
      409,
      "CUSTOMER_DELETED",
    );
  }

  const customer = existing ?? await prisma.customer.create({
    data: {
      name: visitor.name?.trim() || `زبون كتلوك ${phone.slice(-4)}`,
      phone,
      address: visitor.address ?? undefined,
      notes: visitor.notes ?? undefined,
      province: visitor.province ?? undefined,
      ...(visitor.businessType ? { businessType: visitor.businessType } : {}),
      openingBalance: 0,
      currentBalance: 0,
      // Carried over, never regenerated — see the note above.
      ...(visitor.accessCodeHash
        ? { accessCodeHash: visitor.accessCodeHash, accessCodeSetAt: visitor.accessCodeSetAt }
        : {}),
    },
  });

  await prisma.catalogVisitor.update({
    where: { phone: visitor.phone },
    data: { customerId: customer.id, pricesUnlockedAt: new Date(), priceRequestedAt: null },
  });

  return { customerId: customer.id, customerName: customer.name, created: !existing };
}

/* ── Admin listing ─────────────────────────────────────────────────── */

export type StorefrontAccountRow = {
  kind: "CUSTOMER" | "VISITOR";
  phone: string;
  name: string;
  address: string | null;
  province: string | null;
  lastLoginAt: Date | null;
  detailsSubmitted: boolean;
  pricesUnlocked: boolean;
  priceRequestPending: boolean;
  customerId: string | null;
  hasCode: boolean;
  locked: boolean;
};

/**
 * One list of everyone who can sign into the storefront, each row labelled
 * with whether that phone is already on the shop's books.
 *
 * Two separate tabs made the same phone look like two different people once
 * a visitor was promoted; a single labelled list is the thing the merchant
 * actually asked for.
 */
export async function listStorefrontAccountsUnified(search?: string): Promise<StorefrontAccountRow[]> {
  const term = search?.trim();
  const like = term ? { contains: term, mode: "insensitive" as const } : undefined;
  const shopDefaultVisible = await storefrontPricesDefaultVisible();

  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      // Every customer, not only those who already hold a code. Filtering on
      // accessCodeHash hid 198 of this shop's 218 customers — and a customer
      // with no code yet is exactly who the merchant opens this screen to send
      // one to, so the rows they needed were the ones missing.
      ...(like ? { OR: [{ name: like }, { phone: like }] } : {}),
    },
    select: {
      id: true, name: true, phone: true, address: true, province: true,
      lastLoginAt: true, accessCodeHash: true, catalogPricesHidden: true,
      lockedUntil: true,
    },
    orderBy: { name: "asc" },
    take: 500,
  });

  const customerPhones = new Set(customers.map((c) => c.phone));
  const visitors = await prisma.catalogVisitor.findMany({
    where: like ? { OR: [{ name: like }, { phone: like }] } : {},
    select: {
      phone: true, name: true, address: true, province: true, lastLoginAt: true,
      detailsSubmittedAt: true, pricesUnlockedAt: true, pricesHidden: true,
      priceRequestedAt: true, customerId: true, accessCodeHash: true, lockedUntil: true,
    },
    orderBy: { lastSeenAt: "desc" },
    take: 500,
  });

  const rows: StorefrontAccountRow[] = customers.map((c) => ({
    kind: "CUSTOMER",
    phone: c.phone,
    name: c.name,
    address: c.address ?? null,
    province: c.province ?? null,
    lastLoginAt: c.lastLoginAt ?? null,
    detailsSubmitted: true,
    pricesUnlocked: !c.catalogPricesHidden,
    priceRequestPending: false,
    customerId: c.id,
    hasCode: Boolean(c.accessCodeHash),
    locked: Boolean(c.lockedUntil && c.lockedUntil.getTime() > Date.now()),
  }));

  for (const v of visitors) {
    // A promoted visitor is already in the list as their customer row —
    // showing both would read as two people holding the same phone.
    if (v.customerId || customerPhones.has(v.phone)) continue;
    rows.push({
      kind: "VISITOR",
      phone: v.phone,
      name: v.name ?? "",
      address: v.address ?? null,
      province: v.province ?? null,
      lastLoginAt: v.lastLoginAt ?? null,
      detailsSubmitted: Boolean(v.detailsSubmittedAt),
      pricesUnlocked: resolveVisitorPrices(v, shopDefaultVisible),
      priceRequestPending: Boolean(v.priceRequestedAt) && !v.pricesUnlockedAt,
      customerId: null,
      hasCode: Boolean(v.accessCodeHash),
      locked: Boolean(v.lockedUntil && v.lockedUntil.getTime() > Date.now()),
    });
  }

  // Waiting on a price request first, then anyone still without a code —
  // the two rows the merchant opened this screen to act on.
  rows.sort((a, b) =>
    Number(b.priceRequestPending) - Number(a.priceRequestPending)
    || Number(a.hasCode) - Number(b.hasCode),
  );
  return rows;
}

/* ── The catalog home screen ───────────────────────────────────────── */

/**
 * What is waiting for the merchant right now.
 *
 * Every number here is something a person is waiting on, not a vanity stat:
 * opening this screen should answer "what do I have to do today", which is
 * exactly what nine tabs of settings could not.
 */
export async function catalogDashboard() {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    priceRequests,
    reservations,
    customersNoCode,
    visitorsToday,
    incomingItems,
    pendingOrders,
  ] = await Promise.all([
    prisma.catalogVisitor.count({ where: { priceRequestedAt: { not: null }, pricesUnlockedAt: null } }),
    prisma.catalogIncomingReservation.count({ where: { status: "PENDING" } }),
    prisma.customer.count({ where: { deletedAt: null, accessCodeHash: null } }),
    prisma.catalogVisitor.count({ where: { lastSeenAt: { gte: dayAgo } } }),
    prisma.catalogIncomingItem.count({ where: { active: true, arrivedAt: null } }),
    prisma.pendingApproval.count({ where: { requestType: "CATALOG_ORDER", status: "PENDING" } }),
  ]);

  return { priceRequests, reservations, customersNoCode, visitorsToday, incomingItems, pendingOrders };
}
