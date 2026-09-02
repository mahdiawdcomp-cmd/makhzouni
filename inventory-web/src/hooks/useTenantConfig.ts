import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { API_BASE_URL } from "../api/client";

export interface TenantPlatforms {
  webEnabled?: boolean;
  androidEnabled?: boolean;
  desktopEnabled?: boolean;
  desktopWhiteLabelEnabled?: boolean;
  offlineLifetimeEnabled?: boolean;
}

export interface TenantConfig {
  mode: "standalone" | "saas";
  tenantId?: string | null;
  // ── Legacy (subscription-based) fields — unchanged meaning. ──
  plan?: string;
  features: string[];
  maxInvoices: number | null;
  maxCustomers: number | null;
  isExpired: boolean;
  isSuspended: boolean;
  expiresAt: string | null;
  // ── Batch 3 (inventory-backend) additions — all optional/undefined until
  // the backend is redeployed with the new /api/tenant-info shape. ──
  status?: string | null;
  licenseType?: string | null;
  activatedAt?: string | null;
  trialEndsAt?: string | null;
  entitlementExpiresAt?: string | null;
  entitlementFeatures?: string[];
  limits?: Record<string, unknown> | null;
  platforms?: TenantPlatforms | null;
  readOnly?: boolean;
  subscriptionSource?: string;
  lastCheckedAt?: string | null;
  warning?: string | null;
}

async function fetchTenantConfig(): Promise<TenantConfig> {
  // API_BASE_URL ALREADY ends in /api (from VITE_API_URL, or the "/api"
  // same-origin default). Re-reading the env var and appending "/api" produced
  // ".../api/api/tenant-info" — a silent 404 on every build that sets
  // VITE_API_URL, which is every deployed build. The query fails open, so the
  // tenant config has quietly been the fallback rather than the real answer.
  const { data } = await axios.get<TenantConfig>(`${API_BASE_URL}/tenant-info`);
  return data;
}

export function useTenantConfig() {
  return useQuery<TenantConfig>({
    queryKey: ["tenant-config"],
    queryFn: fetchTenantConfig,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/** Legacy — kept for the old subscription `features` list. Unused by Batch 4 gating below. */
export function hasFeature(config: TenantConfig | undefined, feature: string): boolean {
  if (!config) return true; // loading state — allow by default
  if (config.mode === "standalone") return true; // dev mode — all features on
  return config.features.includes(feature);
}

/**
 * Batch 4 — visual-only gating helpers, mirroring inventory-backend's
 * computeReadOnly()/hasFeature()/isPlatformEnabled() (tenant.middleware.ts).
 * None of these block any API call — the backend still allows everything
 * (report-only, Batch 3). Standalone mode (mahdi today) always resolves to
 * "everything on, never read-only" so behavior there is unchanged.
 */
export function useReadOnly(): boolean {
  const { data } = useTenantConfig();
  if (!data || data.mode === "standalone") return false;
  return !!data.readOnly;
}

export function useFeatureEnabled(featureKey: string): boolean {
  const { data } = useTenantConfig();
  if (!data || data.mode === "standalone") return true;
  const features = data.entitlementFeatures;
  // An EMPTY list means no optional features were purchased — the backend
  // blocks every mapped route in that case (featureDecision). Treating it as
  // "unrestricted" here made FeatureGate render pages the API then refused
  // with 403 FEATURE_NOT_ENABLED. Only a MISSING list means "unconfigured".
  if (!features) return true;
  return features.includes(featureKey);
}

export function usePlatformEnabled(platform: "web" | "android" | "desktop"): boolean {
  const { data } = useTenantConfig();
  if (!data || data.mode === "standalone") return true;
  const platforms = data.platforms;
  if (!platforms) return true;
  const key = `${platform}Enabled` as keyof TenantPlatforms;
  const value = platforms[key];
  return value === undefined ? true : !!value;
}

export const READ_ONLY_MESSAGE = "النظام بوضع المشاهدة فقط — الاشتراك منتهي أو موقوف.";
