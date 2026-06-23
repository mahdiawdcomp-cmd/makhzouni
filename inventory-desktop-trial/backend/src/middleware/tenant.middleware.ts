/**
 * Tenant-awareness middleware.
 * When TENANT_ID is set in env, this middleware:
 *   1. Attaches tenant config to every request (req.tenant)
 *   2. Checks subscription status with the Super Admin API on startup (cached 5 min)
 * Completely transparent when TENANT_ID is not set (single-tenant / dev mode).
 */
import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

export interface TenantConfig {
  tenantId: string;
  plan: string;
  features: string[];
  maxInvoices: number | null;
  maxCustomers: number | null;
  expiresAt: string | null;
  isExpired: boolean;
  isSuspended: boolean;
}

// In-memory cache
let cachedConfig: TenantConfig | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchTenantConfig(): Promise<TenantConfig | null> {
  const tenantId = process.env.TENANT_ID;
  const adminApiUrl = process.env.SUPER_ADMIN_API_URL;
  if (!tenantId || !adminApiUrl) return null;

  try {
    const resp = await fetch(`${adminApiUrl}/api/tenants/${tenantId}`, {
      headers: { Authorization: `Bearer ${process.env.SUPER_ADMIN_API_KEY ?? ""}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      logger.warn(`[tenant] Super Admin API returned ${resp.status}`);
      return null;
    }
    const data = await resp.json() as any;
    const sub = data.subscriptions?.find((s: any) => s.isActive);
    const isExpired = sub?.expiresAt ? new Date(sub.expiresAt) < new Date() : false;

    return {
      tenantId,
      plan: sub?.plan ?? "UNKNOWN",
      features: sub?.features ?? [],
      maxInvoices: sub?.maxInvoices ?? null,
      maxCustomers: sub?.maxCustomers ?? null,
      expiresAt: sub?.expiresAt ?? null,
      isExpired,
      isSuspended: data.status === "SUSPENDED",
    };
  } catch (err: any) {
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

export function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  // Attach lazily — don't block requests on the network call
  (req as any).getTenant = () => getTenantConfig();
  next();
}

/** Block the request if subscription is expired or tenant is suspended. */
export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction) {
  const cfg = await getTenantConfig();
  if (!cfg) { next(); return; } // No TENANT_ID set — skip check

  if (cfg.isSuspended) {
    res.status(403).json({ error: "SUBSCRIPTION_SUSPENDED", message: "الاشتراك موقوف. يرجى التواصل مع الدعم." });
    return;
  }
  if (cfg.isExpired) {
    res.status(403).json({ error: "SUBSCRIPTION_EXPIRED", message: "انتهت صلاحية الاشتراك. يرجى التجديد." });
    return;
  }
  next();
}
