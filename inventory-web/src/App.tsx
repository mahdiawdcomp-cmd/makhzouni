import { lazy, Suspense, type ReactNode } from "react"
import { useTenantConfig } from "./hooks/useTenantConfig"
import SubscriptionExpiredPage from "./pages/SubscriptionExpiredPage"
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom"
import { AdminRoute, ProtectedRoute } from "./components/ProtectedRoute"
import { AppLayout } from "./components/layout/AppLayout"
import { PosLayout } from "./components/layout/PosLayout"

// Pages are code-split: each becomes its own chunk loaded on first navigation,
// instead of shipping every page in the initial bundle.
const lazyPage = <T extends Record<string, unknown>>(
  loader: () => Promise<T>,
  name: keyof T,
) => lazy(() => loader().then((m) => ({ default: m[name] as React.ComponentType })))

const ApprovalsPage = lazyPage(() => import("./pages/ApprovalsPage"), "ApprovalsPage")
const AuditLogsPage = lazyPage(() => import("./pages/AuditLogsPage"), "AuditLogsPage")
const BranchesPage = lazyPage(() => import("./pages/BranchesPage"), "BranchesPage")
const WarehouseDetailPage = lazyPage(() => import("./pages/WarehouseDetailPage"), "WarehouseDetailPage")
const CustomerDetailPage = lazyPage(() => import("./pages/CustomerDetailPage"), "CustomerDetailPage")
const ClientPortalPage = lazyPage(() => import("./pages/ClientPortalPage"), "ClientPortalPage")
const PublicInvoicePage = lazyPage(() => import("./pages/PublicInvoicePage"), "PublicInvoicePage")
const CouponsPage = lazyPage(() => import("./pages/CouponsPage"), "CouponsPage")
const CustomersPage = lazyPage(() => import("./pages/CustomersPage"), "CustomersPage")
const CustomerBroadcastPage = lazyPage(() => import("./pages/CustomerBroadcastPage"), "CustomerBroadcastPage")
const AccountLookupPage = lazyPage(() => import("./pages/AccountLookupPage"), "AccountLookupPage")
const DashboardPage = lazyPage(() => import("./pages/DashboardPage"), "DashboardPage")
const InvoiceDetailPage = lazyPage(() => import("./pages/InvoiceDetailPage"), "InvoiceDetailPage")
const InvoiceCreatePage = lazyPage(() => import("./pages/InvoiceCreatePage"), "InvoiceCreatePage")
const InvoicesPage = lazyPage(() => import("./pages/InvoicesPage"), "InvoicesPage")
const LoginPage = lazyPage(() => import("./pages/LoginPage"), "LoginPage")
const LowStockPage = lazyPage(() => import("./pages/LowStockPage"), "LowStockPage")
const ProductDetailPage = lazyPage(() => import("./pages/ProductDetailPage"), "ProductDetailPage")
const PublicCatalogPage = lazyPage(() => import("./pages/PublicCatalogPage"), "PublicCatalogPage")
const QuotationsPage = lazyPage(() => import("./pages/QuotationsPage"), "QuotationsPage")
const POSPage = lazyPage(() => import("./pages/PosPage"), "POSPage")
const ProductsPage = lazyPage(() => import("./pages/ProductsPage"), "ProductsPage")
const ReportsPage = lazyPage(() => import("./pages/ReportsPage"), "ReportsPage")
const SalesReturnsPage = lazyPage(() => import("./pages/SalesReturnsPage"), "SalesReturnsPage")
const SettingsPage = lazyPage(() => import("./pages/SettingsPage"), "SettingsPage")
const UsersPage = lazyPage(() => import("./pages/UsersPage"), "UsersPage")
const VoucherDetailPage = lazyPage(() => import("./pages/VoucherDetailPage"), "VoucherDetailPage")
const VouchersPage = lazyPage(() => import("./pages/VouchersPage"), "VouchersPage")
const TransfersPage = lazyPage(() => import("./pages/TransfersPage"), "TransfersPage")
const CatalogManagementPage = lazyPage(() => import("./pages/CatalogManagementPage"), "CatalogManagementPage")
const RetailCatalogPage = lazyPage(() => import("./pages/RetailCatalogPage"), "RetailCatalogPage")
const RetailShopPage = lazyPage(() => import("./pages/RetailShopPage"), "RetailShopPage")
const StocktakePage = lazyPage(() => import("./pages/StocktakePage"), "StocktakePage")
const PublicStocktakePage = lazyPage(() => import("./pages/PublicStocktakePage"), "PublicStocktakePage")
const SuperAdminPage = lazyPage(() => import("./pages/SuperAdminPage"), "SuperAdminPage")
const DisplayPage = lazyPage(() => import("./pages/DisplayPage"), "DisplayPage")

function PageLoader() {
  return (
    <div className="flex h-[60vh] w-full items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
    </div>
  )
}

// Wrap a route element in a Suspense boundary so the chunk can load lazily.
const s = (el: ReactNode) => <Suspense fallback={<PageLoader />}>{el}</Suspense>

const router = createBrowserRouter([
  // ── Public routes ──
  { path: "/login", element: s(<LoginPage />) },
  { path: "/display", element: s(<DisplayPage />) },
  { path: "/catalog", element: s(<PublicCatalogPage />) },
  { path: "/shop", element: s(<RetailShopPage />) },
  { path: "/client/:token", element: s(<ClientPortalPage />) },
  { path: "/client/:token/invoice/:invoiceId", element: s(<PublicInvoicePage />) },
  { path: "/stocktake/:token", element: s(<PublicStocktakePage />) },

  // ── Protected routes ──
  {
    element: <ProtectedRoute />,
    children: [
      // Normal layout (sidebar + header)
      {
        element: <AppLayout />,
        children: [
          { index: true, element: s(<DashboardPage />) },
          { path: "inventory", element: s(<ProductsPage />) },
          { path: "inventory/low-stock", element: s(<LowStockPage />) },
          { path: "inventory/transfers", element: s(<TransfersPage />) },
          { path: "inventory/stocktake", element: s(<StocktakePage />) },
          { path: "inventory/:id", element: s(<ProductDetailPage />) },
          { path: "invoices", element: s(<InvoicesPage />) },
          { path: "invoices/new", element: s(<InvoiceCreatePage />) },
          { path: "invoices/returns", element: s(<SalesReturnsPage />) },
          { path: "invoices/:id", element: s(<InvoiceDetailPage />) },
          { path: "quotations", element: s(<QuotationsPage />) },
          { path: "vouchers", element: s(<VouchersPage />) },
          { path: "vouchers/:id", element: s(<VoucherDetailPage />) },
          { path: "customers", element: s(<CustomersPage />) },
          { path: "customers/broadcast", element: s(<CustomerBroadcastPage />) },
          { path: "customers/:id", element: s(<CustomerDetailPage />) },
          { path: "account", element: s(<AccountLookupPage />) },
          { path: "catalog-management", element: s(<CatalogManagementPage />) },
          { path: "retail-catalog", element: s(<RetailCatalogPage />) },
          { path: "reports", element: s(<ReportsPage />) },
          { path: "settings", element: s(<SettingsPage />) },
          {
            element: <AdminRoute />,
            children: [
              { path: "users", element: s(<UsersPage />) },
              { path: "approvals", element: s(<ApprovalsPage />) },
              { path: "audit-logs", element: s(<AuditLogsPage />) },
              { path: "branches", element: s(<BranchesPage />) },
              { path: "branches/:id", element: s(<WarehouseDetailPage />) },
              { path: "coupons", element: s(<CouponsPage />) },
              { path: "super-admin", element: s(<SuperAdminPage />) },
            ],
          },
        ],
      },

      // POS: fullscreen cashier mode — no sidebar / header
      {
        element: <PosLayout />,
        children: [{ path: "pos", element: s(<POSPage />) }],
      },
    ],
  },

  { path: "*", element: <Navigate to="/" replace /> },
])

export default function App() {
  const { data: tenant } = useTenantConfig()

  if (tenant?.isSuspended) return <SubscriptionExpiredPage suspended />
  if (tenant?.isExpired)    return <SubscriptionExpiredPage />

  return <RouterProvider router={router} />
}
