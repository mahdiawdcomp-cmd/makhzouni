import { lazy, Suspense, type ReactNode } from "react"
import { useTenantConfig } from "./hooks/useTenantConfig"
import SubscriptionExpiredPage from "./pages/SubscriptionExpiredPage"
import WebPlatformDisabledPage from "./pages/WebPlatformDisabledPage"
import { createBrowserRouter, Link, Navigate, RouterProvider } from "react-router-dom"
import { AdminRoute, ProtectedRoute } from "./components/ProtectedRoute"
import { AppLayout } from "./components/layout/AppLayout"
import { PosLayout } from "./components/layout/PosLayout"
import { FeatureGate } from "./components/FeatureGate"

// Pages are code-split: each becomes its own chunk loaded on first navigation,
// instead of shipping every page in the initial bundle.
const lazyPage = <T extends Record<string, unknown>>(
  loader: () => Promise<T>,
  name: keyof T,
) => lazy(() => loader().then((m) => ({ default: m[name] as React.ComponentType })))

const ApprovalsPage = lazyPage(() => import("./pages/ApprovalsPage"), "ApprovalsPage")
const AuditLogsPage = lazyPage(() => import("./pages/AuditLogsPage"), "AuditLogsPage")
const AnalyzedErrorsPage = lazyPage(() => import("./pages/AnalyzedErrorsPage"), "AnalyzedErrorsPage")
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
const InvoiceDesignerPage = lazyPage(() => import("./pages/InvoiceDesignerPage"), "InvoiceDesignerPage")
const UsersPage = lazyPage(() => import("./pages/UsersPage"), "UsersPage")
const VoucherDetailPage = lazyPage(() => import("./pages/VoucherDetailPage"), "VoucherDetailPage")
const VouchersPage = lazyPage(() => import("./pages/VouchersPage"), "VouchersPage")
const TransfersPage = lazyPage(() => import("./pages/TransfersPage"), "TransfersPage")
const VarietyConvertPage = lazyPage(() => import("./pages/VarietyConvertPage"), "VarietyConvertPage")
const StaleProductsPage = lazyPage(() => import("./pages/StaleProductsPage"), "StaleProductsPage")
const CatalogManagementPage = lazyPage(() => import("./pages/CatalogManagementPage"), "CatalogManagementPage")
const CampaignsPage = lazyPage(() => import("./pages/CampaignsPage"), "CampaignsPage")
const RetailCatalogPage = lazyPage(() => import("./pages/RetailCatalogPage"), "RetailCatalogPage")
const RetailShopPage = lazyPage(() => import("./pages/RetailShopPage"), "RetailShopPage")
const StocktakePage = lazyPage(() => import("./pages/StocktakePage"), "StocktakePage")
const PublicStocktakePage = lazyPage(() => import("./pages/PublicStocktakePage"), "PublicStocktakePage")
const SuperAdminPage = lazyPage(() => import("./pages/SuperAdminPage"), "SuperAdminPage")
const DisplayPage = lazyPage(() => import("./pages/DisplayPage"), "DisplayPage")
const LossesPage = lazyPage(() => import("./pages/LossesPage"), "LossesPage")
// TEMPORARY OLD ACCOUNTING IMPORT TOOL - DISABLED AFTER SUCCESSFUL MIGRATION.
// The wizard page file (pages/BalanceMigrationPage.tsx) is kept intact but is
// no longer routed. /balance-migration now shows a disabled notice.
// const BalanceMigrationPage = lazyPage(() => import("./pages/BalanceMigrationPage"), "BalanceMigrationPage")

function BalanceMigrationDisabled() {
  return (
    <div className="mx-auto flex h-[60vh] max-w-md flex-col items-center justify-center gap-3 p-6 text-center" dir="rtl">
      <h1 className="text-lg font-bold">أداة نقل الأرصدة معطّلة</h1>
      <p className="text-sm text-muted-foreground">تم تعطيل أداة نقل الأرصدة بعد اكتمال العملية.</p>
      <Link to="/" className="text-sm text-indigo-600 underline">العودة إلى الرئيسية</Link>
    </div>
  )
}

function PageLoader() {
  return (
    <div className="flex h-[60vh] w-full items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
    </div>
  )
}

// Wrap a route element in a Suspense boundary so the chunk can load lazily.
const s = (el: ReactNode) => <Suspense fallback={<PageLoader />}>{el}</Suspense>

// Batch 4 — gate a route element behind a Batch-1 feature key. Standalone
// mode (mahdi today) always passes through; SaaS tenants without the feature
// see LockedFeaturePage instead. Visual only, wraps AFTER Suspense.
const f = (featureKey: string, label: string, el: ReactNode) =>
  s(<FeatureGate featureKey={featureKey} label={label}>{el}</FeatureGate>)

const router = createBrowserRouter([
  // ── Public routes ──
  { path: "/login", element: s(<LoginPage />) },
  { path: "/display", element: s(<DisplayPage />) },
  { path: "/catalog", element: s(<PublicCatalogPage />) },
  { path: "/shop", element: f("retailShop", "متجر المفرد", <RetailShopPage />) },
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
          { path: "inventory/transfers", element: f("transfers", "التحويلات بين المخازن", <TransfersPage />) },
          { path: "inventory/variety", element: s(<VarietyConvertPage />) },
          { path: "inventory/stale", element: s(<StaleProductsPage />) },
          { path: "inventory/stocktake", element: f("stocktake", "الجرد", <StocktakePage />) },
          { path: "inventory/:id", element: s(<ProductDetailPage />) },
          { path: "invoices", element: s(<InvoicesPage />) },
          { path: "invoices/new", element: s(<InvoiceCreatePage />) },
          { path: "invoices/returns", element: f("salesReturns", "مرتجعات البيع", <SalesReturnsPage />) },
          { path: "invoices/:id", element: s(<InvoiceDetailPage />) },
          { path: "quotations", element: f("quotations", "عروض الأسعار", <QuotationsPage />) },
          { path: "vouchers", element: s(<VouchersPage />) },
          { path: "vouchers/:id", element: s(<VoucherDetailPage />) },
          { path: "losses", element: s(<LossesPage />) },
          { path: "customers", element: s(<CustomersPage />) },
          { path: "customers/broadcast", element: s(<CustomerBroadcastPage />) },
          { path: "campaigns", element: f("whatsappCampaigns", "الحملات", <CampaignsPage />) },
          { path: "customers/:id", element: s(<CustomerDetailPage />) },
          { path: "account", element: s(<AccountLookupPage />) },
          { path: "catalog-management", element: f("catalogWholesale", "كتلوگ الجملة", <CatalogManagementPage />) },
          { path: "retail-catalog", element: f("retailShop", "متجر المفرد", <RetailCatalogPage />) },
          { path: "reports", element: s(<ReportsPage />) },
          { path: "settings", element: s(<SettingsPage />) },
          { path: "invoice-designer", element: s(<InvoiceDesignerPage />) },
          {
            element: <AdminRoute />,
            children: [
              { path: "users", element: s(<UsersPage />) },
              { path: "approvals", element: s(<ApprovalsPage />) },
              { path: "audit-logs", element: f("auditLog", "سجل التدقيق", <AuditLogsPage />) },
              { path: "error-logs", element: s(<AnalyzedErrorsPage />) },
              { path: "branches", element: s(<BranchesPage />) },
              { path: "branches/:id", element: s(<WarehouseDetailPage />) },
              { path: "coupons", element: s(<CouponsPage />) },
              { path: "super-admin", element: s(<SuperAdminPage />) },
              // TEMPORARY OLD ACCOUNTING IMPORT TOOL - DISABLED AFTER SUCCESSFUL MIGRATION.
              { path: "balance-migration", element: <BalanceMigrationDisabled /> },
            ],
          },
        ],
      },

      // POS: fullscreen cashier mode — no sidebar / header
      {
        element: <PosLayout />,
        children: [{ path: "pos", element: f("pos", "نقطة البيع", <POSPage />) }],
      },
    ],
  },

  { path: "*", element: <Navigate to="/" replace /> },
])

export default function App() {
  const { data: tenant } = useTenantConfig()

  if (tenant?.isSuspended) return <SubscriptionExpiredPage suspended />
  if (tenant?.isExpired)    return <SubscriptionExpiredPage />

  // SaaS tenants with the web platform explicitly disabled get a full block,
  // not just the informational banner. Standalone (mahdi) and tenants without
  // a platforms config are never affected (=== false only).
  if (tenant?.mode === "saas" && tenant.platforms?.webEnabled === false)
    return <WebPlatformDisabledPage />

  return <RouterProvider router={router} />
}
