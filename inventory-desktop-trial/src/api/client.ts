import axios from "axios"

function cleanApiUrl(value: string | undefined) {
  const cleaned = value
    ?.replace(/^\uFEFF/, "")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .trim()

  return cleaned || undefined
}

// If VITE_API_URL is set explicitly use it; otherwise route through the
// same-origin proxy on hosted builds and Docker/nginx.
export let API_BASE_URL =
  cleanApiUrl(import.meta.env.VITE_API_URL) ?? "/api"

// Serialize arrays as repeated keys (?tags=a&tags=b) so Express/qs parses
// them correctly. Axios's default bracket notation (?tags[0]=a) is not
// handled by the backend's Zod schemas.
function serializeParams(params: Record<string, unknown>): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const v of value) sp.append(key, String(v))
    } else {
      sp.set(key, String(value))
    }
  }
  return sp.toString()
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  // Surface stuck requests as an error instead of spinning forever
  // (e.g. if the backend is restarting mid-deploy).
  timeout: 60000,
  headers: {
    "Content-Type": "application/json",
  },
  paramsSerializer: serializeParams,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("inventory_token")
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// No-auth instance for public endpoints (display screen, catalog, etc.)
export const publicApi = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
})

const PLATFORM_HOSTS = new Set(["mazbwoni.com", "www.mazbwoni.com", "app.mazbwoni.com"]);

export async function configureTenantApi(): Promise<void> {
  if (import.meta.env.DEV) return;

  const hostname = window.location.hostname.toLowerCase();
  if (PLATFORM_HOSTS.has(hostname) || hostname === "localhost" || hostname === "127.0.0.1") return;
  if (!hostname.endsWith(".mazbwoni.com")) return;

  const subdomain = hostname.slice(0, -".mazbwoni.com".length);
  if (!subdomain || subdomain.includes(".")) return;

  const resolverUrl = cleanApiUrl(import.meta.env.VITE_TENANT_CONFIG_URL)
    ?? "https://admin-api.mazbwoni.com/api/tenant-config";
  const response = await axios.get<{
    backendUrl: string;
    status: "ACTIVE" | "SUSPENDED" | "EXPIRED";
  }>(resolverUrl, { params: { subdomain }, timeout: 10000 });

  if (response.data.status !== "ACTIVE") {
    sessionStorage.setItem("tenant_access_status", response.data.status);
  }

  API_BASE_URL = `${response.data.backendUrl.replace(/\/+$/, "")}/api`;
  api.defaults.baseURL = API_BASE_URL;
  publicApi.defaults.baseURL = API_BASE_URL;
  sessionStorage.setItem("tenant_subdomain", subdomain);
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("inventory_token")
      localStorage.removeItem("inventory_user")
      if (window.location.pathname !== "/login") {
        window.location.assign("/login") // FIXED
      }
    }
    return Promise.reject(error)
  },
)
