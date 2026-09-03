import { create } from "zustand"
import type { Role, User, UserPermission } from "../types/api"

interface AuthState {
  token: string | null
  user: User | null
  rememberMe: boolean
  setSession: (token: string, user: User, rememberMe: boolean) => void
  refreshUser: (user: User) => void
  logout: () => void
  isAuthenticated: () => boolean
  isAdmin: () => boolean
  hasPermission: (permission: UserPermission) => boolean
  canViewProfitReports: () => boolean
  isPosOnly: () => boolean
  isWorkerOnly: () => boolean
  isSalesAgent: () => boolean
}

function readUser() {
  const raw = localStorage.getItem("inventory_user")
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem("inventory_token"),
  user: readUser(),
  rememberMe: localStorage.getItem("inventory_remember") === "true",
  setSession: (token, user, rememberMe) => {
    localStorage.setItem("inventory_token", token)
    localStorage.setItem("inventory_user", JSON.stringify(user))
    localStorage.setItem("inventory_remember", String(rememberMe))
    set({ token, user, rememberMe })
  },
  refreshUser: (user) => {
    localStorage.setItem("inventory_user", JSON.stringify(user))
    set({ user })
  },
  logout: () => {
    localStorage.removeItem("inventory_token")
    localStorage.removeItem("inventory_user")
    localStorage.removeItem("inventory_remember")
    set({ token: null, user: null, rememberMe: false })
  },
  isAuthenticated: () => Boolean(get().token && get().user),
  isAdmin: () => (get().user?.role as Role | undefined) === "ADMIN",
  hasPermission: (permission) => {
    const user = get().user
    return Boolean(user && (user.role === "ADMIN" || user.permissions?.includes(permission)))
  },
  // Profit / financial-reports visibility. Revocable even from an ADMIN via the
  // HIDE_PROFIT_REPORTS deny marker; otherwise admins see it, and staff see it when
  // they hold VIEW_REPORTS. Mirrors canViewProfitReports() on the backend.
  canViewProfitReports: () => {
    const user = get().user
    if (!user) return false
    if (user.permissions?.includes("HIDE_PROFIT_REPORTS")) return false
    if (user.role === "ADMIN") return true
    return Boolean(user.permissions?.includes("VIEW_REPORTS"))
  },
  isPosOnly: () => {
    const user = get().user
    if (!user || user.role === "ADMIN") return false
    const perms = user.permissions ?? []
    // POS-only: staff with zero permissions or whose only permission is ACCESS_POS
    return perms.length === 0 || perms.every((p) => p === "ACCESS_POS")
  },
  // «المندوب» — a restriction, not a power, so an ADMIN does NOT pass by
  // default the way it does for ordinary capabilities. Only an account the
  // owner explicitly marked as a rep is confined to the rep screen.
  isSalesAgent: () => {
    const user = get().user
    return Boolean(user?.permissions?.includes("SALES_AGENT"))
  },
  isWorkerOnly: () => {
    const user = get().user
    if (!user || user.role === "ADMIN") return false
    const perms = user.permissions ?? []
    // Warehouse worker: staff whose permissions are ONLY the worker pair
    // (VIEW_WITHOUT_PRICES / REQUEST_TRANSFER). Mirrors isPosOnly above.
    return (
      perms.length > 0 &&
      perms.every((p) => p === "VIEW_WITHOUT_PRICES" || p === "REQUEST_TRANSFER")
    )
  },
}))
