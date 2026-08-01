import { lazy, Suspense, type ReactNode } from "react"
import { useTenantConfig } from "./hooks/useTenantConfig"
import SubscriptionExpiredPage from "./pages/SubscriptionExpiredPage"
import DesktopPlatformDisabledPage from "./pages/DesktopPlatformDisabledPage"
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom"
import { AdminRoute, PermissionRoute, ProtectedRoute } from "./components/ProtectedRoute"
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
const CampaignsPage = lazyPage(() => import("./pages/CampaignsPage"), "CampaignsPage")
const AccountLookupPage = lazyPage(() => import("./pages/AccountLookupPage"), "AccountLookupPage")
const DashboardPage = lazyPage(() => import("./pages/DashboardPage"), "DashboardPage")
const InvoiceDetailPage = lazyPage(() => import("./pages/InvoiceDetailPage"), "InvoiceDetailPage")
const InvoiceCreatePage = lazyPage(() => import("./pages/InvoiceCreatePage"), "InvoiceCreatePage")
const InvoiceEditPage = lazyPage(() => import("./pages/InvoiceEditPage"), "InvoiceEditPage")
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
const RetailCatalogPage = lazyPage(() => import("./pages/RetailCatalogPage"), "RetailCatalogPage")
// Desktop parity with inventory-web: the backend routes were already shared,
// only these four screens were missing from the desktop shell.
const InstagramPage = lazyPage(() => import("./pages/InstagramPage"), "InstagramPage")
const WhatsappChatPage = lazyPage(() => import("./pages/WhatsappChatPage"), "WhatsappChatPage")
const PersonalDebtsPage = lazyPage(() => import("./pages/PersonalDebtsPage"), "PersonalDebtsPage")
const WorkerPage = lazyPage(() => import("./pages/WorkerPage"), "WorkerPage")
const RetailShopPage = lazyPage(() => import("./pages/RetailShopPage"), "RetailShopPage")
const StocktakePage = lazyPage(() => import("./pages/StocktakePage"), "StocktakePage")
const CycleCountPage = lazyPage(() => import("./pages/CycleCountPage"), "CycleCountPage")
const LandedCostImportPage = lazyPage(() => import("./pages/LandedCostImportPage"), "LandedCostImportPage")
const LandedCostReviewPage = lazyPage(() => import("./pages/LandedCostReviewPage"), "LandedCostReviewPage")
const PublicStocktakePage = lazyPage(() => import("./pages/PublicStocktakePage"), "PublicStocktakePage")
const PublicCycleCountPage = lazyPage(() => import("./pages/PublicCycleCountPage"), "PublicCycleCountPage")
const SuperAdminPage = lazyPage(() => import("./pages/SuperAdminPage"), "SuperAdminPage")
const DisplayPage = lazyPage(() => import("./pages/DisplayPage"), "DisplayPage")
const LossesPage = lazyPage(() => import("./pages/LossesPage"), "LossesPage")

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
  { path: "/cycle-count/:token", element: s(<PublicCycleCountPage />) },

  // ── Protected routes ──
  {
    element: <ProtectedRoute />,
    children: [
      // Normal layout (sidebar + header)
      {
        element: <AppLayout />,
        children: [
          { index: true, element: s(<DashboardPage />) },
          { path: "worker", element: s(<WorkerPage />) },
          { path: "inventory", element: s(<ProductsPage />) },
          { path: "inventory/low-stock", element: s(<LowStockPage />) },
          { path: "inventory/transfers", element: f("transfers", "التحويلات بين المخازن", <TransfersPage />) },
          { path: "inventory/variety", element: s(<VarietyConvertPage />) },
          { path: "inventory/stale", element: s(<StaleProductsPage />) },
          { path: "inventory/stocktake", element: f("stocktake", "الجرد", <StocktakePage />) },
          { path: "inventory/cycle-count", element: s(<CycleCountPage />) },
          { path: "inventory/landed-cost", element: s(<LandedCostImportPage />) },
          { path: "inventory/landed-cost/:id", element: s(<LandedCostReviewPage />) },
          { path: "inventory/:id", element: s(<ProductDetailPage />) },
          { path: "invoices", element: s(<InvoicesPage />) },
          { path: "invoices/new", element: s(<InvoiceCreatePage />) },
          { path: "invoices/returns", element: f("salesReturns", "مرتجعات البيع", <SalesReturnsPage />) },
          { path: "invoices/:id", element: s(<InvoiceDetailPage />) },
          { path: "invoices/:id/edit", element: s(<InvoiceEditPage />) },
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
          { path: "instagram", element: f("retailShop", "إدارة إنستغرام", <InstagramPage />) },
          { path: "whatsapp", element: f("whatsappCampaigns", "محادثات واتساب", <WhatsappChatPage />) },
          { path: "reports", element: s(<ReportsPage />) },
          // Settings holds the WhatsApp/Telegram/Meta credentials — the sidebar
          // already hides it behind MANAGE_SETTINGS, so the route must enforce
          // the same thing or the URL is an open door.
          {
            element: <PermissionRoute permission="MANAGE_SETTINGS" />,
            children: [
              { path: "settings", element: s(<SettingsPage />) },
              { path: "invoice-designer", element: s(<InvoiceDesignerPage />) },
            ],
          },
          {
            element: <AdminRoute />,
            children: [
              { path: "users", element: s(<UsersPage />) },
              { path: "approvals", element: s(<ApprovalsPage />) },
              { path: "personal-debts", element: s(<PersonalDebtsPage />) },
              { path: "audit-logs", element: f("auditLog", "سجل التدقيق", <AuditLogsPage />) },
              { path: "error-logs", element: s(<AnalyzedErrorsPage />) },
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
        children: [{ path: "pos", element: f("pos", "نقطة البيع", <POSPage />) }],
      },
    ],
  },

  { path: "*", element: <Navigate to="/" replace /> },
])

export default function App() {
  const { data: tenant } = useTenantConfig()

  // SUSPENDED is a hard stop. EXPIRED deliberately is NOT: the backend already
  // enforces read-only (423 on writes, reads/exports/prints allowed), and
  // returning here instead took the whole router down with it — including
  // /login, /catalog and /client/:token, so an expired shop's own CUSTOMERS
  // lost the public storefront. ReadOnlySaasBanner in AppLayout is the
  // intended treatment and was dead code for this case.
  if (tenant?.isSuspended) return <SubscriptionExpiredPage suspended />

  // Platform entitlement, mirroring inventory-web. The backend enforces this
  // too (X-Client-Platform + enforcePlatformMiddleware); this is the readable
  // explanation rather than a wall of 403s. Standalone tenants and tenants
  // with no platforms config are never affected (=== false only).
  if (tenant?.mode === "saas" && tenant.platforms?.desktopEnabled === false)
    return <DesktopPlatformDisabledPage />

  return <RouterProvider router={router} />
}
