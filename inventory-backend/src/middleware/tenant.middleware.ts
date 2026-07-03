/**
 * Tenant-awareness middleware.
 * When TENANT_ID is set in env, this middleware:
 *   1. Attaches tenant config to every request (req.tenant)
 *   2. Checks subscription status with the Super Admin API on startup (cached 5 min)
 * Completely transparent when TENANT_ID is not set (single-tenant / dev mode).
 *
 * Batch 3 (additive, report-only): also carries the Batch-1 entitlements
 * fields (status/licenseType/dates/features/limits/platforms) from the same
 * Super Admin response, plus a computed `readOnly` flag and feature-check
 * helpers. None of this blocks anything yet — see reportFeatureWouldBlock().
 */
import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import prisma from "../config/database";

export interface TenantLimits {
  maxAndroidDevices?: number | null;
  whatsappMonthlyLimit?: number | null;
  whatsappLimitEnabled?: boolean;
}

export interface TenantPlatforms {
  webEnabled?: boolean;
  androidEnabled?: boolean;
  desktopEnabled?: boolean;
  desktopWhiteLabelEnabled?: boolean;
  offlineLifetimeEnabled?: boolean;
}

export type SubscriptionSource = "entitlements" | "legacy-subscription" | "none";

export interface TenantConfig {
  tenantId: string;
  // ── Legacy (subscription-based) fields. Consumed by requireActiveSubscription
  // and enforcePlanLimit below — real enforcement already lives on these two.
  // Do not repurpose or remove; Batch 3 only adds new fields alongside them.
  plan: string;
  features: string[];
  maxInvoices: number | null;
  maxCustomers: number | null;
  expiresAt: string | null;
  isExpired: boolean;
  isSuspended: boolean;
  // ── Batch 3 (additive): raw Batch-1 entitlements from the tenant record.
  status: string | null;
  licenseType: string | null;
  activatedAt: string | null;
  entitlementExpiresAt: string | null;
  trialEndsAt: string | null;
  entitlementFeatures: string[];
  limits: TenantLimits | null;
  platforms: TenantPlatforms | null;
  subscriptionSource: SubscriptionSource;
}

// In-memory cache
let cachedConfig: TenantConfig | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Batch 3: last fetch bookkeeping, exposed via /api/tenant-info so a stale
// cache or an unreachable Super Admin is visible instead of silent.
let lastCheckedAt: number | null = null;
let lastFetchError: string | null = null;

async function fetchTenantConfig(): Promise<TenantConfig | null> {
  const tenantId = process.env.TENANT_ID;
  const adminApiUrl = process.env.SUPER_ADMIN_API_URL;
  if (!tenantId || !adminApiUrl) return null;

  lastCheckedAt = Date.now();
  try {
    const resp = await fetch(`${adminApiUrl}/api/tenants/${tenantId}`, {
      headers: { Authorization: `Bearer ${process.env.SUPER_ADMIN_API_KEY ?? ""}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      lastFetchError = `Super Admin API returned ${resp.status}`;
      logger.warn(`[tenant] ${lastFetchError}`);
      return null;
    }
    const data = await resp.json() as any;
    const sub = data.subscriptions?.find((s: any) => s.isActive);
    const isExpired = sub?.expiresAt ? new Date(sub.expiresAt) < new Date() : false;
    const entitlementFeatures: string[] = Array.isArray(data.features) ? data.features : [];
    const subscriptionSource: SubscriptionSource =
      data.licenseType || entitlementFeatures.length > 0
        ? "entitlements"
        : sub
          ? "legacy-subscription"
          : "none";

    lastFetchError = null;
    return {
      tenantId,
      plan: sub?.plan ?? "UNKNOWN",
      features: sub?.features ?? [],
      maxInvoices: sub?.maxInvoices ?? null,
      maxCustomers: sub?.maxCustomers ?? null,
      expiresAt: sub?.expiresAt ?? null,
      isExpired,
      isSuspended: data.status === "SUSPENDED",
      status: data.status ?? null,
      licenseType: data.licenseType ?? null,
      activatedAt: data.activatedAt ?? null,
      entitlementExpiresAt: data.expiresAt ?? null,
      trialEndsAt: data.trialEndsAt ?? null,
      entitlementFeatures,
      limits: data.limits ?? null,
      platforms: data.platforms ?? null,
      subscriptionSource,
    };
  } catch (err: any) {
    lastFetchError = err.message;
    logger.warn(`[tenant] Could not reach Super Admin API: ${err.message}`);
    return null;
  }
}

export async function getTenantConfig(): Promise<TenantConfig | null> {
  if (!process.env.TENANT_ID) return null;
  if (cachedConfig && Date.now() < cacheExpiresAt) return cachedConfig;
  const config = await fetchTenantConfig();
  if (config) {
    cachedConfig = config;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  }
  return cachedConfig;
}

/** Batch 3 bookkeeping exposed to /api/tenant-info — never throws, never blocks. */
export function getTenantCheckMeta(): { lastCheckedAt: string | null; lastFetchError: string | null; hasCache: boolean } {
  return {
    lastCheckedAt: lastCheckedAt ? new Date(lastCheckedAt).toISOString() : null,
    lastFetchError,
    hasCache: cachedConfig !== null,
  };
}

/** Pure — used by isReadOnly() and by /api/tenant-info so both agree. */
export function computeReadOnly(cfg: TenantConfig | null): boolean {
  if (!cfg) return false; // standalone — never read-only
  const now = Date.now();
  if (cfg.status === "EXPIRED" || cfg.status === "SUSPENDED") return true;
  if (cfg.entitlementExpiresAt && new Date(cfg.entitlementExpiresAt).getTime() < now) return true;
  if (cfg.licenseType === "TRIAL" && cfg.trialEndsAt && new Date(cfg.trialEndsAt).getTime() < now) return true;
  // Batch 5.1: also honor the legacy subscription flags. requireActiveSubscription
  // used to FULL-block (403, even GET) on these; that block is now removed and
  // enforceReadOnlyMiddleware handles them as read-only instead. Including them
  // here guarantees every previously-full-blocked tenant still gets locked down
  // (read-only) rather than falling fully open.
  if (cfg.isExpired || cfg.isSuspended) return true;
  return false;
}

/** Batch 3 helper — full entitlements snapshot (null in standalone mode). */
export async function getTenantEntitlements(): Promise<TenantConfig | null> {
  return getTenantConfig();
}

/**
 * Batch 3 helper — report-only. NOT wired to block anything.
 * Standalone (no TENANT_ID) and tenants with no entitlements configured yet
 * are always unrestricted, matching current production behavior.
 */
export async function hasFeature(featureKey: string): Promise<boolean> {
  const cfg = await getTenantConfig();
  if (!cfg) return true;
  if (cfg.entitlementFeatures.length === 0) return true;
  return cfg.entitlementFeatures.includes(featureKey);
}

/** Batch 3 helper — report-only value, not enforced anywhere yet. */
export async function isReadOnly(): Promise<boolean> {
  return computeReadOnly(await getTenantConfig());
}

/** Batch 3 helper — report-only. No `platforms` configured ⇒ unrestricted. */
export async function isPlatformEnabled(platform: "web" | "android" | "desktop"): Promise<boolean> {
  const cfg = await getTenantConfig();
  if (!cfg?.platforms) return true;
  const key = `${platform}Enabled` as keyof TenantPlatforms;
  const value = cfg.platforms[key];
  return value === undefined ? true : Boolean(value);
}

/** Batch 3 — logs only, never throws, never blocks. */
export function reportFeatureWouldBlock(featureKey: string, route: string): void {
  logger.info(`REPORT_ONLY: feature ${featureKey} would block route ${route}`);
}

/**
 * Batch 3 — route → required-feature map, report-only. Keys must match
 * saas-admin-api's FEATURE_KEYS (src/entitlements.ts). Adding an entry here
 * does not block anything; it only makes reportFeatureWouldBlock() fire.
 */
export const ROUTE_FEATURE_MAP: ReadonlyArray<{ prefix: string; featureKey: string }> = [
  { prefix: "/api/catalog", featureKey: "catalogWholesale" },
  { prefix: "/api/shop", featureKey: "retailShop" },
  { prefix: "/api/retail", featureKey: "retailShop" },
  { prefix: "/api/campaigns", featureKey: "whatsappCampaigns" },
  { prefix: "/api/stocktake", featureKey: "stocktake" },
  { prefix: "/api/transfers", featureKey: "transfers" },
  { prefix: "/api/audit-logs", featureKey: "auditLog" },
  { prefix: "/api/error-logs/analyze", featureKey: "aiErrorAnalysis" },
  { prefix: "/api/backup/online", featureKey: "onlineBackup" },
];

/**
 * Batch 3 — report-only middleware. For SaaS tenants with entitlements
 * configured, logs when a mapped route is hit without the required feature.
 * ALWAYS calls next() — never blocks, never throws. No-op in standalone mode
 * or for tenants with no entitlements configured yet (features = []).
 */
export async function reportOnlyEntitlementsMiddleware(req: Request, _res: Response, next: NextFunction) {
  const cfg = await getTenantConfig();
  if (!cfg || cfg.entitlementFeatures.length === 0) { next(); return; }

  const match = ROUTE_FEATURE_MAP.find((m) => req.path.startsWith(m.prefix));
  if (match && !cfg.entitlementFeatures.includes(match.featureKey)) {
    reportFeatureWouldBlock(match.featureKey, req.path);
  }
  next();
}

// ── Batch 5: real read-only enforcement (writes blocked on expiry) ──────────
//
// Turns the Batch-3 report-only `computeReadOnly()` into actual enforcement,
// but ONLY blocks state-changing requests — reads/exports/prints/backups still
// work so an expired tenant can view and export their data. This is a NEW,
// independent middleware; requireActiveSubscription and enforcePlanLimit are
// left untouched.
//
// Safety guarantees (mirrors the rest of this file):
//   - Standalone / no TENANT_ID / no Super-Admin cache ⇒ getTenantConfig()
//     returns null ⇒ readOnlyDecision returns "allow" ⇒ never blocks.
//   - Super Admin unreachable but a cache exists ⇒ getTenantConfig() returns
//     the cached config ⇒ read-only is applied from cache (fail-safe read-only,
//     never a crash). No cache ever ⇒ null ⇒ fail-open.
//   - Only mode === "saas" (cfg != null) AND computeReadOnly(cfg) === true
//     reaches the block path.

const READ_ONLY_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Path PREFIXES that stay open even for write methods while read-only.
 * Matched against `req.path`, which Express strips to be relative to the
 * `/api` mount (e.g. "/auth/login", not "/api/auth/login") — the same
 * convention requireActiveSubscription already relies on in server.ts.
 */
const READ_ONLY_ALLOWED_PREFIXES: readonly string[] = [
  "/tenant-info", // subscription state — must always be readable
  "/public",      // exempt exactly like requireActiveSubscription (WhatsApp
                  // inbound webhook, OTP/access flows needed just to VIEW)
  "/health",      // health checks
  "/auth",        // login/logout/refresh/change-password must never be locked out
  "/realtime",    // SSE stream (read)
];

/**
 * Exact non-GET endpoints that are safe while read-only: creating/exporting a
 * backup does not mutate business data. There is intentionally NO full-backup
 * RESTORE endpoint in this backend (backups are external), and destructive
 * settings endpoints (danger/wipe, danger/merge, PUT /settings) are NOT listed
 * here, so they fall through to the default block.
 */
const READ_ONLY_ALLOWED_EXACT: readonly string[] = [
  "/settings/backup/run",      // create backup (POST)
  "/settings/backup/telegram", // export/send backup (POST)
];

/**
 * Pure allow/deny for a single request while read-only is active. Exported for
 * unit tests. `rawPath` may be either mount-relative ("/invoices") or absolute
 * ("/api/invoices") — a leading "/api" is stripped defensively.
 */
export function isAllowedInReadOnly(method: string, rawPath: string): boolean {
  if (READ_ONLY_SAFE_METHODS.has(method.toUpperCase())) return true;
  const path = rawPath.replace(/^\/api(?=\/|$)/, "");
  if (READ_ONLY_ALLOWED_EXACT.includes(path)) return true;
  return READ_ONLY_ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
}

/**
 * Pure decision combining tenant state + request. Exported for unit tests so
 * every branch (standalone, active, read-only allow, read-only block) is
 * testable without mocking modules or the network.
 */
export function readOnlyDecision(cfg: TenantConfig | null, method: string, path: string): "allow" | "block" {
  if (!cfg) return "allow";                    // standalone / unresolved / no cache → fail-open
  if (!computeReadOnly(cfg)) return "allow";   // active subscription → open
  return isAllowedInReadOnly(method, path) ? "allow" : "block";
}

export const READ_ONLY_RESPONSE = {
  error: "READ_ONLY_MODE",
  message: "الاشتراك منتهي أو موقوف. النظام يعمل بوضع المشاهدة فقط.",
  readOnly: true,
} as const;

/**
 * Batch 5 — enforces read-only for expired/suspended SaaS tenants. Blocks
 * business-data writes with 423 Locked (JSON, never HTML), lets reads through.
 * Never throws; a failure to resolve tenant state fails open.
 */
export async function enforceReadOnlyMiddleware(req: Request, res: Response, next: NextFunction) {
  let cfg: TenantConfig | null = null;
  try {
    cfg = await getTenantConfig();
  } catch (err: any) {
    // getTenantConfig already swallows fetch errors, but never let an
    // unexpected throw take the request down — fail open.
    logger.warn(`[tenant] read-only check could not resolve tenant, failing open: ${err?.message}`);
    next();
    return;
  }
  if (readOnlyDecision(cfg, req.method, req.path) === "allow") { next(); return; }
  res.status(423).json(READ_ONLY_RESPONSE);
}

export function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  // Attach lazily — don't block requests on the network call
  (req as any).getTenant = () => getTenantConfig();
  next();
}

/**
 * @deprecated Superseded by enforceReadOnlyMiddleware (Batch 5.1) and no longer
 * mounted in server.ts.
 *
 * It used to FULL-block (403 SUBSCRIPTION_SUSPENDED / SUBSCRIPTION_EXPIRED) —
 * including GET — for expired/suspended SaaS tenants. That defeated the read-only
 * goal: an expired tenant couldn't even view or export their data. Enforcement
 * now lives entirely in enforceReadOnlyMiddleware, which allows reads/exports/
 * backups and blocks only writes (423 READ_ONLY_MODE). computeReadOnly() was
 * extended to cover the legacy isExpired/isSuspended flags, so the exact same
 * tenants are still locked down — just as read-only instead of a hard wall.
 *
 * Kept as a thin delegator (never a hard 403) so any lingering/future caller
 * inherits the correct read-only behavior instead of the old landmine.
 */
export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction) {
  return enforceReadOnlyMiddleware(req, res, next);
}

/**
 * Enforces the plan's maxInvoices / maxCustomers ceilings. Apply ONLY on the
 * create routes (POST). No TENANT_ID or a null limit ⇒ unlimited (skips).
 * Counts are read live; the small TOCTOU window is acceptable for a soft
 * commercial cap (a tenant can't meaningfully exceed it by racing).
 */
export function enforcePlanLimit(resource: "invoice" | "customer") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const cfg = await getTenantConfig();
    if (!cfg) { next(); return; } // single-tenant / dev — no limits

    const limit = resource === "invoice" ? cfg.maxInvoices : cfg.maxCustomers;
    if (limit === null || limit === undefined) { next(); return; } // unlimited

    const count = resource === "invoice"
      ? await prisma.invoice.count()
      : await prisma.customer.count({ where: { deletedAt: null } });

    if (count >= limit) {
      res.status(403).json({
        error: "PLAN_LIMIT_REACHED",
        message: resource === "invoice"
          ? `وصلت للحد الأقصى من الفواتير (${limit}) في باقتك. يرجى الترقية.`
          : `وصلت للحد الأقصى من الزبائن (${limit}) في باقتك. يرجى الترقية.`,
      });
      return;
    }
    next();
  };
}
