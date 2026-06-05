import { api } from "./client"
import type {
  ApiEnvelope,
  AppSettings,
  Approval,
  AuditLog,
  Branch,
  BranchSummary,
  BranchPayload,
  CatalogOrderPayload,
  Coupon,
  CreateInvoicePayload,
  CreateUserPayload,
  Customer,
  CustomerDebt,
  CustomerPortalLink,
  CustomerPortalResponse,
  CustomerPayload,
  CustomerTransactionsResponse,
  DashboardReport,
  Invoice,
  InvoiceAuditEntry,
  InventoryValuation,
  LoginPayload,
  LastTransaction,
  MessageTemplate,
  PagedResponse,
  Product,
  Quotation,
  PublicCatalogProduct,
  ProductMovementResponse,
  ProductPayload,
  SalesReport,
  UpdateUserPayload,
  User,
  Voucher,
  VoucherPayload,
  TopCustomer,
  EndOfDayReport,
} from "../types/api"

export async function login(payload: LoginPayload) {
  const { data } = await api.post<ApiEnvelope<never>>("/auth/login", payload)
  return data
}

export async function logout() {
  const { data } = await api.post<ApiEnvelope<never>>("/auth/logout")
  return data
}

export async function changePassword(payload: { currentPassword: string; newPassword: string }) {
  const { data } = await api.post<ApiEnvelope<never>>("/auth/change-password", payload)
  return data
}

export async function getUsers() {
  const { data } = await api.get<ApiEnvelope<User[]>>("/users")
  return data.data ?? []
}

export async function createUser(payload: CreateUserPayload) {
  const { data } = await api.post<ApiEnvelope<User>>("/users", payload)
  return data
}

export async function updateUser(id: string, payload: UpdateUserPayload) {
  const { data } = await api.put<ApiEnvelope<User>>(`/users/${id}`, payload)
  return data
}

export async function deactivateUser(id: string) {
  const { data } = await api.delete<ApiEnvelope<User>>(`/users/${id}`)
  return data
}

export async function deleteUserPermanently(id: string) {
  const { data } = await api.delete<ApiEnvelope<never>>(`/users/${id}/permanent`)
  return data
}

export async function getApprovals() {
  const { data } = await api.get<ApiEnvelope<Approval[]>>("/approvals")
  return data.data ?? []
}

export async function getMyApprovals() {
  const { data } = await api.get<ApiEnvelope<Approval[]>>("/approvals/my-requests")
  return data.data ?? []
}

export async function getPublicCatalogProducts() {
  const { data } = await api.get<ApiEnvelope<PublicCatalogProduct[]>>("/public/catalog/products")
  return data.data ?? []
}

export async function submitPublicCatalogOrder(payload: CatalogOrderPayload) {
  const { data } = await api.post<ApiEnvelope<{ approvalId: string }>>("/public/catalog/orders", payload)
  return data
}

export async function getAuditLogs(params?: {
  userId?: string
  entity?: string
  action?: string
  from?: string
  to?: string
  page?: number
  limit?: number
}) {
  const { data } = await api.get<PagedResponse<AuditLog>>("/audit-logs", { params })
  return data.data ?? []
}

export async function getBranches(params?: { search?: string; isActive?: boolean }) {
  const { data } = await api.get<ApiEnvelope<Branch[]>>("/branches", { params })
  return data.data ?? []
}

export async function getBranchSummaries() {
  const { data } = await api.get<ApiEnvelope<BranchSummary[]>>("/branches/summaries")
  return data.data ?? []
}

export async function createBranch(payload: BranchPayload) {
  const { data } = await api.post<ApiEnvelope<Branch>>("/branches", payload)
  return data
}

export async function updateBranch(id: string, payload: Partial<BranchPayload>) {
  const { data } = await api.put<ApiEnvelope<Branch>>(`/branches/${id}`, payload)
  return data
}

export async function reviewApproval(id: string, status: "APPROVED" | "REJECTED") {
  const { data } = await api.put<ApiEnvelope<Approval>>(`/approvals/${id}`, {
    status,
  })
  return data
}

export async function getProducts(params?: { search?: string; category?: string; limit?: number }) {
  const { data } = await api.get<PagedResponse<Product>>("/products", { params })
  return data.data ?? []
}

export async function getProduct(id: string) {
  const { data } = await api.get<ApiEnvelope<Product>>(`/products/${id}`)
  return data.data
}

export async function createProduct(payload: ProductPayload) {
  const { data } = await api.post<ApiEnvelope<Product>>("/products", payload)
  return data
}

export async function updateProduct(id: string, payload: ProductPayload) {
  const { data } = await api.put<ApiEnvelope<Product>>(`/products/${id}`, payload)
  return data
}

export async function getProductMovement(productId: string) {
  const { data } = await api.get<ApiEnvelope<ProductMovementResponse>>("/reports/products/movement", {
    params: { productId },
  })
  return data.data?.rows ?? []
}

export function productQrUrl(productId: string) {
  return `${api.defaults.baseURL}/products/${productId}/qr`
}

export async function productQrObjectUrl(productId: string, type: "piece" | "carton" = "piece") {
  const { data } = await api.get(`/products/${productId}/qr`, {
    params: { type },
    responseType: "blob",
  })
  return URL.createObjectURL(data as Blob)
}

export async function productPieceLabelPdf(productId: string) {
  const { data } = await api.get(`/products/${productId}/label/piece.pdf`, {
    responseType: "blob",
  })
  return URL.createObjectURL(data as Blob)
}

export async function productCartonSheetPdf(productId: string) {
  const { data } = await api.get(`/products/${productId}/label/carton.pdf`, {
    responseType: "blob",
  })
  return URL.createObjectURL(data as Blob)
}

export async function getCustomers(params?: { search?: string; isSupplier?: boolean; limit?: number }) {
  const { data } = await api.get<PagedResponse<Customer>>("/customers", { params })
  return data.data ?? []
}

export async function getCustomer(id: string) {
  const { data } = await api.get<ApiEnvelope<Customer>>(`/customers/${id}`)
  return data.data
}

export async function createCustomer(payload: CustomerPayload) {
  const { data } = await api.post<ApiEnvelope<Customer>>("/customers", payload)
  return data
}

export async function updateCustomer(id: string, payload: Partial<CustomerPayload>) {
  const { data } = await api.put<ApiEnvelope<Customer>>(`/customers/${id}`, payload)
  return data
}

export async function deleteCustomer(id: string) {
  const { data } = await api.delete<ApiEnvelope<Customer>>(`/customers/${id}`)
  return data
}

export async function createCustomerPortalLink(id: string, expiresInDays = 30) {
  const { data } = await api.post<ApiEnvelope<CustomerPortalLink>>(`/customers/${id}/portal-link`, { expiresInDays })
  return data.data
}

export async function getCustomerPortal(token: string) {
  const { data } = await api.get<ApiEnvelope<CustomerPortalResponse>>(`/public/client/${token}`)
  return data.data
}

export async function getCustomerTransactions(id: string, params?: { from?: string; to?: string }) {
  const { data } = await api.get<ApiEnvelope<CustomerTransactionsResponse>>(`/customers/${id}/transactions`, { params })
  return data.data?.transactions ?? []
}

export async function getLastCustomerTransaction(id: string) {
  const { data } = await api.get<ApiEnvelope<LastTransaction>>(`/customers/${id}/last-transaction`)
  return data.data
}

export async function getCustomerInvoices(customerId: string) {
  const { data } = await api.get<PagedResponse<Invoice>>("/invoices", { params: { customerId, limit: 100 } })
  return data.data ?? []
}

export async function getInvoices(params?: {
  from?: string
  to?: string
  status?: "ACTIVE" | "CANCELLED"
  type?: "SALE" | "PURCHASE" | "SALES_RETURN"
  paymentType?: "CASH" | "CREDIT" | "PARTIAL"
  customerId?: string
  page?: number
  limit?: number
}) {
  const { data } = await api.get<PagedResponse<Invoice>>("/invoices", { params: { limit: 100, ...params } })
  const invoices = data.data ?? []
  if (invoices.length > 0 || params?.customerId) return invoices

  const customers = await getCustomers()
  const seen = new Set<string>()
  const uuid = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/
  const rows = await Promise.all(
    customers.map(async (customer) => {
      const transactions = await getCustomerTransactions(customer.id, { from: params?.from, to: params?.to })
      return transactions
        .filter((tx) => tx.type?.toUpperCase().includes("INVOICE") && !tx.type?.toUpperCase().includes("PAYMENT"))
        .map((tx) => {
          const id = String(tx.id ?? "").match(uuid)?.[0] ?? String(tx.id ?? tx.referenceNumber)
          if (!id || seen.has(id)) return null
          seen.add(id)
          const type = Number(tx.credit ?? 0) > 0 ? "PURCHASE" : "SALE"
          if (params?.type && params.type !== type) return null
          return {
            id,
            invoiceNumber: tx.referenceNumber || id,
            type,
            customerId: customer.id,
            customer,
            date: tx.date,
            subtotal: tx.amount ?? 0,
            discount: 0,
            tax: 0,
            totalAmount: tx.amount ?? 0,
            paidAmount: 0,
            remainingAmount: tx.amount ?? 0,
            previousBalance: 0,
            finalBalance: tx.runningBalance ?? 0,
            paymentType: "CREDIT",
            status: "ACTIVE",
            items: [],
          } satisfies Invoice
        })
        .filter(Boolean) as Invoice[]
    }),
  )
  return rows.flat().sort((a, b) => String(b.date).localeCompare(String(a.date)))
}

export async function getLastSoldPrice(customerId: string, productId: string) {
  const { data } = await api.get<ApiEnvelope<{ invoiceId: string; invoiceNumber: string; date: string; unit: string; unitPrice: number } | null>>(
    "/invoices/last-sold-price",
    { params: { customerId, productId } },
  )
  return data.data ?? null
}

export async function getInvoice(id: string) {
  const { data } = await api.get<ApiEnvelope<Invoice>>(`/invoices/${id}`)
  return data.data
}

export async function createInvoice(payload: CreateInvoicePayload) {
  const { data } = await api.post<ApiEnvelope<Invoice>>("/invoices", payload)
  return data
}

export async function updateInvoice(id: string, payload: CreateInvoicePayload) {
  const { data } = await api.put<ApiEnvelope<Invoice>>(`/invoices/${id}`, payload)
  return data
}

export async function cancelInvoice(id: string) {
  const { data } = await api.delete<ApiEnvelope<Invoice>>(`/invoices/${id}`)
  return data
}

export async function reactivateInvoice(id: string) {
  const { data } = await api.post<ApiEnvelope<Invoice>>(`/invoices/${id}/reactivate`)
  return data
}

export async function getInvoiceAuditTrail(id: string) {
  const { data } = await api.get<ApiEnvelope<InvoiceAuditEntry[]>>(`/invoices/${id}/audit-trail`)
  return data.data ?? []
}

export async function getCoupons() {
  const { data } = await api.get<ApiEnvelope<Coupon[]>>("/coupons")
  return data.data ?? []
}

export async function createCoupon(payload: Partial<Coupon>) {
  const { data } = await api.post<ApiEnvelope<Coupon>>("/coupons", payload)
  return data
}

export async function updateCoupon(id: string, payload: Partial<Coupon>) {
  const { data } = await api.put<ApiEnvelope<Coupon>>(`/coupons/${id}`, payload)
  return data
}

export async function applyCoupon(code: string, subtotal: number) {
  const { data } = await api.post<ApiEnvelope<{ coupon: Coupon; discount: number }>>("/coupons/apply", { code, subtotal })
  return data.data
}

export async function getQuotations(params?: { status?: string; customerId?: string }) {
  const { data } = await api.get<PagedResponse<Quotation>>("/quotations", { params: { limit: 100, ...params } })
  return data.data ?? []
}

export async function getQuotation(id: string) {
  const { data } = await api.get<ApiEnvelope<Quotation>>(`/quotations/${id}`)
  return data.data
}

export async function createQuotation(payload: {
  customerId: string
  discount: number
  expiresAt?: string
  notes?: string
  items: CreateInvoicePayload["items"]
}) {
  const { data } = await api.post<ApiEnvelope<Quotation>>("/quotations", payload)
  return data
}

export async function updateQuotationStatus(id: string, status: "ACCEPTED" | "REJECTED" | "EXPIRED") {
  const { data } = await api.patch<ApiEnvelope<Quotation>>(`/quotations/${id}/status`, { status })
  return data
}

export async function convertQuotation(id: string) {
  const { data } = await api.post<ApiEnvelope<Invoice>>(`/quotations/${id}/convert`)
  return data
}

export function invoicePdfUrl(id: string) {
  return `${api.defaults.baseURL}/invoices/${id}/pdf`
}

export function invoiceImageUrl(id: string) {
  return `${api.defaults.baseURL}/invoices/${id}/image`
}

export async function invoicePdfObjectUrl(id: string) {
  const { data } = await api.get(`/invoices/${id}/pdf`, {
    responseType: "blob",
  })
  return URL.createObjectURL(data as Blob)
}

export async function invoiceImageObjectUrl(id: string) {
  const { data } = await api.get(`/invoices/${id}/image`, {
    responseType: "blob",
  })
  return URL.createObjectURL(data as Blob)
}

export async function getVouchers(params?: { customerId?: string; type?: "RECEIPT" | "PAYMENT" | "EXPENSE" }) {
  const { data } = await api.get<PagedResponse<Voucher>>("/vouchers", { params })
  return data.data ?? []
}

export async function getVoucher(id: string) {
  const { data } = await api.get<ApiEnvelope<Voucher>>(`/vouchers/${id}`)
  return data.data
}

export async function createVoucher(payload: VoucherPayload) {
  const { data } = await api.post<ApiEnvelope<Voucher>>("/vouchers", payload)
  return data
}

export async function updateVoucher(id: string, payload: Partial<VoucherPayload>) {
  const { data } = await api.put<ApiEnvelope<Voucher>>(`/vouchers/${id}`, payload)
  return data
}

export async function deleteVoucher(id: string) {
  const { data } = await api.delete<ApiEnvelope<Voucher>>(`/vouchers/${id}`)
  return data
}

export async function voucherPdfObjectUrl(id: string): Promise<string> {
  const resp = await api.get(`/vouchers/${id}/pdf`, { responseType: "blob" })
  return URL.createObjectURL(resp.data as Blob)
}

export async function voucherImageObjectUrl(id: string): Promise<string> {
  const resp = await api.get(`/vouchers/${id}/image`, { responseType: "blob" })
  return URL.createObjectURL(resp.data as Blob)
}

export async function createReceipt(payload: VoucherPayload) {
  return createVoucher(payload)
}

export async function getDashboardReport() {
  const { data } = await api.get<ApiEnvelope<DashboardReport>>("/reports/dashboard")
  return data.data
}

export async function getSalesReport(params?: { from?: string; to?: string; groupBy?: "day" | "week" | "month" }) {
  const { data } = await api.get<ApiEnvelope<SalesReport>>("/reports/sales", { params })
  return data.data
}

export async function getInventoryValuation() {
  const { data } = await api.get<ApiEnvelope<InventoryValuation>>("/reports/inventory/valuation")
  return data.data
}

export async function getCustomerDebts(params?: { minDays?: number; maxDays?: number }) {
  const { data } = await api.get<ApiEnvelope<CustomerDebt[]>>("/reports/customers/debts", { params })
  return data.data ?? []
}

export async function getTopCustomers(params?: { from?: string; to?: string; limit?: number }) {
  const { data } = await api.get<ApiEnvelope<TopCustomer[]>>("/reports/customers/top", { params })
  return data.data ?? []
}

export async function getEndOfDayReport(date?: string) {
  const { data } = await api.get<ApiEnvelope<EndOfDayReport>>("/reports/end-of-day", { params: date ? { date } : {} })
  return data.data
}

export interface AtRiskCustomer {
  id: string
  name: string
  phone: string
  currentBalance: number
  lastTransactionAt: string | null
  avgIntervalDays: number
  daysSinceLastPurchase: number
  overdueDays: number
}

export async function getAtRiskCustomers(limit = 10) {
  const { data } = await api.get<ApiEnvelope<AtRiskCustomer[]>>("/reports/customers/at-risk", { params: { limit } })
  return data.data ?? []
}

export async function getSettings() {
  const { data } = await api.get<ApiEnvelope<AppSettings>>("/settings")
  return data.data
}

export async function updateSettings(payload: Partial<AppSettings>) {
  const { data } = await api.put<ApiEnvelope<AppSettings>>("/settings", payload)
  return data
}

export async function triggerManualBackup() {
  const { data } = await api.post<ApiEnvelope<{ products: number; customers: number; invoices: number; vouchers: number }>>("/settings/backup/run")
  return data
}

export async function triggerDailySummary() {
  const { data } = await api.post<ApiEnvelope<{ message: string }>>("/settings/daily-summary/run")
  return data
}

export async function getMessageTemplates() {
  const { data } = await api.get<ApiEnvelope<MessageTemplate[]>>("/message-templates")
  return data.data ?? []
}

export async function updateMessageTemplate(id: string, payload: Partial<MessageTemplate>) {
  const { data } = await api.put<ApiEnvelope<MessageTemplate>>(`/message-templates/${id}`, payload)
  return data
}

export async function sendWhatsAppMessage(payload: { phone: string; message: string }) {
  const { data } = await api.post<ApiEnvelope<never>>("/whatsapp/send", payload)
  return data
}

export type WhatsAppState = "INITIALIZING" | "QR" | "READY" | "AUTH_FAILURE" | "DISCONNECTED" | "ERROR"

export interface WhatsAppStatus {
  initialized: boolean
  state: WhatsAppState
  isReady: boolean
  qr: string | null
  qrDataUrl: string | null
  error: string | null
}

export async function getWhatsAppStatus() {
  const { data } = await api.get<ApiEnvelope<WhatsAppStatus>>("/whatsapp/status")
  return data.data
}

export async function restartWhatsApp() {
  const { data } = await api.post<ApiEnvelope<never>>("/whatsapp/restart")
  return data
}

export interface TransferItemPayload {
  productId: string
  quantity: number
  unit: "PIECE" | "DOZEN" | "CARTON"
}

export interface CreateTransferPayload {
  fromBranchId: string
  toBranchId: string
  notes?: string
  items: TransferItemPayload[]
}

export interface InventoryTransfer {
  id: string
  transferNumber: string
  fromBranchId: string
  toBranchId: string
  fromBranch: { name: string }
  toBranch: { name: string }
  creator: { name: string }
  status: string
  date: string
  notes?: string
  items: {
    id: string
    quantity: number
    unit: string
    product: { name: string; itemNumber: string; pcsPerCarton: number }
  }[]
}

export async function getTransfers(params?: { branchId?: string; page?: number; limit?: number }) {
  const { data } = await api.get<PagedResponse<InventoryTransfer>>("/transfers", { params: { limit: 100, ...params } })
  return data.data ?? []
}

export async function getTransfer(id: string) {
  const { data } = await api.get<InventoryTransfer>(`/transfers/${id}`)
  return data
}

export async function createTransfer(payload: CreateTransferPayload) {
  const { data } = await api.post<InventoryTransfer>("/transfers", payload)
  return data
}
