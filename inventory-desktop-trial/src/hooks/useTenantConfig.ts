import { useQuery } from "@tanstack/react-query";
import axios from "axios";

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
  // In SaaS mode the frontend hits its own backend's /api/tenant-info
  const baseUrl = (import.meta as any).env?.VITE_API_URL ?? "";
  const { data } = await axios.get<TenantConfig>(`${baseUrl.replace(/\/+$/, "")}/api/tenant-info`);
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
 *
 * Desktop-specific: also goes read-only when platforms.desktopEnabled=false,
 * per Batch 4 spec ("خلي الواجهة read-only أو locked بصرياً" for that case).
 * Use useDesktopDisabled() separately to show the distinct banner message.
 */
export function useReadOnly(): boolean {
  const { data } = useTenantConfig();
  if (!data || data.mode === "standalone") return false;
  return !!data.readOnly || data.platforms?.desktopEnabled === false;
}

/** Desktop-only: true when this SaaS tenant has platforms.desktopEnabled=false. */
export function useDesktopDisabled(): boolean {
  const { data } = useTenantConfig();
  if (!data || data.mode === "standalone") return false;
  return data.platforms?.desktopEnabled === false;
}

export function useFeatureEnabled(featureKey: string): boolean {
  const { data } = useTenantConfig();
  if (!data || data.mode === "standalone") return true;
  const features = data.entitlementFeatures;
  // No entitlements configured yet for this tenant ⇒ unrestricted, same as backend.
  if (!features || features.length === 0) return true;
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
