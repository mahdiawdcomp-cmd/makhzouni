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
 * Batch 6 — route → required-feature map, now used for BOTH the (fixed)
 * report-only logger AND real enforcement (enforceFeatureMiddleware).
 *
 * Keys must match saas-admin-api's FEATURE_KEYS (src/entitlements.ts).
 *
 * IMPORTANT prefix convention (was a bug in Batch 3): both middlewares are
 * mounted via `app.use("/api", …)`, so Express strips the `/api` mount prefix
 * and `req.path` is already mount-relative (e.g. "/campaigns", NOT
 * "/api/campaigns"). The old map baked "/api/" into every prefix, so nothing
 * ever matched and Batch 3's logging silently never fired. All prefixes here
 * are mount-relative. `matchFeatureRule` also strips a leading "/api"
 * defensively, mirroring isAllowedInReadOnly.
 *
 * A rule matches by `prefix` (path === prefix OR path startsWith prefix + "/")
 * OR by an optional `test(path)` predicate — used for the AI error-analysis
 * endpoints, which are `/error-logs/analyze-health` and `/error-logs/:id/analyze`
 * (there is NO literal `/error-logs/analyze` path; the plain `/error-logs` list
 * and `/error-logs/:id/resolve` must NOT be gated).
 *
 * Only OPTIONAL/PREMIUM features are listed. Core/basic routes (products,
 * customers, invoices, vouchers, reports, users, settings, backup, …) are
 * intentionally absent so they are never gated — see the task spec §3.
 */
export interface RouteFeatureRule {
  featureKey: string;
  prefix?: string;
  test?: (path: string) => boolean;
  /** Human-readable route description, for logs only. */
  label: string;
}

export const ROUTE_FEATURE_MAP: ReadonlyArray<RouteFeatureRule> = [
  { prefix: "/catalog-management", featureKey: "catalogWholesale", label: "/catalog-management" },
  { prefix: "/retail-catalog", featureKey: "retailShop", label: "/retail-catalog" },
  { prefix: "/campaigns", featureKey: "whatsappCampaigns", label: "/campaigns" },
  { prefix: "/transfers", featureKey: "transfers", label: "/transfers" },
  { prefix: "/audit-logs", featureKey: "auditLog", label: "/audit-logs" },
  { prefix: "/inbound-messages", featureKey: "whatsappInbox", label: "/inbound-messages" },
  { prefix: "/whatsapp-chat", featureKey: "whatsappCampaigns", label: "/whatsapp-chat" },
  { prefix: "/quotations", featureKey: "quotations", label: "/quotations" },
  // dailyClosing: the end-of-day cash-closing report only. Narrow exact prefix
  // so no other /reports/* endpoint is affected. profitReports is intentionally
  // NOT gated here — it is still listed under the always-on BASE version, so
  // gating it would break tenants that were never granted the key (needs a
  // product decision + entitlements cleanup first).
  { prefix: "/reports/end-of-day", featureKey: "dailyClosing", label: "/reports/end-of-day" },
  // stocktake: gate the authenticated management routes, but keep the public
  // worker QR flow (/stocktake/public/:token/...) reachable — it's token-authed,
  // not tenant-session-based, and must not be broken by feature gating.
  {
    featureKey: "stocktake",
    label: "/stocktake (excluding /stocktake/public/*)",
    test: (p) =>
      (p === "/stocktake" || p.startsWith("/stocktake/")) && !p.startsWith("/stocktake/public"),
  },
  // whatsapp send-invoice: exact prefix for /whatsapp/send-invoice/:invoiceId.
  { prefix: "/whatsapp/send-invoice", featureKey: "whatsappInvoices", label: "/whatsapp/send-invoice" },
  // whatsapp generic/manual send: exact path only (NOT /status, /restart).
  { featureKey: "whatsappCampaigns", label: "/whatsapp/send (exact)", test: (p) => p === "/whatsapp/send" },
  // error-logs AI analysis only — NOT the plain list or /:id/resolve.
  {
    featureKey: "aiErrorAnalysis",
    label: "/error-logs AI analysis",
    test: (p) => p === "/error-logs/analyze-health" || /^\/error-logs\/[^/]+\/analyze$/.test(p),
  },
];

/** Strip a leading "/api" (defensive) exactly like isAllowedInReadOnly. */
function stripApiPrefix(rawPath: string): string {
  return rawPath.replace(/^\/api(?=\/|$)/, "");
}

/** Returns the first rule matching this (mount-relative) path, or null. */
export function matchFeatureRule(rawPath: string): RouteFeatureRule | null {
  const path = stripApiPrefix(rawPath);
  for (const rule of ROUTE_FEATURE_MAP) {
    if (rule.test) {
      if (rule.test(path)) return rule;
    } else if (rule.prefix && (path === rule.prefix || path.startsWith(rule.prefix + "/"))) {
      return rule;
    }
  }
  return null;
}

/**
 * Batch 3 — report-only middleware. For SaaS tenants with entitlements
 * configured, logs when a mapped route is hit without the required feature.
 * ALWAYS calls next() — never blocks, never throws. No-op in standalone mode
 * or for tenants with no entitlements configured yet (features = []).
 *
 * Batch 6: now uses the FIXED, mount-relative map so this logging actually
 * fires. It shares matchFeatureRule with the real enforcement middleware so
 * the two can never drift apart.
 */
export async function reportOnlyEntitlementsMiddleware(req: Request, _res: Response, next: NextFunction) {
  const cfg = await getTenantConfig();
  if (!cfg || cfg.entitlementFeatures.length === 0) { next(); return; }

  const match = matchFeatureRule(req.path);
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

// ── Batch 6: real paid-feature entitlement enforcement ──────────────────────
//
// Blocks routes that require an entitlement the tenant doesn't have, with
// 403 FEATURE_NOT_ENABLED (JSON, never HTML). Independent of Batch 5's
// read-only enforcement and mounted AFTER it in server.ts, so subscription
// expiry (READ_ONLY_MODE, 423) always takes priority over a missing feature.
//
// Safety guarantees (identical to enforceReadOnlyMiddleware):
//   - Standalone / no TENANT_ID / no Super-Admin cache ⇒ getTenantConfig()
//     returns null ⇒ featureDecision returns "allow" ⇒ never blocks (mahdi
//     is 100% unaffected).
//   - Super Admin unreachable but a cache exists ⇒ getTenantConfig() returns
//     the cached config ⇒ feature enforcement is applied from cache (fail-safe).
//   - entitlementFeatures null/undefined ⇒ fail-open (guarded defensively; the
//     TenantConfig type always sets it to [], but never trust that here).
//   - OPTIONS (CORS preflight) is never blocked.
//   - Only OPTIONAL/PREMIUM mapped routes can block; core/basic routes are not
//     in ROUTE_FEATURE_MAP at all, so they always pass — even when
//     entitlementFeatures === [] (an explicit empty list still only gates the
//     mapped premium features).

/**
 * Pure allow/deny for a single request against the feature map. Exported for
 * unit tests so every branch is testable without mocking the network.
 * Returns "allow", or "block:<featureKey>" when the route needs a feature the
 * tenant lacks.
 */
export function featureDecision(
  cfg: TenantConfig | null,
  method: string,
  path: string
): "allow" | `block:${string}` {
  if (method.toUpperCase() === "OPTIONS") return "allow"; // CORS preflight
  if (!cfg) return "allow";                               // standalone / unresolved / no cache → fail-open
  if (!Array.isArray(cfg.entitlementFeatures)) return "allow"; // defensive fail-open
  const rule = matchFeatureRule(path);
  if (!rule) return "allow";                              // core/basic/unmapped route
  if (cfg.entitlementFeatures.includes(rule.featureKey)) return "allow";
  return `block:${rule.featureKey}`;
}

/** Builds the exact FEATURE_NOT_ENABLED response body for a feature key. */
export function featureNotEnabledResponse(featureKey: string) {
  return {
    error: "FEATURE_NOT_ENABLED",
    message: "هذه الميزة غير مفعلة في نسختك.",
    feature: featureKey,
  } as const;
}

/**
 * Batch 6 — enforces paid-feature entitlements for SaaS tenants. Returns
 * 403 FEATURE_NOT_ENABLED (JSON) when a mapped route's feature is missing.
 * Never throws; a failure to resolve tenant state fails open. Must run AFTER
 * enforceReadOnlyMiddleware so subscription expiry (423) wins over a missing
 * feature.
 */
export async function enforceFeatureMiddleware(req: Request, res: Response, next: NextFunction) {
  let cfg: TenantConfig | null = null;
  try {
    cfg = await getTenantConfig();
  } catch (err: any) {
    // getTenantConfig already swallows fetch errors, but never let an
    // unexpected throw take the request down — fail open.
    logger.warn(`[tenant] feature check could not resolve tenant, failing open: ${err?.message}`);
    next();
    return;
  }
  const decision = featureDecision(cfg, req.method, req.path);
  if (decision === "allow") { next(); return; }
  const featureKey = decision.slice("block:".length);
  res.status(403).json(featureNotEnabledResponse(featureKey));
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
