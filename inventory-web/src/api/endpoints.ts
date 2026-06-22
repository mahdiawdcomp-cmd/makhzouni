import { api, publicApi } from "./client"
import type {
  ApiEnvelope,
  AppSettings,
  Approval,
  AuditLog,
  Branch,
  BranchSummary,
  BranchPayload,
  CatalogCustomer,
  OrderPreparation,
  CatalogOrderPayload,
  CatalogAccessRequestPayload,
  CatalogAccessStatus,
  CatalogSession,
  Coupon,
  CreateInvoicePayload,
  CreateUserPayload,
  Customer,
  CustomerBroadcastPayload,
  CustomerBroadcastResult,
  CustomerDebt,
  CustomerPortalLink,
  CustomerPortalResponse,
  CustomerPayload,
  CustomerRatingEntry,
  CustomerTransactionsResponse,
  DashboardReport,
  DailySummaryData,
  DebtAgingRow,
  Invoice,
  InvoiceAuditEntry,
  InventoryValuation,
  LoginPayload,
  LastTransaction,
  MessageTemplate,
  PagedResponse,
  Product,
  CatalogCategory,
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
  ProfitReport,
  DebtCustomer,
  StocktakeSessionSummary,
  StocktakeSessionDetail,
  PublicInvoiceDetail,
  RetailItem,
  RetailItemPayload,
  RetailCategory,
  RetailCategoryPayload,
  RetailCoupon,
  RetailCouponPayload,
  RetailOrder,
  RetailCustomerEntry,
  RetailMyOrder,
  PublicRetailItem,
  PublicRetailCategory,
  PublicRetailCoupon,
  RetailOrderResult,
  PublicRetailOrderStatus,
  AiChatResponse,
  ReferralInfo,
  CustomerReferral,
  StockLoss,
  LossReason,
} from "../types/api"

export async function login(payload: LoginPayload) {
  const { data } = await api.post<ApiEnvelope<never>>("/auth/login", payload)
  return data
}

export async function logout() {
  const { data } = await api.post<ApiEnvelope<never>>("/auth/logout")
  return data
}

export async function getMe() {
  const { data } = await api.get<ApiEnvelope<User>>("/auth/me")
  return data.data ?? null
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

export async function sendCatalogOtp(phone: string) {
  const { data } = await api.post<ApiEnvelope<never>>("/public/otp/send", { phone })
  return data
}

export async function verifyCatalogOtp(phone: string, code: string) {
  const { data } = await api.post<ApiEnvelope<never>>("/public/otp/verify", { phone, code })
  return data
}

export async function requestCatalogAccess(payload: CatalogAccessRequestPayload) {
  const { data } = await api.post<ApiEnvelope<{ approvalId: string }>>("/public/catalog/access/request", payload)
  return data
}

export async function getCatalogAccessStatus(phone: string) {
  const { data } = await api.get<ApiEnvelope<CatalogAccessStatus>>("/public/catalog/access/status", { params: { phone } })
  return data.data
}

export async function getCatalogSession(access: string) {
  const { data } = await api.get<ApiEnvelope<CatalogSession>>("/public/catalog/session", { params: { access } })
  return data.data
}

export async function getPublicCatalogProducts(access: string) {
  const { data } = await api.get<ApiEnvelope<PublicCatalogProduct[]>>("/public/catalog/products", { params: { access } })
  return data.data ?? []
}

export async function submitPublicCatalogOrder(payload: CatalogOrderPayload, access: string) {
  const { data } = await api.post<ApiEnvelope<{ approvalId: string }>>("/public/catalog/orders", payload, { params: { access } })
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

export async function getBranch(id: string) {
  const { data } = await api.get<ApiEnvelope<Branch>>(`/branches/${id}`)
  return data.data
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

export async function reviewApproval(id: string, status: "APPROVED" | "REJECTED", options?: { allowPrices?: boolean; showStock?: boolean }) {
  const { data } = await api.put<ApiEnvelope<Approval>>(`/approvals/${id}`, {
    status,
    ...options,
  })
  return data
}

export async function bulkReviewApprovals(ids: string[], status: "APPROVED" | "REJECTED") {
  const { data } = await api.post<{ success: boolean; done: number; failed: number; message: string }>("/approvals/bulk-review", { ids, status })
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

export async function deleteProduct(id: string) {
  const { data } = await api.delete<ApiEnvelope<{ id: string }>>(`/products/${id}`)
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

export async function getCustomers(params?: { search?: string; isSupplier?: boolean; limit?: number; includeDeleted?: boolean; page?: number; tags?: string[] }) {
  const { data } = await api.get<PagedResponse<Customer>>("/customers", { params: { limit: 500, ...params } })
  return data.data ?? []
}

export async function getCustomerTags() {
  const { data } = await api.get<ApiEnvelope<string[]>>("/customers/tags")
  return data.data ?? []
}

export async function createCustomerTag(name: string) {
  const { data } = await api.post<ApiEnvelope<string[]>>("/customers/tags", { name })
  return data.data ?? []
}

export async function renameCustomerTag(oldName: string, newName: string) {
  const { data } = await api.patch<ApiEnvelope<string[]>>("/customers/tags", { oldName, newName })
  return data.data ?? []
}

export async function deleteCustomerTag(name: string) {
  const { data } = await api.delete<ApiEnvelope<string[]>>("/customers/tags", { data: { name } })
  return data.data ?? []
}

export async function broadcastToCustomers(payload: CustomerBroadcastPayload) {
  const { data } = await api.post<ApiEnvelope<CustomerBroadcastResult> & { message?: string }>("/customers/broadcast", payload)
  return data
}

export async function sendCatalogLinkToCustomer(customerId: string, promoCode?: string) {
  const { data } = await api.post<ApiEnvelope<{ phone: string }> & { message?: string }>(`/customers/${customerId}/send-catalog-link`, { promoCode })
  return data
}

export async function broadcastCatalogLink(payload: { tags: string[]; promoCode?: string }) {
  const { data } = await api.post<ApiEnvelope<{ total: number }> & { message?: string }>("/customers/broadcast-catalog-link", payload)
  return data
}

export async function getCustomersPaged(params?: { search?: string; isSupplier?: boolean; limit?: number; includeDeleted?: boolean; page?: number; tags?: string[] }) {
  const { data } = await api.get<PagedResponse<Customer>>("/customers", { params: { limit: 30, ...params } })
  return data
}

export async function getWalkInCustomer() {
  const { data } = await api.get<ApiEnvelope<Customer>>("/customers/walk-in")
  return data.data!
}

export async function getCustomer(id: string) {
  const { data } = await api.get<ApiEnvelope<Customer>>(`/customers/${id}`)
  return data.data
}

/** Fetch a customer including soft-deleted ones — for account lookup */
export async function getCustomerAny(id: string) {
  const { data } = await api.get<ApiEnvelope<Customer>>(`/customers/${id}/any`)
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

export async function getPublicInvoice(token: string, invoiceId: string) {
  const { data } = await api.get<ApiEnvelope<PublicInvoiceDetail>>(`/public/client/${token}/invoice/${invoiceId}`)
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
  const { data } = await api.get<PagedResponse<Invoice>>("/invoices", { params: { limit: 500, ...params } })
  return data.data ?? []
}

export async function getLastSoldPrice(customerId: string, productId: string) {
  const { data } = await api.get<ApiEnvelope<{ invoiceId: string; invoiceNumber: string; date: string; unit: string; warehouseId?: string | null; unitPrice: number } | null>>(
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

export async function permanentDeleteInvoice(id: string) {
  const { data } = await api.delete<ApiEnvelope<{ id: string; invoiceNumber: string }>>(`/invoices/${id}/permanent`)
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
  const { data } = await api.get<PagedResponse<Quotation>>("/quotations", { params: { limit: 500, ...params } })
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

export async function getVouchers(params?: { customerId?: string; type?: "RECEIPT" | "PAYMENT" | "EXPENSE"; limit?: number; showCancelled?: boolean }) {
  const { data } = await api.get<PagedResponse<Voucher>>("/vouchers", { params: { limit: 1000, ...params } })
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

export async function cancelVoucher(id: string) {
  const { data } = await api.post<ApiEnvelope<Voucher>>(`/vouchers/${id}/cancel`)
  return data
}

export async function restoreVoucher(id: string) {
  const { data } = await api.post<ApiEnvelope<Voucher>>(`/vouchers/${id}/restore`)
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

export async function getDailySummary() {
  const { data } = await api.get<ApiEnvelope<DailySummaryData>>("/reports/daily-summary")
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

export async function getCustomerRatings() {
  const { data } = await api.get<ApiEnvelope<CustomerRatingEntry[]>>("/reports/customers/ratings")
  return data.data ?? []
}

export async function getDebtAging() {
  const { data } = await api.get<ApiEnvelope<DebtAgingRow[]>>("/reports/customers/debt-aging")
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

export interface LicenseInfo {
  status: "valid" | "expiring" | "expired" | "missing" | "invalid"
  clientName: string | null
  expiresAt: string | null
  daysLeft: number | null
  readOnlyMode: boolean
}

export async function getLicenseStatus(): Promise<LicenseInfo | null> {
  try {
    const { data } = await api.get<ApiEnvelope<LicenseInfo>>("/license/status")
    return data.data ?? null
  } catch {
    return null
  }
}

export async function triggerManualBackup() {
  const { data } = await api.post<ApiEnvelope<{ products: number; customers: number; invoices: number; vouchers: number }>>("/settings/backup/run")
  return data
}

export async function downloadFullBackup(): Promise<void> {
  const response = await api.get("/settings/backup/download", { responseType: "blob" })
  const blob = new Blob([response.data as BlobPart], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const date = new Date().toISOString().slice(0, 10)
  const a = document.createElement("a")
  a.href = url
  a.download = `makhzouni-backup-${date}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function sendBackupToTelegram() {
  const { data } = await api.post<ApiEnvelope<Record<string, number>>>("/settings/backup/telegram")
  return data
}

export async function triggerDailySummary() {
  const { data } = await api.post<ApiEnvelope<{ message: string }>>("/settings/daily-summary/run")
  return data
}

// ── Danger zone ──────────────────────────────────────────────────────────────
export async function getDangerInfo() {
  const { data } = await api.get<ApiEnvelope<{ wipeConfirmPhrase: string }>>("/settings/danger/info")
  return data.data
}

export interface WipeResult {
  deleted: Record<string, number>
  keptCustomers: number
  keptUsers: number
  keptBranches: number
}

export async function wipeOperationalData(confirm: string) {
  const { data } = await api.post<ApiEnvelope<WipeResult>>("/settings/danger/wipe-operational", { confirm })
  return data
}

export interface MergeWarehousesResult {
  mainBranch: { id: string; name: string }
  keptBranches: { id: string; name: string }[]
  deletedBranches: { id: string; name: string }[]
  reassignedCustomers: number
}

export async function mergeWarehouses(payload: { mainBranchId: string; mainName: string; keepBranchIds: string[] }) {
  const { data } = await api.post<ApiEnvelope<MergeWarehousesResult>>("/settings/danger/merge-warehouses", payload)
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

export async function sendWhatsAppInvoice(invoiceId: string) {
  const { data } = await api.post<ApiEnvelope<{ to: string; filename: string }>>(`/whatsapp/send-invoice/${invoiceId}`)
  return data.data
}

export async function sendWhatsAppMessage(payload: { phone: string; message: string }) {
  const { data } = await api.post<ApiEnvelope<never>>("/whatsapp/send", payload)
  return data
}

export type WhatsAppState = "INITIALIZING" | "QR" | "READY" | "AUTH_FAILURE" | "DISCONNECTED" | "ERROR"

export interface WhatsAppStatus {
  provider: "web" | "cloud"
  enabled: boolean
  cloudConfigured: boolean
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
  const { data } = await api.get<PagedResponse<InventoryTransfer>>("/transfers", { params: { limit: 500, ...params } })
  return data.data ?? []
}

export async function getTransfer(id: string) {
  const { data } = await api.get<InventoryTransfer>(`/transfers/${id}`)
  return data
}

export interface TransferRequestResult {
  success: boolean
  message?: string
  approvalId?: string
  transfer?: InventoryTransfer
  snapshot?: {
    fromName: string
    toName: string
    anyExceeds: boolean
    items: { productName: string; quantity: number; unit: string; requestedPieces: number; availablePieces: number; exceedsStock: boolean }[]
  }
}

// Submits a transfer REQUEST (goes to approvals; does not move stock immediately).
export async function createTransfer(payload: CreateTransferPayload) {
  const { data } = await api.post<TransferRequestResult>("/transfers", payload)
  return data
}

// ── Catalog Management ──────────────────────────────────────────────────────
export async function getCatalogCustomers() {
  const { data } = await api.get<ApiEnvelope<CatalogCustomer[]>>("/catalog-management")
  return data.data ?? []
}

export async function grantCatalogAccess(customerId: string, opts: { allowPrices: boolean; showStock: boolean }) {
  const { data } = await api.post<ApiEnvelope<{ token: string; urlPath: string; allowPrices: boolean; showStock: boolean }>>(
    `/catalog-management/${customerId}/grant`,
    opts,
  )
  return data.data!
}

export async function patchCatalogAccess(customerId: string, patch: { allowPrices?: boolean; showStock?: boolean }) {
  const { data } = await api.patch<ApiEnvelope<{ allowPrices: boolean; showStock: boolean; token: string }>>(
    `/catalog-management/${customerId}`,
    patch,
  )
  return data.data!
}

export async function revokeCatalogAccess(customerId: string) {
  const { data } = await api.delete<ApiEnvelope<never>>(`/catalog-management/${customerId}`)
  return data
}

// ── Order Preparations ───────────────────────────────────────────────────────
export async function getOrderPreparations() {
  const { data } = await api.get<ApiEnvelope<OrderPreparation[]>>("/order-preparations")
  return data.data ?? []
}

export async function markOrderPrepared(id: string) {
  const { data } = await api.post<ApiEnvelope<never>>(`/order-preparations/${id}/mark-prepared`)
  return data
}

// ── Profit Report ─────────────────────────────────────────────────────────────
export async function getProfitReport(params?: { from?: string; to?: string; groupBy?: "day" | "week" | "month" }) {
  const { data } = await api.get<ApiEnvelope<ProfitReport>>("/reports/profit", { params })
  return data.data!
}

// ── Debt Reminder ─────────────────────────────────────────────────────────────
export async function getDebtReminderList(minDays: number) {
  const { data } = await api.get<ApiEnvelope<DebtCustomer[]>>("/reports/debt-reminder", { params: { minDays } })
  return data.data ?? []
}

export async function sendDebtReminder(payload: { customerIds?: string[]; minDays?: number }) {
  const { data } = await api.post<ApiEnvelope<{ sent: number; failed: number; errors: string[] }>>("/reports/debt-reminder/send", payload)
  return data.data!
}

// ── Stocktake ─────────────────────────────────────────────────────────────────
export async function listStocktakeSessions() {
  const { data } = await api.get<ApiEnvelope<StocktakeSessionSummary[]>>("/stocktake")
  return data.data ?? []
}

export async function createStocktakeSession(payload: { branchId?: string; notes?: string }) {
  const { data } = await api.post<ApiEnvelope<{ id: string }>>("/stocktake", payload)
  return data.data!
}

export async function getStocktakeSession(id: string) {
  const { data } = await api.get<ApiEnvelope<StocktakeSessionDetail>>(`/stocktake/${id}`)
  return data.data!
}

export async function updateStocktakeItem(sessionId: string, productId: string, actualQty: number, notes?: string) {
  const { data } = await api.patch<ApiEnvelope<never>>(`/stocktake/${sessionId}/items`, { productId, actualQty, notes })
  return data
}

export async function submitStocktakeSession(id: string) {
  const { data } = await api.post<ApiEnvelope<StocktakeSessionDetail>>(`/stocktake/${id}/submit`)
  return data.data!
}

export async function closeStocktakeSession(id: string) {
  const { data } = await api.post<ApiEnvelope<StocktakeSessionDetail>>(`/stocktake/${id}/close`)
  return data.data!
}

// ── Excel Import ──────────────────────────────────────────────────────────────
export async function importProductsExcel(file: File) {
  const form = new FormData()
  form.append("file", file)
  const { data } = await api.post<ApiEnvelope<{ created: number; skipped: number; errors: string[] }>>("/import/products", form)
  return data.data!
}

export function getImportTemplateUrl() {
  return `${api.defaults.baseURL}/import/products/template`
}

// ── Catalog Categories ────────────────────────────────────────────────────────
export async function getCatalogCategories() {
  const { data } = await api.get<ApiEnvelope<CatalogCategory[]>>("/catalog-categories")
  return data.data ?? []
}

export async function upsertCatalogCategory(payload: { name: string; types: string[]; sortOrder?: number }) {
  const { data } = await api.post<ApiEnvelope<CatalogCategory>>("/catalog-categories", payload)
  return data.data!
}

export async function deleteCatalogCategory(id: string) {
  await api.delete(`/catalog-categories/${id}`)
}

// ── Licensed Clients (SuperAdmin) ─────────────────────────────────────────────
export interface LicensedClient {
  id: string
  name: string
  licenseKey: string
  expiresAt: string
  months: number
  notes?: string | null
  contactPhone?: string | null
  contactEmail?: string | null
  backendUrl?: string | null
  frontendUrl?: string | null
  isRevoked: boolean
  createdAt: string
  daysLeft?: number
  status?: "valid" | "expiring" | "expired" | "revoked"
}

export async function getLicensedClients() {
  const { data } = await api.get<ApiEnvelope<LicensedClient[]>>("/clients")
  return data.data ?? []
}

export async function createLicensedClient(payload: {
  name: string; months: number; notes?: string
  contactPhone?: string; contactEmail?: string
}) {
  const { data } = await api.post<ApiEnvelope<LicensedClient>>("/clients", payload)
  return data.data!
}

export async function updateLicensedClient(id: string, payload: {
  backendUrl?: string; frontendUrl?: string
  contactPhone?: string; contactEmail?: string; notes?: string
}) {
  const { data } = await api.patch<ApiEnvelope<LicensedClient>>(`/clients/${id}`, payload)
  return data.data!
}

export async function revokeLicensedClient(id: string) {
  const { data } = await api.patch<ApiEnvelope<never>>(`/clients/${id}/revoke`)
  return data
}

export async function deleteLicensedClient(id: string) {
  const { data } = await api.delete<ApiEnvelope<never>>(`/clients/${id}`)
  return data
}

// ── Payments & Revenue (Phase 4) ──────────────────────────────────────────────
export interface ClientPayment {
  id: string
  clientId: string
  clientName: string
  amount: number
  currency: string
  paidAt: string
  method?: string | null
  notes?: string | null
  createdAt: string
}

export interface RevenueSummary {
  totalAllTime: number
  totalThisMonth: number
  totalThisYear: number
  currency: string
  renewalsDueSoon: {
    id: string; name: string; expiresAt: string; daysLeft: number
    contactPhone: string | null; frontendUrl: string | null
  }[]
  monthlyChart: { month: string; amount: number }[]
}

export interface RenewResult {
  newExpiresAt: string
  licenseKey: string
  payment: ClientPayment
}

export async function getRevenueSummary() {
  const { data } = await api.get<ApiEnvelope<RevenueSummary>>("/payments/revenue")
  return data.data!
}

export async function getPayments(clientId?: string) {
  const { data } = await api.get<ApiEnvelope<ClientPayment[]>>("/payments", {
    params: clientId ? { clientId } : undefined,
  })
  return data.data ?? []
}

export async function recordPayment(payload: {
  clientId: string; amount: number; currency?: string
  paidAt?: string; method?: string; notes?: string
}) {
  const { data } = await api.post<ApiEnvelope<ClientPayment>>("/payments", payload)
  return data.data!
}

export async function renewLicense(clientId: string, payload: {
  months: number; amount: number; currency?: string; method?: string; notes?: string
}) {
  const { data } = await api.post<ApiEnvelope<RenewResult>>(`/payments/renew/${clientId}`, payload)
  return data.data!
}

export async function deletePayment(id: string) {
  await api.delete(`/payments/${id}`)
}

// ── Public display screen ─────────────────────────────────────────────────────
export interface DisplayProduct {
  id: string
  name: string
  salePrice: number
  retailPrice: number
  category: string | null
  imageUrl: string | null
  itemNumber: string
  currentStock: number
}

export interface DisplayData {
  storeName: string
  storeLogo: string
  currency: string
  products: DisplayProduct[]
}

export async function getDisplayProducts() {
  const { data } = await publicApi.get<{ success: boolean; data: DisplayData }>("/public/display-products")
  return data.data
}

// ── Retail catalog: admin ──────────────────────────────────────────────────────
export async function getRetailItems() {
  const { data } = await api.get<ApiEnvelope<RetailItem[]>>("/retail-catalog/items")
  return data.data ?? []
}

export async function createRetailItem(payload: RetailItemPayload) {
  const { data } = await api.post<ApiEnvelope<RetailItem>>("/retail-catalog/items", payload)
  return data.data!
}

export async function updateRetailItem(id: string, payload: Partial<RetailItemPayload>) {
  const { data } = await api.put<ApiEnvelope<RetailItem>>(`/retail-catalog/items/${id}`, payload)
  return data.data!
}

export async function deleteRetailItem(id: string) {
  await api.delete(`/retail-catalog/items/${id}`)
}

export async function getRetailCategories() {
  const { data } = await api.get<ApiEnvelope<RetailCategory[]>>("/retail-catalog/categories")
  return data.data ?? []
}

export async function createRetailCategory(payload: RetailCategoryPayload) {
  const { data } = await api.post<ApiEnvelope<RetailCategory>>("/retail-catalog/categories", payload)
  return data.data!
}

export async function updateRetailCategory(id: string, payload: Partial<RetailCategoryPayload>) {
  const { data } = await api.put<ApiEnvelope<RetailCategory>>(`/retail-catalog/categories/${id}`, payload)
  return data.data!
}

export async function deleteRetailCategory(id: string) {
  await api.delete(`/retail-catalog/categories/${id}`)
}

export async function getRetailCoupons() {
  const { data } = await api.get<ApiEnvelope<RetailCoupon[]>>("/retail-catalog/coupons")
  return data.data ?? []
}

export async function createRetailCoupon(payload: RetailCouponPayload) {
  const { data } = await api.post<ApiEnvelope<RetailCoupon>>("/retail-catalog/coupons", payload)
  return data.data!
}

export async function updateRetailCoupon(id: string, payload: Partial<RetailCouponPayload>) {
  const { data } = await api.put<ApiEnvelope<RetailCoupon>>(`/retail-catalog/coupons/${id}`, payload)
  return data.data!
}

export async function deleteRetailCoupon(id: string) {
  await api.delete(`/retail-catalog/coupons/${id}`)
}

export async function getRetailCustomers(params?: { category?: string; categories?: string[]; subscribersOnly?: boolean }) {
  const { data } = await api.get<ApiEnvelope<RetailCustomerEntry[]>>("/retail-catalog/customers", {
    params: {
      ...(params?.category ? { category: params.category } : {}),
      ...(params?.categories && params.categories.length > 0 ? { categories: params.categories } : {}),
      ...(params?.subscribersOnly ? { subscribersOnly: true } : {}),
    },
  })
  return data.data ?? []
}

export async function broadcastToRetailCustomers(payload: { message: string; images?: string[]; category?: string; categories?: string[]; subscribersOnly?: boolean }) {
  const { data } = await api.post<ApiEnvelope<{ total: number }>>("/retail-catalog/broadcast", payload)
  return data
}

export async function getRetailOrders(status?: "PENDING" | "PREPARED" | "CANCELLED") {
  const { data } = await api.get<ApiEnvelope<RetailOrder[]>>("/retail-catalog/orders", {
    params: status ? { status } : undefined,
  })
  return data.data ?? []
}

export async function prepareRetailOrder(id: string) {
  const { data } = await api.post<ApiEnvelope<{ id: string; orderNumber: string; invoiceId: string }>>(`/retail-catalog/orders/${id}/prepare`)
  return data
}

export async function cancelRetailOrder(id: string) {
  const { data } = await api.post<ApiEnvelope<{ id: string }>>(`/retail-catalog/orders/${id}/cancel`)
  return data
}

export async function getRetailReferralSettings() {
  const { data } = await api.get<ApiEnvelope<{ discountPercent: number }>>("/retail-catalog/referral-settings")
  return data.data ?? { discountPercent: 10 }
}

export async function setRetailReferralSettings(discountPercent: number) {
  const { data } = await api.put<ApiEnvelope<{ discountPercent: number }>>("/retail-catalog/referral-settings", { discountPercent })
  return data.data!
}

// ── Retail storefront: public (no auth) ────────────────────────────────────────
export async function getPublicStoreInfo() {
  const { data } = await publicApi.get<ApiEnvelope<{ storeName: string; storeLogo: string; currency: string; designerName?: string; designerPhone?: string }>>("/public/retail/store-info")
  return data.data ?? { storeName: "متجرنا", storeLogo: "", currency: "د.ع", designerName: "", designerPhone: "" }
}

export async function getPublicRetailCatalog() {
  const { data } = await publicApi.get<ApiEnvelope<PublicRetailItem[]>>("/public/retail/catalog")
  return data.data ?? []
}

export async function getPublicRetailCategories() {
  const { data } = await publicApi.get<ApiEnvelope<PublicRetailCategory[]>>("/public/retail/categories")
  return data.data ?? []
}

export async function getPublicActiveCoupon() {
  const { data } = await publicApi.get<ApiEnvelope<PublicRetailCoupon | null>>("/public/retail/active-coupon")
  return data.data ?? null
}

export async function previewPublicRetailCoupon(code: string, subtotal: number) {
  const { data } = await publicApi.post<ApiEnvelope<{ discount: number; code: string }>>("/public/retail/coupon/preview", { code, subtotal })
  return data.data!
}

export async function submitPublicRetailOrder(payload: {
  customerName: string
  phone: string
  address?: string
  notes?: string
  couponCode?: string
  referralCode?: string
  isSubscriber?: boolean
  interests?: string[]
  wishNote?: string
  items: Array<{ retailItemId: string; quantity: number }>
}) {
  const { data } = await publicApi.post<ApiEnvelope<RetailOrderResult>>("/public/retail/orders", payload)
  return data.data!
}

export async function getPublicRetailOrderStatus(id: string) {
  const { data } = await publicApi.get<ApiEnvelope<PublicRetailOrderStatus>>(`/public/retail/orders/${id}`)
  return data.data!
}

export async function getPublicRetailOrdersByPhone(phone: string) {
  const { data } = await publicApi.get<ApiEnvelope<RetailMyOrder[]>>("/public/retail/my-orders", { params: { phone } })
  return data.data ?? []
}

export async function getPublicRetailOrdersByToken(token: string) {
  const { data } = await publicApi.get<ApiEnvelope<{ name: string; orders: RetailMyOrder[] }>>(
    `/public/retail/my-orders/${encodeURIComponent(token)}`,
  )
  return data.data ?? { name: "", orders: [] }
}

export async function retailAiChat(message: string, history: Array<{ role: "user" | "assistant"; content: string }>) {
  const { data } = await publicApi.post<ApiEnvelope<AiChatResponse>>("/public/retail/ai-chat", { message, history })
  return data.data!
}

export async function getPublicReferralInfo(code: string) {
  const { data } = await publicApi.get<ApiEnvelope<ReferralInfo>>(`/public/retail/referral/${encodeURIComponent(code)}`)
  return data.data!
}

export async function getPublicCustomerReferral(phone: string) {
  const { data } = await publicApi.get<ApiEnvelope<CustomerReferral | null>>("/public/retail/my-referral", { params: { phone } })
  return data.data ?? null
}

export async function listStockLosses(params?: { from?: string; to?: string; warehouseId?: string; page?: number }) {
  // Backend follows the app-wide paginated shape: { success, data: StockLoss[], pagination }.
  const { data } = await api.get<PagedResponse<StockLoss>>("/stock-losses", { params })
  return data.data ?? []
}

export async function createStockLoss(payload: {
  date: string
  warehouseId: string
  reason: LossReason
  notes?: string
  items: Array<{ productId: string; unit: string; quantity: number }>
}) {
  const { data } = await api.post<ApiEnvelope<StockLoss>>("/stock-losses", payload)
  return data.data!
}

export async function cancelStockLoss(id: string) {
  const { data } = await api.patch<ApiEnvelope<StockLoss>>(`/stock-losses/${id}/cancel`)
  return data.data!
}
