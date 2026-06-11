import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom"
import { AdminRoute, ProtectedRoute } from "./components/ProtectedRoute"
import { AppLayout } from "./components/layout/AppLayout"
import { PosLayout } from "./components/layout/PosLayout"
import { ApprovalsPage } from "./pages/ApprovalsPage"
import { AuditLogsPage } from "./pages/AuditLogsPage"
import { BranchesPage } from "./pages/BranchesPage"
import { CustomerDetailPage } from "./pages/CustomerDetailPage"
import { ClientPortalPage } from "./pages/ClientPortalPage"
import { PublicInvoicePage } from "./pages/PublicInvoicePage"
import { CouponsPage } from "./pages/CouponsPage"
import { CustomersPage } from "./pages/CustomersPage"
import { AccountLookupPage } from "./pages/AccountLookupPage"
import { DashboardPage } from "./pages/DashboardPage"
import { InvoiceDetailPage } from "./pages/InvoiceDetailPage"
import { InvoiceCreatePage } from "./pages/InvoiceCreatePage"
import { InvoicesPage } from "./pages/InvoicesPage"
import { LoginPage } from "./pages/LoginPage"
import { LowStockPage } from "./pages/LowStockPage"
import { ProductDetailPage } from "./pages/ProductDetailPage"
import { PublicCatalogPage } from "./pages/PublicCatalogPage"
import { QuotationsPage } from "./pages/QuotationsPage"
import { POSPage } from "./pages/POSPage"
import { ProductsPage } from "./pages/ProductsPage"
import { ReportsPage } from "./pages/ReportsPage"
import { SalesReturnsPage } from "./pages/SalesReturnsPage"
import { SettingsPage } from "./pages/SettingsPage"
import { UsersPage } from "./pages/UsersPage"
import { VoucherDetailPage } from "./pages/VoucherDetailPage"
import { VouchersPage } from "./pages/VouchersPage"
import { TransfersPage } from "./pages/TransfersPage"
import { CatalogManagementPage } from "./pages/CatalogManagementPage"
import { StocktakePage } from "./pages/StocktakePage"
import { PublicStocktakePage } from "./pages/PublicStocktakePage"
import { SuperAdminPage } from "./pages/SuperAdminPage"
import { DisplayPage } from "./pages/DisplayPage"

const router = createBrowserRouter([
  // ── Public routes ──
  { path: "/login", element: <LoginPage /> },
  { path: "/display", element: <DisplayPage /> },
  { path: "/catalog", element: <PublicCatalogPage /> },
  { path: "/client/:token", element: <ClientPortalPage /> },
  { path: "/client/:token/invoice/:invoiceId", element: <PublicInvoicePage /> },
  { path: "/stocktake/:token", element: <PublicStocktakePage /> },

  // ── Protected routes ──
  {
    element: <ProtectedRoute />,
    children: [
      // Normal layout (sidebar + header)
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "inventory", element: <ProductsPage /> },
          { path: "inventory/low-stock", element: <LowStockPage /> },
          { path: "inventory/transfers", element: <TransfersPage /> },
          { path: "inventory/stocktake", element: <StocktakePage /> },
          { path: "inventory/:id", element: <ProductDetailPage /> },
          { path: "invoices", element: <InvoicesPage /> },
          { path: "invoices/new", element: <InvoiceCreatePage /> },
          { path: "invoices/returns", element: <SalesReturnsPage /> },
          { path: "invoices/:id", element: <InvoiceDetailPage /> },
          { path: "quotations", element: <QuotationsPage /> },
          { path: "vouchers", element: <VouchersPage /> },
          { path: "vouchers/:id", element: <VoucherDetailPage /> },
          { path: "customers", element: <CustomersPage /> },
          { path: "customers/:id", element: <CustomerDetailPage /> },
          { path: "account", element: <AccountLookupPage /> },
          { path: "catalog-management", element: <CatalogManagementPage /> },
          { path: "reports", element: <ReportsPage /> },
          { path: "settings", element: <SettingsPage /> },
          {
            element: <AdminRoute />,
            children: [
              { path: "users", element: <UsersPage /> },
              { path: "approvals", element: <ApprovalsPage /> },
              { path: "audit-logs", element: <AuditLogsPage /> },
              { path: "branches", element: <BranchesPage /> },
              { path: "coupons", element: <CouponsPage /> },
              { path: "super-admin", element: <SuperAdminPage /> },
            ],
          },
        ],
      },

      // POS: fullscreen cashier mode — no sidebar / header
      {
        element: <PosLayout />,
        children: [{ path: "pos", element: <POSPage /> }],
      },
    ],
  },

  { path: "*", element: <Navigate to="/" replace /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
