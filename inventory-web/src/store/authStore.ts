import { create } from "zustand"
import type { Role, User, UserPermission } from "../types/api"

interface AuthState {
  token: string | null
  user: User | null
  rememberMe: boolean
  setSession: (token: string, user: User, rememberMe: boolean) => void
  logout: () => void
  isAuthenticated: () => boolean
  isAdmin: () => boolean
  hasPermission: (permission: UserPermission) => boolean
  isPosOnly: () => boolean
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
  isPosOnly: () => {
    const user = get().user
    if (!user || user.role === "ADMIN") return false
    const perms = user.permissions ?? []
    // POS-only: staff with zero permissions or whose only permission is ACCESS_POS
    return perms.length === 0 || perms.every((p) => p === "ACCESS_POS")
  },
}))
