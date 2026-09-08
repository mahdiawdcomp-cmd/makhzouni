import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useAuthStore } from "../store/authStore"
import type { UserPermission } from "../types/api"

/** The rep's one screen. Anything else a rep asks for lands here instead. */
const SALES_AGENT_HOME = "/sales-agent"

export function ProtectedRoute() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isSalesAgent = useAuthStore((state) => state.isSalesAgent())
  const { pathname } = useLocation()

  if (!isAuthenticated()) return <Navigate to="/login" replace />

  // «المندوب» is confined to one screen, and the confinement belongs HERE rather
  // than in AppLayout: /pos renders under a sibling PosLayout, so an AppLayout-level
  // check left the rep a door into the shop's point of sale. The backend only blocks
  // rep writes on the customer routes, so an invoice written from there went through
  // as an ordinary shop sale — no rep stamp, no liability, no commission, and
  // invisible to the whole «إدارة المندوبين» panel. Every protected route, whatever
  // layout it sits under, passes through this component.
  if (isSalesAgent && pathname !== SALES_AGENT_HOME) return <Navigate to={SALES_AGENT_HOME} replace />

  return <Outlet />
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
