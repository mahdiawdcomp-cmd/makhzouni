import bcrypt from "bcrypt";
import { randomInt } from "crypto";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { createCatalogAccessLink, getCatalogAccessLinkFor, normalizeCustomerPhone } from "./catalog.service";
import { getSettings } from "./settings.service";

/* ══════════════════════════════════════════════════════════════════════
   STOREFRONT LOGIN
   The shopper signs in with their phone number and a 6-digit code the shop
   sends them. Two kinds of account resolve through the same door:

     - a real Customer, who lands in their own catalog + account, and
     - a CatalogVisitor: a phone the shop knows but has not turned into a
       customer yet. They sign in, fill in their details, and an admin
       approves them before a Customer row exists.

   Only the bcrypt hash of a code is ever stored, so "re-send his code"
   always means "issue a new one" — the old one cannot be read back.
══════════════════════════════════════════════════════════════════════ */

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function saltRounds() {
  return Number(process.env.BCRYPT_SALT_ROUNDS ?? 10);
}

/** A 6-digit code from a CSPRNG — never Math.random for a credential. */
export function generateAccessCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function hashAccessCode(code: string) {
  return bcrypt.hash(code, saltRounds());
}

type LockState = { failedLoginCount: number; lockedUntil: Date | null };

function remainingLockMs(state: LockState) {
  if (!state.lockedUntil) return 0;
  return Math.max(0, state.lockedUntil.getTime() - Date.now());
}

function lockError(ms: number): never {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  throw new AppError(
    `تم قفل الحساب مؤقتاً بسبب محاولات خاطئة. حاول بعد ${minutes} دقيقة.`,
    429,
    "ACCOUNT_LOCKED",
  );
}

/** Shared failure bookkeeping — the caller supplies how to persist it. */
function nextFailureState(state: LockState) {
  const failedLoginCount = state.failedLoginCount + 1;
  const locked = failedLoginCount >= MAX_FAILED_ATTEMPTS;
  return {
    failedLoginCount: locked ? 0 : failedLoginCount,
    lockedUntil: locked ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
    locked,
  };
}

const BAD_CREDENTIALS = () =>
  new AppError("رقم الهاتف أو الرمز غير صحيح", 401, "LOGIN_INVALID");

/**
 * Every way the same Iraqi number may be spelled in `customers.phone`.
 *
 * Customer rows keep whatever the shop typed — usually the local "07…" form —
 * while normalizeCustomerPhone() produces the international "9647…" one. A
 * login has to find the account regardless of which form is on file, so match
 * against all of them rather than assuming the rows are normalised.
 */
function phoneCandidates(rawInput: string): string[] {
  const raw = String(rawInput ?? "").trim();
  const international = normalizeCustomerPhone(raw); // 9647xxxxxxxxx
  const local = international.startsWith("964")
    ? `0${international.slice(3)}`
    : "";
  const digitsOnly = raw.replace(/\D/g, "");
  return [...new Set([raw, international, local, digitsOnly, `+${international}`].filter(Boolean))];
}

export type CustomerLoginResult =
  | {
      kind: "CUSTOMER";
      token: string;
      customer: { id: string; name: string; phone: string };
    }
  | {
      kind: "VISITOR";
      /**
       * Signed in, but not on the shop's books. They browse with this session
       * token; whether they ever become a Customer is the merchant's call.
       */
      phone: string;
      token: string;
      detailsSubmitted: boolean;
      pricesUnlocked: boolean;
      priceRequestPending: boolean;
    };

export async function customerLogin(rawPhone: string, rawCode: string): Promise<CustomerLoginResult> {
  const phone = normalizeCustomerPhone(rawPhone);
  const code = String(rawCode ?? "").trim();
  if (!phone || !/^\d{4,10}$/.test(code)) throw BAD_CREDENTIALS();

  const customer = await prisma.customer.findFirst({
    where: { phone: { in: phoneCandidates(rawPhone) }, deletedAt: null },
    select: {
      id: true, name: true, phone: true,
      accessCodeHash: true, failedLoginCount: true, lockedUntil: true,
      catalogPricesHidden: true,
    },
  });

  if (customer?.accessCodeHash) {
    const lockMs = remainingLockMs(customer);
    if (lockMs > 0) lockError(lockMs);

    const ok = await bcrypt.compare(code, customer.accessCodeHash);
    if (!ok) {
      const next = nextFailureState(customer);
      await prisma.customer.update({
        where: { id: customer.id },
        data: { failedLoginCount: next.failedLoginCount, lockedUntil: next.lockedUntil },
      });
      if (next.locked) lockError(LOCK_MINUTES * 60_000);
      throw BAD_CREDENTIALS();
    }

    await prisma.customer.update({
      where: { id: customer.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    // Signing in with a private code proves the shopper owns this account, so
    // hand back the same catalog token the emailed/WhatsApp link uses. Every
    // existing catalog endpoint keeps working untouched, and the OTP
    // re-verification clock is reset because this WAS the verification.
    const token = await ensureCatalogToken(
      customer.id,
      await effectiveAllowPrices(customer.catalogPricesHidden),
    );
    return {
      kind: "CUSTOMER",
      token,
      customer: { id: customer.id, name: customer.name, phone: customer.phone },
    };
  }

  const visitor = await prisma.catalogVisitor.findFirst({
    where: { phone: { in: phoneCandidates(rawPhone) } },
    select: {
      phone: true, accessCodeHash: true, failedLoginCount: true,
      lockedUntil: true, detailsSubmittedAt: true,
    },
  });
  if (!visitor?.accessCodeHash) throw BAD_CREDENTIALS();

  const lockMs = remainingLockMs(visitor);
  if (lockMs > 0) lockError(lockMs);

  const ok = await bcrypt.compare(code, visitor.accessCodeHash);
  if (!ok) {
    const next = nextFailureState(visitor);
    await prisma.catalogVisitor.update({
      where: { phone: visitor.phone },
      data: { failedLoginCount: next.failedLoginCount, lockedUntil: next.lockedUntil },
    });
    if (next.locked) lockError(LOCK_MINUTES * 60_000);
    throw BAD_CREDENTIALS();
  }

  await prisma.catalogVisitor.update({
    where: { phone: visitor.phone },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const { issueVisitorSession, resolveVisitorSession } = await import("./catalog-visitor.service");
  const token = await issueVisitorSession(visitor.phone);
  const session = await resolveVisitorSession(token);

  return {
    kind: "VISITOR",
    phone: visitor.phone,
    token,
    detailsSubmitted: Boolean(session?.detailsSubmitted),
    pricesUnlocked: Boolean(session?.pricesUnlocked),
    priceRequestPending: Boolean(session?.priceRequestPending),
  };
}

/** Reuse the customer's live catalog link, or mint one on first sign-in. */
async function ensureCatalogToken(customerId: string, allowPrices: boolean) {
  const existing = await getCatalogAccessLinkFor(customerId);
  if (existing) {
    await prisma.$executeRaw`
      UPDATE "catalog_access_links"
      SET "last_verified_at" = NOW(), "allow_prices" = ${allowPrices}
      WHERE "id" = ${existing.id}::uuid
    `;
    return existing.token;
  }
  const link = await createCatalogAccessLink(customerId, allowPrices);
  await prisma.$executeRaw`
    UPDATE "catalog_access_links"
    SET "last_verified_at" = NOW()
    WHERE "customer_id" = ${customerId}::uuid AND "revoked_at" IS NULL
  `;
  return link.token;
}

/* ── Issuing codes ───────────────────────────────────────────────── */

export type IssuedCode = {
  phone: string;
  name: string;
  code: string;
  kind: "CUSTOMER" | "VISITOR";
  /** Set for CUSTOMER, so committing does not have to look the row up again. */
  customerId?: string;
};

/**
 * Generate a code WITHOUT storing it yet.
 *
 * Issuing and sending are deliberately two steps: storing the new hash first
 * meant a failed WhatsApp send still replaced the old code, locking the
 * customer out with a code nobody had. The caller sends first and only calls
 * commitAccessCode() once the message is actually out.
 */
export async function prepareCustomerCode(customerId: string): Promise<IssuedCode> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, name: true, phone: true },
  });
  if (!customer) throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  return {
    phone: customer.phone,
    name: customer.name,
    code: generateAccessCode(),
    kind: "CUSTOMER",
    customerId: customer.id,
  };
}

export async function prepareVisitorCode(rawPhone: string): Promise<IssuedCode> {
  const phone = normalizeCustomerPhone(rawPhone);
  if (!phone) throw new AppError("رقم هاتف غير صالح", 400, "PHONE_INVALID");
  return { phone, name: "", code: generateAccessCode(), kind: "VISITOR" };
}

/** Persist the code the shopper has just been sent. */
export async function commitAccessCode(issued: IssuedCode) {
  const data = {
    accessCodeHash: await hashAccessCode(issued.code),
    accessCodeSetAt: new Date(),
    // A fresh code clears any standing lock — the shop just re-issued it.
    failedLoginCount: 0,
    lockedUntil: null,
  };
  if (issued.kind === "CUSTOMER") {
    await prisma.customer.update({ where: { id: issued.customerId! }, data });
    return;
  }
  await prisma.catalogVisitor.upsert({
    where: { phone: issued.phone },
    update: data,
    create: { phone: issued.phone, ...data },
  });
}

/* ── Account listing for the admin screen ────────────────────────── */

export async function listStorefrontAccounts(search?: string) {
  const q = search?.trim();
  const now = Date.now();

  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { phone: { contains: q } }] } : {}),
    },
    orderBy: { name: "asc" },
    take: 500,
    select: {
      id: true, name: true, phone: true,
      accessCodeSetAt: true, lastLoginAt: true, lockedUntil: true,
      catalogPricesHidden: true,
    },
  });

  // Visitors who never became customers — the "new" half of the list.
  const customerPhones = new Set(customers.map((c) => c.phone));
  const visitors = await prisma.catalogVisitor.findMany({
    where: q ? { phone: { contains: q } } : {},
    orderBy: { lastSeenAt: "desc" },
    take: 500,
    select: {
      phone: true, accessCodeSetAt: true, lastLoginAt: true,
      lockedUntil: true, detailsSubmittedAt: true,
    },
  });

  return {
    customers: customers.map((c) => ({
      kind: "CUSTOMER" as const,
      id: c.id,
      name: c.name,
      phone: c.phone,
      hasCode: Boolean(c.accessCodeSetAt),
      codeSetAt: c.accessCodeSetAt,
      lastLoginAt: c.lastLoginAt,
      locked: Boolean(c.lockedUntil && c.lockedUntil.getTime() > now),
      pricesHidden: c.catalogPricesHidden,
    })),
    visitors: visitors
      .filter((v) => !customerPhones.has(v.phone))
      .map((v) => ({
        kind: "VISITOR" as const,
        phone: v.phone,
        hasCode: Boolean(v.accessCodeSetAt),
        codeSetAt: v.accessCodeSetAt,
        lastLoginAt: v.lastLoginAt,
        locked: Boolean(v.lockedUntil && v.lockedUntil.getTime() > now),
        detailsSubmitted: Boolean(v.detailsSubmittedAt),
      })),
  };
}

export async function setCustomerPricesHidden(customerId: string, hidden: boolean) {
  await prisma.customer.update({
    where: { id: customerId },
    data: { catalogPricesHidden: hidden },
  });
  // Keep the live catalog link in step, otherwise the change only lands the
  // next time they sign in. Un-hiding restores the shop-wide default rather
  // than forcing prices on.
  const allow = await effectiveAllowPrices(hidden);
  await prisma.$executeRaw`
    UPDATE "catalog_access_links"
    SET "allow_prices" = ${allow}
    WHERE "customer_id" = ${customerId}::uuid AND "revoked_at" IS NULL
  `;
  return { ok: true };
}

export async function unlockAccount(kind: "CUSTOMER" | "VISITOR", idOrPhone: string) {
  if (kind === "CUSTOMER") {
    await prisma.customer.update({
      where: { id: idOrPhone },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  } else {
    await prisma.catalogVisitor.update({
      where: { phone: normalizeCustomerPhone(idOrPhone) },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }
  return { ok: true };
}

/** Whether prices are on by default for signed-in customers (shop-wide). */
export async function storefrontPricesDefaultVisible() {
  const settings = await getSettings();
  return settings.catalogPricesVisibleByDefault !== false;
}

/**
 * The one place that decides whether a given customer sees prices: the
 * shop-wide default, minus anyone the shop hid them from. Every path that
 * writes allow_prices goes through here so the switch and the per-customer
 * exception can never disagree.
 */
export async function effectiveAllowPrices(pricesHidden: boolean) {
  if (pricesHidden) return false;
  return storefrontPricesDefaultVisible();
}

/**
 * Re-apply the shop-wide default to every live catalog link. Without this,
 * flipping the switch only reached customers on their next sign-in, so the
 * setting looked broken for everyone already holding a link.
 */
export async function applyPricesDefaultToAllLinks() {
  const visible = await storefrontPricesDefaultVisible();
  await prisma.$executeRaw`
    UPDATE "catalog_access_links" AS l
    SET "allow_prices" = ${visible} AND NOT c."catalog_prices_hidden"
    FROM "customers" AS c
    WHERE c."id" = l."customer_id" AND l."revoked_at" IS NULL
  `;
  return { ok: true, visible };
}

/* ── First sign-in for a not-yet-customer ────────────────────────── */

/**
 * A signed-in visitor submits who they are. This does NOT create a Customer:
 * it raises the same CATALOG_ACCESS approval the public request form uses, so
 * the shop reviews and edits the details before the account exists.
 */
/* ── The signed-in customer's own account ────────────────────────── */

/**
 * Everything a customer can see about themselves — balance, invoices,
 * vouchers, statement — keyed by the catalog token they already hold.
 *
 * Deliberately reuses the same statement builder as the /client/:token
 * portal rather than re-querying: one definition of "what a customer's
 * account looks like", so the two views can never drift apart.
 */
export async function getAccountForCatalogToken(token: string) {
  const { getCatalogAccess } = await import("./catalog.service");
  const access = await getCatalogAccess(token);

  const { getCustomerTransactions } = await import("./customer.service");
  const [customer, statement, settings] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: access.customer.id, deletedAt: null },
      select: {
        id: true, name: true, phone: true, address: true,
        openingBalance: true, currentBalance: true,
        lastTransactionAt: true, loyaltyPoints: true,
      },
    }),
    getCustomerTransactions(access.customer.id, { all: true }),
    getSettings(),
  ]);
  if (!customer) throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");

  return {
    customer: {
      ...customer,
      openingBalance: Number(customer.openingBalance),
      currentBalance: Number(customer.currentBalance),
    },
    transactions: statement.transactions,
    storeName: settings.storeName,
    storePhone: settings.storePhone || null,
    currency: settings.currency,
  };
}
