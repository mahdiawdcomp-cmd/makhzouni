/**
 * Public route — no auth.
 * Returns tenant config for the frontend to know if subscription is active
 * and which features are enabled.
 */
import { Router, Request, Response } from "express";
import { getTenantConfig } from "../middleware/tenant.middleware";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  const cfg = await getTenantConfig();
  if (!cfg) {
    // Running without TENANT_ID — single-tenant / dev mode: everything enabled
    res.json({
      mode: "standalone",
      features: ["ANDROID", "CATALOG", "AI", "MULTI_WAREHOUSE", "WHATSAPP"],
      maxInvoices: null,
      maxCustomers: null,
      isExpired: false,
      isSuspended: false,
      expiresAt: null,
    });
    return;
  }
  res.json({
    mode: "saas",
    tenantId: cfg.tenantId,
    plan: cfg.plan,
    features: cfg.features,
    maxInvoices: cfg.maxInvoices,
    maxCustomers: cfg.maxCustomers,
    isExpired: cfg.isExpired,
    isSuspended: cfg.isSuspended,
    expiresAt: cfg.expiresAt,
  });
});

export default router;
