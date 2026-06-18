import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export interface TenantConfig {
  mode: "standalone" | "saas";
  tenantId?: string;
  plan?: string;
  features: string[];
  maxInvoices: number | null;
  maxCustomers: number | null;
  isExpired: boolean;
  isSuspended: boolean;
  expiresAt: string | null;
}

async function fetchTenantConfig(): Promise<TenantConfig> {
  // In SaaS mode the frontend hits its own backend's /api/tenant-info
  const baseUrl = (import.meta as any).env?.VITE_API_URL ?? "";
  const { data } = await axios.get<TenantConfig>(`${baseUrl}/api/tenant-info`);
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

export function hasFeature(config: TenantConfig | undefined, feature: string): boolean {
  if (!config) return true; // loading state — allow by default
  if (config.mode === "standalone") return true; // dev mode — all features on
  return config.features.includes(feature);
}
