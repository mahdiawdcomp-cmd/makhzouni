import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

export const api = axios.create({ baseURL: BASE_URL, withCredentials: false });

// Inject JWT token on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("sa_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-logout on 401
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("sa_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// ── Types ────────────────────────────────────────────────────────────────────
export type TenantStatus = "ACTIVE" | "SUSPENDED" | "EXPIRED";
export type SerialType = "ANDROID" | "WEB";
export type Plan = "TRIAL" | "BASIC" | "FULL";

export interface Subscription {
  id: string;
  plan: Plan;
  startsAt: string;
  expiresAt: string | null;
  maxInvoices: number | null;
  maxCustomers: number | null;
  features: string[];
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

export interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  backendUrl: string;
  status: TenantStatus;
  notes: string | null;
  createdAt: string;
  subscriptions: Subscription[];
  serialNumbers: SerialNumber[];
}

// ── API calls ─────────────────────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) =>
    api.post<{ token: string }>("/auth/login", { username, password }),
};

export const tenantsApi = {
  list: () => api.get<Tenant[]>("/tenants"),
  get: (id: string) => api.get<Tenant>(`/tenants/${id}`),
  create: (data: object) => api.post<Tenant>("/tenants", data),
  update: (id: string, data: object) => api.patch<Tenant>(`/tenants/${id}`, data),
  updateSubscription: (id: string, data: object) =>
    api.patch<Tenant>(`/tenants/${id}/subscription`, data),
  generateSerial: (id: string, data: { type: SerialType; label?: string }) =>
    api.post<SerialNumber>(`/tenants/${id}/serials`, data),
  toggleSerial: (tenantId: string, serialId: string, isActive: boolean) =>
    api.patch<SerialNumber>(`/tenants/${tenantId}/serials/${serialId}`, { isActive }),
};
