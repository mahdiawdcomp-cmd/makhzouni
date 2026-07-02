/**
 * Public route — no auth.
 * Returns tenant config for the frontend to know if subscription is active
 * and which features are enabled.
 *
 * Batch 3 (additive, report-only): adds status/licenseType/dates/limits/
 * platforms/readOnly/subscriptionSource/lastCheckedAt alongside the existing
 * fields. Nothing here blocks a request — readOnly is a reported value only.
 */
import { Router, Request, Response } from "express";
import { computeReadOnly, getTenantCheckMeta, getTenantConfig } from "../middleware/tenant.middleware";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  const cfg = await getTenantConfig();
  const { lastCheckedAt, lastFetchError, hasCache } = getTenantCheckMeta();

  if (!cfg) {
    const standalone = !process.env.TENANT_ID || !process.env.SUPER_ADMIN_API_URL;
    res.json({
      mode: "standalone",
      // Legacy fields — unchanged shape/meaning for existing web/desktop consumers.
      features: standalone ? ["ANDROID", "CATALOG", "AI", "MULTI_WAREHOUSE", "WHATSAPP"] : [],
      maxInvoices: null,
      maxCustomers: null,
      isExpired: false,
      isSuspended: false,
      expiresAt: null,
      // Batch 3 additions.
      tenantId: null,
      status: null,
      licenseType: null,
      activatedAt: null,
      trialEndsAt: null,
      // Entitlement-level expiry (Batch 1), distinct from the legacy
      // subscription `expiresAt` above — kept separate so existing
      // consumers of `expiresAt` never see a silent meaning change.
      entitlementExpiresAt: null,
      limits: null,
      platforms: null,
      readOnly: false,
      subscriptionSource: "none",
      lastCheckedAt,
      // Only populated when TENANT_ID/SUPER_ADMIN_API_URL ARE set but every
      // fetch has failed with no cache yet to fall back on.
      warning: !standalone && !hasCache
        ? `Super Admin API unreachable and no cache available: ${lastFetchError ?? "unknown error"}`
        : null,
    });
    return;
  }

  res.json({
    mode: "saas",
    tenantId: cfg.tenantId,
    // Legacy fields — unchanged shape/meaning for existing web/desktop consumers.
    plan: cfg.plan,
    features: cfg.features,
    maxInvoices: cfg.maxInvoices,
    maxCustomers: cfg.maxCustomers,
    isExpired: cfg.isExpired,
    isSuspended: cfg.isSuspended,
    expiresAt: cfg.expiresAt,
    // Batch 3 additions.
    status: cfg.status,
    licenseType: cfg.licenseType,
    activatedAt: cfg.activatedAt,
    trialEndsAt: cfg.trialEndsAt,
    entitlementExpiresAt: cfg.entitlementExpiresAt,
    entitlementFeatures: cfg.entitlementFeatures,
    limits: cfg.limits,
    platforms: cfg.platforms,
    readOnly: computeReadOnly(cfg),
    subscriptionSource: cfg.subscriptionSource,
    lastCheckedAt,
    warning: lastFetchError && !hasCache
      ? `Super Admin API unreachable and no cache available: ${lastFetchError}`
      : null,
  });
});

export default router;
