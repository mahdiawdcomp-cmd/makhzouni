import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { AdminRoute, ProtectedRoute } from "./components/ProtectedRoute"
import { AppLayout } from "./components/layout/AppLayout"
import { ApprovalsPage } from "./pages/ApprovalsPage"
import { AuditLogsPage } from "./pages/AuditLogsPage"
import { BranchesPage } from "./pages/BranchesPage"
import { CustomerDetailPage } from "./pages/CustomerDetailPage"
import { CustomersPage } from "./pages/CustomersPage"
import { AccountLookupPage } from "./pages/AccountLookupPage"
import { DashboardPage } from "./pages/DashboardPage"
import { InvoiceDetailPage } from "./pages/InvoiceDetailPage"
import { InvoiceCreatePage } from "./pages/InvoiceCreatePage"
import { InvoicesPage } from "./pages/InvoicesPage"
import { LoginPage } from "./pages/LoginPage"
import { LowStockPage } from "./pages/LowStockPage"
import { ProductDetailPage } from "./pages/ProductDetailPage"
import { ProductsPage } from "./pages/ProductsPage"
import { ReportsPage } from "./pages/ReportsPage"
import { SettingsPage } from "./pages/SettingsPage"
import { UsersPage } from "./pages/UsersPage"
import { VoucherDetailPage } from "./pages/VoucherDetailPage"
import { VouchersPage } from "./pages/VouchersPage"
import { TransfersPage } from "./pages/TransfersPage"

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="inventory" element={<ProductsPage />} />
            <Route path="inventory/low-stock" element={<LowStockPage />} />
            <Route path="inventory/transfers" element={<TransfersPage />} />
            <Route path="inventory/:id" element={<ProductDetailPage />} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="invoices/new" element={<InvoiceCreatePage />} />
            <Route path="invoices/:id" element={<InvoiceDetailPage />} />
            <Route path="vouchers" element={<VouchersPage />} />
            <Route path="vouchers/:id" element={<VoucherDetailPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="customers/:id" element={<CustomerDetailPage />} />
            <Route path="account" element={<AccountLookupPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route element={<AdminRoute />}>
              <Route path="users" element={<UsersPage />} />
              <Route path="approvals" element={<ApprovalsPage />} />
              <Route path="audit-logs" element={<AuditLogsPage />} />
              <Route path="branches" element={<BranchesPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
