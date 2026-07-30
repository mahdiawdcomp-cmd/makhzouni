import { Navigate, Outlet } from "react-router-dom"
import { useAuthStore } from "../store/authStore"
import type { UserPermission } from "../types/api"

export function ProtectedRoute() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  return isAuthenticated() ? <Outlet /> : <Navigate to="/login" replace />
}

export function AdminRoute() {
  const isAdmin = useAuthStore((state) => state.isAdmin)
  return isAdmin() ? <Outlet /> : <Navigate to="/" replace />
}

// Route-level twin of the sidebar's permission filter. Hiding a menu item is
// not a guard — without this a user can simply type the URL. ADMIN passes via
// hasPermission's own admin bypass.
export function PermissionRoute({ permission }: { permission: UserPermission }) {
  const hasPermission = useAuthStore((state) => state.hasPermission)
  return hasPermission(permission) ? <Outlet /> : <Navigate to="/" replace />
}
