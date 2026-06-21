import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";
export const DOMAIN_ROOT = import.meta.env.VITE_DOMAIN_ROOT ?? "mazbwoni.com";

export const api = axios.create({ baseURL: BASE_URL, timeout: 15000 });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("sa_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("sa_token");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);

export type TenantStatus = "ACTIVE" | "SUSPENDED" | "EXPIRED";
export type ProvisioningStatus = "PENDING" | "READY" | "ERROR";
export type SerialType = "ANDROID" | "WEB";
export type Plan = "TRIAL" | "BASIC" | "PRO" | "FULL";
export type FeatureKey =
  | "ANDROID" | "CATALOG" | "AI" | "WHATSAPP" | "MULTI_WAREHOUSE"
  | "POS" | "QUOTATIONS" | "RETURNS" | "OFFLINE" | "AUDIT_LOG";

export interface Subscription {
  id: string;
  plan: Plan;
  startsAt: string;
  expiresAt: string | null;
  maxInvoices: number | null;
  maxCustomers: number | null;
  maxUsers: number | null;
  maxWarehouses: number | null;
  maxAndroidDevices: number | null;
  features: FeatureKey[];
  price: number | null;
  currency: "IQD" | "USD";
  billingCycle: "MONTHLY" | "YEARLY" | "CUSTOM";
  isActive: boolean;
}

export interface SerialNumber {
  id: string;
  code: string;
  type: SerialType;
  label: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface AdminAuditLog {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface Tenant {
  id: string;
  name: string;
  ownerName: string | null;
  phone: string | null;
  email: string | null;
  subdomain: string;
  frontendUrl: string | null;
  backendUrl: string;
  customDomain: string | null;
  status: TenantStatus;
  provisioningStatus: ProvisioningStatus;
  provisioningError: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  subscriptions: Subscription[];
  serialNumbers: SerialNumber[];
  auditLogs?: AdminAuditLog[];
}

export interface Summary {
  total: number;
  active: number;
  suspended: number;
  expired: number;
  expiringSoon: number;
  activeDevices: number;
}

export const authApi = {
  login: (username: string, password: string) =>
    api.post<{ token: string }>("/auth/login", { username, password }),
};

export const tenantsApi = {
  list: (params?: { q?: string; status?: string }) => api.get<Tenant[]>("/tenants", { params }),
  summary: () => api.get<Summary>("/tenants/summary"),
  get: (id: string) => api.get<Tenant>(`/tenants/${id}`),
  create: (data: object) => api.post<Tenant>("/tenants", data),
  update: (id: string, data: object) => api.patch<Tenant>(`/tenants/${id}`, data),
  updateSubscription: (id: string, data: object) =>
    api.patch<Tenant>(`/tenants/${id}/subscription`, data),
  generateSerial: (id: string, data: { type: SerialType; label?: string }) =>
    api.post<SerialNumber>(`/tenants/${id}/serials`, data),
  toggleSerial: (tenantId: string, serialId: string, isActive: boolean) =>
    api.patch<SerialNumber>(`/tenants/${tenantId}/serials/${serialId}`, { isActive }),
  checkBackend: (id: string) => api.post<{ ok: boolean; latencyMs?: number }>(`/tenants/${id}/check-backend`),
};

export function getErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) return "حدث خطأ غير متوقع";
  const code = error.response?.data?.error;
  const messages: Record<string, string> = {
    DOMAIN_ALREADY_USED: "الرابط مستخدم من محل آخر",
    ANDROID_DEVICE_LIMIT_REACHED: "وصل المحل إلى الحد الأعلى لأجهزة أندرويد",
    TENANT_NOT_FOUND: "المحل غير موجود",
    VALIDATION_ERROR: "راجع الحقول المطلوبة والقيم المدخلة",
  };
  return messages[code] ?? error.response?.data?.message ?? "تعذر الاتصال بالخادم";
}
