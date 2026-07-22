import { api, publicApi } from "./client"
import type {
  ApiEnvelope,
  AppSettings,
  Approval,
  Campaign,
  CampaignDetail,
  CampaignPayload,
  CampaignStatus,
  SystemHealth,
  ErrorLog,
  ErrorLogSource,
  ErrorAnalysis,
  Prospect,
  ProspectListResult,
  ProspectStatus,
  InboundMessage,
  InboundMessageStatus,
  AuditLog,
  Branch,
  BranchSummary,
  BranchPayload,
  CatalogCustomer,
  CatalogStockFilter,
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
  CustomerStatementsExportEntry,
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
  WarehouseComparisonRow,
  CrossSellPair,
  StoreBrainReport,
  DailyAssistantReport,
  DebtCustomer,
  InactiveCustomer,
  StocktakeSessionSummary,
  StocktakeSessionDetail,
  CycleCountSessionSummary,
  CycleCountSessionDetail,
  CycleCountStrategy,
  PublicInvoiceDetail,
  PortalRetailOrder,
  ArrivalSubscription,
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

// After a successful OTP for an existing link (6-month re-verification): stamps
// the link as verified again — same token, no new admin approval.
export async function verifyCatalogAccess(access: string) {
  const { data } = await api.post<ApiEnvelope<CatalogSession>>("/public/catalog/access/verify", undefined, { params: { access } })
  return data.data
}

export async function getPublicCatalogProducts(access: string) {
  const { data } = await api.get<ApiEnvelope<PublicCatalogProduct[]>>("/public/catalog/products", { params: { access } })
  return data.data ?? []
}


export async function getPublicCatalogProductImage(access: string, id: string) {
  const { data } = await api.get<ApiEnvelope<{ imageUrl: string | null }>>("/public/catalog/product-image", { params: { access, id } })
  return data.data?.imageUrl ?? null
}

export async function submitPublicCatalogOrder(payload: CatalogOrderPayload, access: string) {
  const { data } = await api.post<ApiEnvelope<{ approvalId: string }>>("/public/catalog/orders", payload, { params: { access } })
  return data
}

/* ── Guest catalog (no token/OTP — only when the merchant turned off
   catalogRequireOtp; the phone gate collects the visitor's number first) ── */
export async function getGuestCatalogProducts() {
  const { data } = await api.get<ApiEnvelope<PublicCatalogProduct[]>>("/public/catalog/guest-products")
  return data.data ?? []
}

export async function guestCatalogEnter(phone: string) {
  const { data } = await api.post<ApiEnvelope<{ ok: boolean }>>("/public/catalog/guest-enter", { phone })
  return data.data
}

export async function submitGuestCatalogOrder(payload: { customerName: string; phone: string; address?: string; notes?: string; items: Array<{ productId: string; unit: string; quantity: number }> }) {
  const { data } = await api.post<ApiEnvelope<{ approvalId: string }>>("/public/catalog/guest-orders", payload)
  return data
}

export async function validatePublicPromoCode(code: string, customerId: string) {
  const { data } = await api.post<ApiEnvelope<{ code: string; type: string; value: number | null; description: string | null }>>(
    "/public/catalog/validate-promo", { code, customerId }
  )
  return data.data!
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

export type StockMovementSource =
  | "create"
  | "manual"
  | "sale"
  | "purchase"
  | "return"
  | "transfer"
  | "loss"

export interface StockHistoryEntry {
  id: string
  type: "IN" | "OUT" | "DAMAGE"
  quantity: number
  balanceBefore: number
  balanceAfter: number
  warehouseName: string | null
  userName: string | null
  note: string | null
  source: StockMovementSource
  reference: string | null
  createdAt: string
}

export async function getStockHistory(id: string) {
  const { data } = await api.get<ApiEnvelope<StockHistoryEntry[]>>(`/products/${id}/stock-history`)
  return data.data ?? []
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

export async function getDeletedProducts() {
  const { data } = await api.get<ApiEnvelope<Product[]>>("/products/deleted")
  return data.data
}

export async function restoreProduct(id: string) {
  const { data } = await api.post<ApiEnvelope<Product>>(`/products/${id}/restore`)
  return data
}

// ── Stale products (no movement in N days) ──────────────────────────────────
export interface StaleProductsResult {
  days: number
  count: number
  data: Product[]
}

export async function getStaleProducts(days = 60) {
  const { data } = await api.get<StaleProductsResult & { success: boolean }>("/products/stale", { params: { days } })
  return { days: data.days, count: data.count, data: data.data ?? [] }
}

export async function bulkDeleteProducts(ids: string[]) {
  const { data } = await api.post<{ success: boolean; deleted: number; message?: string }>("/products/bulk-delete", { ids })
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

export function productPieceLabelPdfUrl(productId: string) {
  return `${api.defaults.baseURL}/products/${productId}/label/piece.pdf`
}

export function productCartonSheetPdfUrl(productId: string) {
  return `${api.defaults.baseURL}/products/${productId}/label/carton.pdf`
}

export function productCartonLabelPngUrl(productId: string) {
  return `${api.defaults.baseURL}/products/${productId}/label/carton.png`
}

export function productPieceLabelPngUrl(productId: string) {
  return `${api.defaults.baseURL}/products/${productId}/label/piece.png`
}

export async function productPieceLabelPngObjectUrl(productId: string) {
  const { data } = await api.get(`/products/${productId}/label/piece.png`, {
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

export async function productCartonLabelPngObjectUrl(productId: string) {
  const { data } = await api.get(`/products/${productId}/label/carton.png`, {
    responseType: "blob",
  })
  return URL.createObjectURL(data as Blob)
}

export async function openPieceLabelInDLabel(payload: {
  name: string
  itemNumber: string
  qrCode: string
  pcsPerCarton: number
}) {
  const response = await fetch("http://localhost:5050/api/products/label/piece/dlabel-open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  let data: { message?: string } | null = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    throw new Error(data?.message ?? "تعذر الوصول إلى DLabel")
  }

  return data
}

export function openPieceLabelInDLabelLink(payload: {
  name: string
  itemNumber: string
  qrCode: string
  pcsPerCarton: number
}) {
  const params = new URLSearchParams({
    name: payload.name,
    itemNumber: payload.itemNumber,
    qrCode: payload.qrCode,
    pcsPerCarton: String(payload.pcsPerCarton),
  })
  const url = `http://localhost:5050/api/products/label/piece/dlabel-open-link?${params.toString()}`
  window.open(url, "_blank", "noopener,noreferrer,width=520,height=360")
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

export async function getCustomersPaged(params?: { search?: string; isSupplier?: boolean; limit?: number; includeDeleted?: boolean; page?: number; tags?: string[]; customerIds?: string[] }) {
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

export async function getDeletedCustomers() {
  const { data } = await api.get<ApiEnvelope<Customer[]>>("/customers/deleted")
  return data.data ?? []
}

export async function restoreCustomer(id: string) {
  const { data } = await api.post<ApiEnvelope<Customer>>(`/customers/${id}/restore`, {})
  return data.data
}

export async function createCustomerPortalLink(id: string, expiresInDays = 30) {
  const { data } = await api.post<ApiEnvelope<CustomerPortalLink>>(`/customers/${id}/portal-link`, { expiresInDays })
  return data.data
}

export async function toggleCustomerPortalLink(id: string, enabled: boolean) {
  const { data } = await api.patch<ApiEnvelope<CustomerPortalLink>>(`/customers/${id}/portal-link`, { enabled })
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

export async function getPortalOrders(token: string) {
  const { data } = await api.get<ApiEnvelope<PortalRetailOrder[]>>(`/public/client/${token}/orders`)
  return data.data ?? []
}

export async function getPortalArrivalSubscriptions(token: string) {
  const { data } = await api.get<ApiEnvelope<ArrivalSubscription[]>>(`/public/client/${token}/arrivals`)
  return data.data ?? []
}

export async function subscribeToProductArrival(
  token: string,
  productId: string | null,
  productName: string,
  pushSubscription: PushSubscriptionJSON | null
) {
  const { data } = await api.post<ApiEnvelope<ArrivalSubscription>>(`/public/client/${token}/arrivals`, {
    productId,
    productName,
    pushSubscription,
  })
  return data.data
}

export async function cancelArrivalSubscription(token: string, subId: string) {
  await api.delete(`/public/client/${token}/arrivals/${subId}`)
}

export async function getVapidPublicKey(): Promise<string | null> {
  try {
    const { data } = await api.get<ApiEnvelope<{ publicKey: string }>>("/public/vapid-key")
    return data.data?.publicKey ?? null
  } catch {
    return null
  }
}

export async function getCustomerTransactions(id: string, params?: { from?: string; to?: string }) {
  const { data } = await api.get<ApiEnvelope<CustomerTransactionsResponse>>(`/customers/${id}/transactions`, { params })
  return data.data?.transactions ?? []
}

// One page of the "حفظ الكشف العام" bulk export (customers who have at least
// one transaction, each with their full merged statement + invoice line items).
export async function getCustomerStatementsExport(params: { page: number; limit: number }) {
  const { data } = await api.get<PagedResponse<CustomerStatementsExportEntry>>("/reports/customers/statements-export", { params })
  return { entries: data.data ?? [], pagination: data.pagination }
}

export async function recalculateCustomerBalance(id: string) {
  const { data } = await api.post<ApiEnvelope<Customer>>(`/customers/${id}/recalculate-balance`)
  return data.data
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

export interface LastSoldPrice {
  invoiceId: string
  invoiceNumber: string
  date: string
  unit: string
  warehouseId?: string | null
  unitPrice: number
  quantity: number
}

export async function getLastSoldPrice(customerId: string, productId: string) {
  const { data } = await api.get<ApiEnvelope<LastSoldPrice | null>>(
    "/invoices/last-sold-price",
    { params: { customerId, productId } },
  )
  return data.data ?? null
}

export interface LastSoldPriceOverall extends LastSoldPrice {
  customerId: string
  customerName: string | null
}

// Last sale of this product to ANY customer — used by the invoice-line context
// menu so the seller has a price reference even before/without picking a customer.
export async function getLastSoldPriceOverall(productId: string) {
  const { data } = await api.get<ApiEnvelope<LastSoldPriceOverall | null>>(
    "/invoices/last-sold-price-overall",
    { params: { productId } },
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

export async function cancelInvoice(id: string, returnWarehouseId?: string) {
  const { data } = await api.delete<ApiEnvelope<Invoice>>(`/invoices/${id}`, {
    params: returnWarehouseId ? { returnWarehouseId } : undefined,
  })
  return data
}

export async function reactivateInvoice(id: string) {
  const { data } = await api.post<ApiEnvelope<Invoice>>(`/invoices/${id}/reactivate`)
  return data
}

export async function permanentDeleteInvoice(id: string, returnWarehouseId?: string) {
  const { data } = await api.delete<ApiEnvelope<{ id: string; invoiceNumber: string }>>(`/invoices/${id}/permanent`, {
    params: returnWarehouseId ? { returnWarehouseId } : undefined,
  })
  return data
}

export async function restoreArchivedInvoice(id: string) {
  const { data } = await api.post<ApiEnvelope<Invoice>>(`/invoices/${id}/restore-archived`)
  return data
}

export async function getRecentlyDeletedInvoices() {
  const { data } = await api.get<ApiEnvelope<Invoice[]>>("/invoices/recently-deleted")
  return data.data
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

// Regular invoice PDF as a Blob — used by the wa.me web channel to hand the
// employee the same file the Meta send attaches, since wa.me links can't
// carry attachments.
export async function downloadInvoicePdfBlob(id: string) {
  const { data } = await api.get(`/invoices/${id}/pdf`, { responseType: "blob" })
  return data as Blob
}

export function invoiceImageUrl(id: string) {
  return `${api.defaults.baseURL}/invoices/${id}/image`
}

export async function invoiceImageObjectUrl(id: string) {
  const { data } = await api.get(`/invoices/${id}/image`, {
    responseType: "blob",
  })
  return URL.createObjectURL(data as Blob)
}

// Customer-safe "invoice with product photos" downloads — same allowlist DTO
// as sendWhatsAppInvoiceImage above (never includes purchase price/cost
// price/profit/margin/internal notes).
export async function downloadCustomerImageInvoicePdfBlob(id: string) {
  const { data } = await api.get(`/invoices/${id}/customer-image-pdf/download`, {
    responseType: "blob",
  })
  return data as Blob
}

export async function downloadCustomerImageInvoiceExcelBlob(id: string) {
  const { data } = await api.get(`/invoices/${id}/customer-image-excel/download`, {
    responseType: "blob",
  })
  return data as Blob
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

// Sends the voucher's real PDF as a WhatsApp document (via the approved Meta
// template's document header when configured, falling back to a plain PDF
// send). `message` is the customizable caption built from Settings → قالب السند.
export async function sendVoucherPdfWhatsapp(id: string, message: string, channel?: WhatsAppSendChannel) {
  const { data } = await api.post<ApiEnvelope<{ to: string }>>(`/vouchers/${id}/send-whatsapp`, { message, channel })
  return data
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

/* ── Inbound WhatsApp messages (الرسائل الواردة) ────────────────────── */
export async function getInboundMessages(params?: { status?: InboundMessageStatus }) {
  const { data } = await api.get<ApiEnvelope<{ items: InboundMessage[]; unreadCount: number }>>("/inbound-messages", { params })
  return data.data
}

export async function markInboundMessageRead(id: string) {
  const { data } = await api.patch<ApiEnvelope<InboundMessage>>(`/inbound-messages/${id}/read`, {})
  return data.data
}

export async function replyToInboundMessage(id: string, text: string) {
  const { data } = await api.post<ApiEnvelope<InboundMessage>>(`/inbound-messages/${id}/reply`, { text })
  return data.data
}

/* ── Prospects (زبائن محتملين) ──────────────────────────────────────── */
export async function getProspects(params?: { status?: ProspectStatus; search?: string }) {
  const { data } = await api.get<ApiEnvelope<ProspectListResult>>("/prospects", { params })
  return data.data
}

export async function importProspects(prospects: Array<{ phone: string; name?: string }>) {
  const { data } = await api.post<ApiEnvelope<{ added: number; duplicates: number; total: number }>>("/prospects", { prospects })
  return data.data
}

export async function importProspectsFromImages(images: string[]) {
  const { data } = await api.post<ApiEnvelope<{ added: number; duplicates: number; total: number }>>("/prospects/from-images", { images })
  return data.data
}

export async function convertProspect(id: string, payload: { name: string; address?: string }) {
  const { data } = await api.post<ApiEnvelope<{ customerId: string }>>(`/prospects/${id}/convert`, payload)
  return data.data
}

export async function deleteProspect(id: string) {
  const { data } = await api.delete<ApiEnvelope<{ id: string }>>(`/prospects/${id}`)
  return data.data
}

/* ── Campaigns (drip marketing) ─────────────────────────────────────── */
export async function getCampaigns() {
  const { data } = await api.get<ApiEnvelope<Campaign[]>>("/campaigns")
  return data.data ?? []
}

export async function getCampaign(id: string) {
  const { data } = await api.get<ApiEnvelope<CampaignDetail>>(`/campaigns/${id}`)
  return data.data
}

export async function createCampaign(payload: CampaignPayload) {
  const { data } = await api.post<ApiEnvelope<Campaign>>("/campaigns", payload)
  return data.data
}

export async function updateCampaign(id: string, payload: CampaignPayload) {
  const { data } = await api.put<ApiEnvelope<Campaign>>(`/campaigns/${id}`, payload)
  return data.data
}

export async function deleteCampaign(id: string) {
  const { data } = await api.delete<ApiEnvelope<{ id: string }>>(`/campaigns/${id}`)
  return data.data
}

export async function setCampaignStatus(id: string, status: CampaignStatus) {
  const { data } = await api.patch<ApiEnvelope<Campaign>>(`/campaigns/${id}/status`, { status })
  return data.data
}

export async function loadCampaignProspects(id: string) {
  const { data } = await api.post<ApiEnvelope<{ added: number; duplicates: number; total: number }>>(
    `/campaigns/${id}/recipients`, {})
  return data.data
}

export async function deleteCampaignRecipient(id: string, recipientId: string) {
  const { data } = await api.delete<ApiEnvelope<{ id: string }>>(`/campaigns/${id}/recipients/${recipientId}`)
  return data.data
}

/* ── System health + error logs ─────────────────────────────────────── */
export async function getSystemHealth() {
  const { data } = await api.get<ApiEnvelope<SystemHealth>>("/health/system")
  return data.data
}

export async function getErrorLogs(params?: { source?: ErrorLogSource; includeResolved?: boolean }) {
  const { data } = await api.get<ApiEnvelope<ErrorLog[]> & { aiEnabled?: boolean }>("/error-logs", { params })
  return { rows: data.data ?? [], aiEnabled: Boolean(data.aiEnabled) }
}

export async function resolveErrorLog(id: string) {
  const { data } = await api.patch<ApiEnvelope<ErrorLog>>(`/error-logs/${id}/resolve`)
  return data.data
}

export async function analyzeErrorLog(id: string) {
  const { data } = await api.post<ApiEnvelope<ErrorAnalysis>>(`/error-logs/${id}/analyze`)
  return data.data
}

export async function analyzeHealthComponent(component: string) {
  const { data } = await api.post<ApiEnvelope<ErrorAnalysis>>("/error-logs/analyze-health", { component })
  return data.data
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

// ── «قناة تيليگرام» — wholesale-catalog mirror channel ──────────────────────
export interface TelegramChannelStatus {
  enabled: boolean
  configured: boolean
  availableCount: number
  postedCount: number
  pendingCount: number
  missingImageCount: number
  lastRunAt: string | null
  lastError: string | null
  lastRunPublished: number
  lastRunDeleted: number
  lastRunEdited: number
  rotationDailyCount: number
  rotationLastRunAt: string | null
  rotationLastRunCount: number
  rotationLastError: string | null
  featuredLastRunAt: string | null
  featuredLastError: string | null
  featuredProductName: string | null
}

export async function getTelegramChannelStatus() {
  const { data } = await api.get<TelegramChannelStatus>("/telegram-channel/status")
  return data
}

export async function testTelegramChannel() {
  const { data } = await api.post<{ botName: string }>("/telegram-channel/test")
  return data
}

export async function syncTelegramChannelNow() {
  const { data } = await api.post<TelegramChannelStatus>("/telegram-channel/sync-now")
  return data
}

export async function republishProductInTelegramChannel(productId: string) {
  const { data } = await api.post<{ ok: boolean; reason?: string }>(`/telegram-channel/republish/${productId}`)
  return data
}

export interface TelegramBroadcast {
  id: string
  text: string
  imageDataUrl: string | null
  toChannel: boolean
  toBotUsers: boolean
  pinInChannel: boolean
  status: "PENDING" | "SENDING" | "DONE" | "FAILED"
  totalRecipients: number
  sentCount: number
  createdAt: string
}

export async function listTelegramBroadcasts() {
  const { data } = await api.get<TelegramBroadcast[]>("/telegram-broadcast")
  return data
}

export async function createTelegramBroadcast(input: {
  text: string
  imageDataUrl?: string
  toChannel: boolean
  toBotUsers: boolean
  pinInChannel: boolean
}) {
  const { data } = await api.post<TelegramBroadcast>("/telegram-broadcast", input)
  return data
}

export interface TelegramBotStats {
  botUsers: number
  newLeads: number
  ordersFromTelegram: number
  revenueFromTelegram: number
  topProducts: Array<{ productId: string; productName: string; quantity: number }>
  recentChats: Array<{
    chatId: string
    firstName: string
    username: string
    phone: string
    createdAt: string
    isCustomer: boolean
  }>
}

export async function getTelegramBotStats() {
  const { data } = await api.get<TelegramBotStats>("/telegram-stats")
  return data
}

export async function banTelegramChatId(chatId: string) {
  const { data } = await api.post<{ telegramBotBannedChatIds: string[] }>("/telegram-stats/ban", { chatId })
  return data
}

export async function unbanTelegramChatId(chatId: string) {
  const { data } = await api.post<{ telegramBotBannedChatIds: string[] }>("/telegram-stats/unban", { chatId })
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
  keptProducts: number
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

// Per-send WhatsApp channel picked by staff:
//   official → Meta Cloud API (shop number)
//   personal → Green API (owner's personal number, daily-limited)
// The third channel ("web" / wa.me) never reaches the server — the page opens
// the link itself. undefined = tenant default provider (legacy behavior).
export type WhatsAppSendChannel = "official" | "personal"

export async function sendWhatsAppInvoice(invoiceId: string, channel?: WhatsAppSendChannel) {
  const { data } = await api.post<ApiEnvelope<{ to: string; filename: string }>>(`/whatsapp/send-invoice/${invoiceId}`, { channel })
  return data.data
}

// New, separate option — sends a customer-safe image invoice (product photos,
// no purchase price/cost/profit). Does not replace sendWhatsAppInvoice above.
export async function sendWhatsAppInvoiceImage(invoiceId: string, channel?: WhatsAppSendChannel) {
  const { data } = await api.post<ApiEnvelope<{ to: string; idMessage?: string }>>(`/whatsapp/send-invoice-image/${invoiceId}`, { channel })
  return data.data
}

export interface WorkerSendResult {
  sent: { phone: string; name: string }[]
  failed: { phone: string; name: string; error: string }[]
  skipped: { phone: string; reason: string }[]
}

export async function sendInvoiceToWorkers(invoiceId: string, phones: string[], channel?: WhatsAppSendChannel) {
  const { data } = await api.post<ApiEnvelope<WorkerSendResult>>(
    `/whatsapp/send-invoice-to-workers/${invoiceId}`,
    { phones, channel },
  )
  return data
}

export async function sendWhatsAppMessage(payload: { phone: string; message: string; channel?: WhatsAppSendChannel }) {
  const { data } = await api.post<ApiEnvelope<never>>("/whatsapp/send", payload)
  return data
}

// Same free-text fallback as sendWhatsAppMessage, but also tries the
// Meta-approved template configured in Settings for this templateKind first
// (survives the 24h reply-window restriction once a template is approved).
export async function sendWhatsAppTemplatedMessage(payload: {
  phone: string
  message: string
  templateKind: "voucher" | "statement" | "portal" | "debtReminder" | "inactiveCustomer"
  bodyParams: string[]
  channel?: WhatsAppSendChannel
}) {
  const { data } = await api.post<ApiEnvelope<never>>("/whatsapp/send-templated", payload)
  return data
}

export type WhatsAppState = "INITIALIZING" | "QR" | "READY" | "AUTH_FAILURE" | "DISCONNECTED" | "ERROR"
export type WhatsAppProvider = "manual" | "greenapi" | "cloud" | "web" | "disabled"
export type WhatsAppStatusCode = "ready" | "missing_settings" | "failed" | "disabled" | "manual_only"
export type WhatsAppProviderSource = "env" | "db" | "default"

export interface WhatsAppChannelsStatus {
  official: { configured: boolean }
  personal: { enabled: boolean; configured: boolean; dailyLimit: number; sentToday: number }
  web: { enabled: boolean }
}

export interface WhatsAppStatus {
  provider: WhatsAppProvider
  activeProvider: WhatsAppProvider
  channels?: WhatsAppChannelsStatus
  selectedProvider: WhatsAppProvider | null
  providerSource: WhatsAppProviderSource
  missingFields: string[]
  status: WhatsAppStatusCode
  enabled: boolean
  cloudConfigured: boolean
  greenConfigured: boolean
  businessAccountId: string | null
  verifyTokenSet: boolean
  appSecretSet: boolean
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

export interface WabaSubscribedApp {
  whatsapp_business_api_data?: { id?: string; name?: string; link?: string }
}

// Which Meta Apps are subscribed to this WABA's webhook events.
export async function getWabaSubscribedApps(wabaId?: string) {
  const { data } = await api.get<ApiEnvelope<{ wabaId: string; apps: WabaSubscribedApp[] }>>("/whatsapp/waba-subscribed-apps", { params: { wabaId } })
  return data.data
}

export async function subscribeAppToWaba(wabaId?: string) {
  const { data } = await api.post<ApiEnvelope<{ wabaId: string; apps: WabaSubscribedApp[] }>>("/whatsapp/waba-subscribed-apps", { wabaId })
  return data.data
}

export async function restartWhatsApp() {
  const { data } = await api.post<ApiEnvelope<never>>("/whatsapp/restart")
  return data
}

// ── WhatsApp provider test / diagnostics ────────────────────────────────────
export async function testWhatsAppText(payload: { phone: string; message?: string }) {
  const { data } = await api.post<ApiEnvelope<unknown>>("/whatsapp/test/text", payload)
  return data
}

export async function testWhatsAppImage(payload: { phone: string }) {
  const { data } = await api.post<ApiEnvelope<unknown>>("/whatsapp/test/image", payload)
  return data
}

export async function testWhatsAppPdf(payload: { phone: string }) {
  const { data } = await api.post<ApiEnvelope<unknown>>("/whatsapp/test/pdf", payload)
  return data
}

export interface WhatsAppWebhookCheck {
  ready: boolean
  webhookUrl: string
  verifyTokenSet: boolean
  appSecretConfigured: boolean
  appSecretWarning: string | null
  issues: string[]
  instructions?: string[]
}

export async function checkWhatsAppWebhook() {
  const { data } = await api.get<ApiEnvelope<WhatsAppWebhookCheck>>("/whatsapp/webhook-check")
  return data.data
}

export async function regenerateVerifyToken() {
  const { data } = await api.post<ApiEnvelope<{ verifyToken: string }>>("/whatsapp/verify-token/regenerate")
  return data.data
}

export interface TransferItemPayload {
  productId: string
  quantity: number
  unit: "PIECE" | "DOZEN" | "BOX" | "CARTON"
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
export async function getCatalogCustomers(params?: { search?: string; limit?: number; offset?: number }) {
  const { data } = await api.get<ApiEnvelope<CatalogCustomer[]> & { total?: number }>("/catalog-management", { params })
  return { rows: data.data ?? [], total: data.total ?? 0 }
}

export type CatalogVisitor = {
  id: string; phone: string; visits: number; firstSeenAt: string; lastSeenAt: string
  customerId: string | null; customerName: string | null
}

export async function getCatalogVisitors() {
  const { data } = await api.get<ApiEnvelope<{ visitors: CatalogVisitor[]; uniquePhones: number; totalVisits: number }>>("/catalog-management/visitors")
  return data.data ?? { visitors: [], uniquePhones: 0, totalVisits: 0 }
}

export async function convertCatalogVisitor(phone: string, opts?: { name?: string; grantAccess?: boolean; allowPrices?: boolean }) {
  const { data } = await api.post<ApiEnvelope<{ customerId: string; customerName: string; created: boolean }>>(`/catalog-management/visitors/${encodeURIComponent(phone)}/convert`, opts ?? {})
  return data.data!
}

export async function broadcastToCatalogVisitors(message: string, phones?: string[]) {
  const { data } = await api.post<ApiEnvelope<{ started: boolean; total: number }>>("/catalog-management/visitors/broadcast", { message, phones })
  return data.data!
}

export type CatalogProductStat = { productId: string; name: string; itemNumber: string | null; thumbnailUrl: string | null; views: number; orders: number }

export async function getCatalogProductStats() {
  const { data } = await api.get<ApiEnvelope<{ topViewed: CatalogProductStat[]; topOrdered: CatalogProductStat[]; totalViews: number; totalOrders: number }>>("/catalog-management/product-stats")
  return data.data ?? { topViewed: [], topOrdered: [], totalViews: 0, totalOrders: 0 }
}

// Deduped per device per day so repeat opens of the same product by the same
// visitor count once — the counter reflects unique daily interest, not clicks.
export async function trackCatalogProductView(productId: string) {
  if (!productId) return
  try {
    const key = `catalog_viewed_${new Date().toISOString().slice(0, 10)}`
    const seen: string[] = JSON.parse(localStorage.getItem(key) || "[]")
    if (seen.includes(productId)) return
    seen.push(productId)
    localStorage.setItem(key, JSON.stringify(seen))
  } catch { /* localStorage unavailable — fall through and still count */ }
  try { await api.post("/public/catalog/track-view", { productId }) } catch { /* best-effort */ }
}

export interface CatalogDesign {
  primaryColor: string | null
  bgColor: string | null
  defaultTheme: "clean" | "warm" | "dark" | "vibrant"
  logoUrl: string | null
  welcomeMessage: string | null
  bannerEnabled: boolean
  bannerImages: Array<{ url: string; title: string; order: number }>
}

export async function getCatalogDesign() {
  const { data } = await api.get<ApiEnvelope<CatalogDesign>>("/catalog-management/design")
  return data.data!
}

export async function updateCatalogDesign(payload: Partial<CatalogDesign>) {
  const { data } = await api.put<ApiEnvelope<never>>("/catalog-management/design", payload)
  return data
}

/* ── Admin promo codes (catalog) ────────────────────────────────────────── */
export interface PromoCode {
  id: string
  code: string
  type: "PERCENT" | "AMOUNT" | "FREE_DELIVERY"
  value: number | null
  customerId: string | null
  customer: { id: string; name: string; phone: string } | null
  expiresAt: string | null
  usageLimit: number | null
  usedCount: number
  active: boolean
  description: string | null
  createdAt: string
}

export async function listAdminPromoCodes() {
  const { data } = await api.get<ApiEnvelope<PromoCode[]>>("/catalog-management/promo-codes")
  return data.data ?? []
}

export async function createAdminPromoCode(payload: {
  code: string
  type: "PERCENT" | "AMOUNT" | "FREE_DELIVERY"
  value?: number
  customerId?: string
  expiresAt?: string
  usageLimit?: number
  description?: string
}) {
  const { data } = await api.post<ApiEnvelope<PromoCode>>("/catalog-management/promo-codes", payload)
  return data.data!
}

export async function deleteAdminPromoCode(id: string) {
  const { data } = await api.delete<ApiEnvelope<never>>(`/catalog-management/promo-codes/${id}`)
  return data
}

export async function toggleAdminPromoCode(id: string, active: boolean) {
  const { data } = await api.patch<ApiEnvelope<PromoCode>>(`/catalog-management/promo-codes/${id}/toggle`, { active })
  return data.data!
}

export async function grantCatalogAccess(customerId: string, opts: { allowPrices: boolean; showStock: boolean; stockFilter?: CatalogStockFilter }) {
  const { data } = await api.post<ApiEnvelope<{ token: string; urlPath: string; allowPrices: boolean; showStock: boolean; stockFilter: CatalogStockFilter }>>(
    `/catalog-management/${customerId}/grant`,
    opts,
  )
  return data.data!
}

export async function patchCatalogAccess(customerId: string, patch: { allowPrices?: boolean; showStock?: boolean; stockFilter?: CatalogStockFilter }) {
  const { data } = await api.patch<ApiEnvelope<{ allowPrices: boolean; showStock: boolean; stockFilter: CatalogStockFilter; token: string }>>(
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

export async function markOrderPrepared(id: string, opts?: { warehouseId?: string; notes?: string }) {
  const { data } = await api.post<ApiEnvelope<{ invoiceId?: string; invoiceNumber?: string; totalAmount?: number }>>(`/order-preparations/${id}/mark-prepared`, opts ?? {})
  return data
}

// Link an already-created invoice to a preparation and mark it prepared (manual flow)
export async function completeOrderPreparation(id: string, invoiceId: string) {
  const { data } = await api.post<ApiEnvelope<{ invoiceId?: string }>>(`/order-preparations/${id}/complete`, { invoiceId })
  return data
}

// «زبون جديد — نسويله حساب؟» (Telegram bot orders with an unregistered phone)
export async function createPreparationCustomer(id: string) {
  const { data } = await api.post<ApiEnvelope<{ customerId: string; name: string; created: boolean }>>(
    `/order-preparations/${id}/create-customer`,
    {},
  )
  return data
}

// Cancel a pending preparation (rejected / not prepared)
export async function cancelOrderPreparation(id: string) {
  const { data } = await api.post<ApiEnvelope<{ id: string; status: string }>>(`/order-preparations/${id}/cancel`, {})
  return data
}

// ── Profit Report ─────────────────────────────────────────────────────────────
export async function getProfitReport(params?: { from?: string; to?: string; groupBy?: "day" | "week" | "month" }) {
  const { data } = await api.get<ApiEnvelope<ProfitReport>>("/reports/profit", { params })
  return data.data!
}

export async function getWarehouseComparisonReport(params?: { from?: string; to?: string }) {
  const { data } = await api.get<ApiEnvelope<WarehouseComparisonRow[]>>("/reports/warehouse-comparison", { params })
  return data.data ?? []
}

export async function getCrossSellPairs(params?: { from?: string; to?: string; productId?: string; limit?: number }) {
  const { data } = await api.get<ApiEnvelope<CrossSellPair[]>>("/reports/cross-sell", { params })
  return data.data ?? []
}

export async function getStoreBrainReport(params?: { from?: string; to?: string }) {
  const { data } = await api.get<ApiEnvelope<StoreBrainReport>>("/reports/store-brain", { params })
  return data.data!
}

// ── «المساعد الذكي اليومي» (Daily Smart Assistant) — cloud backend only in V1 ──
export async function getDailyAssistant(params?: { date?: string; refresh?: boolean }) {
  const { data } = await api.get<ApiEnvelope<DailyAssistantReport>>("/reports/daily-assistant", { params })
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

// ── Inactive Customer Reminder ────────────────────────────────────────────────
export async function getInactiveReminderList(minDays: number) {
  const { data } = await api.get<ApiEnvelope<InactiveCustomer[]>>("/reports/inactive-reminder", { params: { minDays } })
  return data.data ?? []
}

export async function sendInactiveReminder(payload: { customerIds?: string[]; minDays?: number }) {
  const { data } = await api.post<ApiEnvelope<{ sent: number; failed: number; errors: string[] }>>("/reports/inactive-reminder/send", payload)
  return data.data!
}

// ── Stocktake ─────────────────────────────────────────────────────────────────
export async function listStocktakeSessions() {
  const { data } = await api.get<ApiEnvelope<StocktakeSessionSummary[]>>("/stocktake")
  return data.data ?? []
}

export async function createStocktakeSession(payload: { notes?: string; branchId?: string }) {
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

export async function archiveStocktakeSession(id: string) {
  const { data } = await api.post<ApiEnvelope<{ success: boolean }>>(`/stocktake/${id}/archive`)
  return data.data
}

export async function approveStocktakeItem(sessionId: string, itemId: string) {
  const { data } = await api.post<ApiEnvelope<{ success: boolean; delta: number; newQty: number }>>(`/stocktake/${sessionId}/items/${itemId}/approve`)
  return data.data!
}

export async function rejectStocktakeItem(sessionId: string, itemId: string) {
  const { data } = await api.post<ApiEnvelope<{ success: boolean }>>(`/stocktake/${sessionId}/items/${itemId}/reject`)
  return data.data!
}

// ── جدولة الجرد الذكي (scheduled smart cycle count) — independent from Stocktake above ──
export async function listCycleCountSessions() {
  const { data } = await api.get<ApiEnvelope<CycleCountSessionSummary[]>>("/cycle-count")
  return data.data ?? []
}

export async function createCycleCountSession(payload: { warehouseId?: string; strategy: CycleCountStrategy; itemLimit: number; notes?: string }) {
  const { data } = await api.post<ApiEnvelope<{ id: string }>>("/cycle-count", payload)
  return data.data!
}

export async function getCycleCountSession(id: string) {
  const { data } = await api.get<ApiEnvelope<CycleCountSessionDetail>>(`/cycle-count/${id}`)
  return data.data!
}

export async function updateCycleCountItem(sessionId: string, productId: string, actualQty: number, notes?: string) {
  const { data } = await api.patch<ApiEnvelope<never>>(`/cycle-count/${sessionId}/items`, { productId, actualQty, notes })
  return data
}

export async function submitCycleCountSession(id: string) {
  const { data } = await api.post<ApiEnvelope<CycleCountSessionDetail>>(`/cycle-count/${id}/submit`)
  return data.data!
}

export async function closeCycleCountSession(id: string) {
  const { data } = await api.post<ApiEnvelope<CycleCountSessionDetail>>(`/cycle-count/${id}/close`)
  return data.data!
}

export async function cancelCycleCountSession(id: string) {
  const { data } = await api.post<ApiEnvelope<{ success: boolean }>>(`/cycle-count/${id}/cancel`)
  return data.data!
}

export async function approveCycleCountItem(sessionId: string, itemId: string) {
  const { data } = await api.post<ApiEnvelope<{ success: boolean; delta: number; newQty: number }>>(`/cycle-count/${sessionId}/items/${itemId}/approve`)
  return data.data!
}

export async function rejectCycleCountItem(sessionId: string, itemId: string) {
  const { data } = await api.post<ApiEnvelope<{ success: boolean }>>(`/cycle-count/${sessionId}/items/${itemId}/reject`)
  return data.data!
}

export async function approveAllCycleCountItems(sessionId: string) {
  const { data } = await api.post<ApiEnvelope<{ success: boolean; approvedCount: number }>>(`/cycle-count/${sessionId}/approve-all`)
  return data.data!
}

export async function rejectAllCycleCountItems(sessionId: string) {
  const { data } = await api.post<ApiEnvelope<{ success: boolean; rejectedCount: number }>>(`/cycle-count/${sessionId}/reject-all`)
  return data.data!
}

export async function reopenCycleCountSession(id: string) {
  const { data } = await api.post<ApiEnvelope<CycleCountSessionDetail>>(`/cycle-count/${id}/reopen`)
  return data.data!
}

// ── Excel Import ──────────────────────────────────────────────────────────────
export async function importProductsExcel(file: File) {
  const form = new FormData()
  form.append("file", file)
  const { data } = await api.post<ApiEnvelope<{ created: number; skipped: number; errors: string[] }>>("/import/products", form, { headers: { "Content-Type": "multipart/form-data" } })
  return data.data!
}

export function getImportTemplateUrl() {
  return `${api.defaults.baseURL}/import/products/template`
}

// ── Landed Cost Excel Import ───────────────────────────────────────────────

export type LandedCostAllocationMethod = "BY_QUANTITY" | "BY_VALUE" | "BY_CARTON"
export type LandedCostMatchStatus = "MATCHED" | "NOT_FOUND" | "AMBIGUOUS"
export type LandedCostItemAction = "PENDING" | "LINK_EXISTING" | "CREATE_NEW" | "SKIP"
export type LandedCostBatchStatus = "DRAFT_PRICED" | "REVIEWING_ITEMS" | "PURCHASE_INVOICE_CREATED" | "CANCELLED"

export interface LandedCostManualExtraCosts {
  freight?: number
  customs?: number
  localTransport?: number
  unloading?: number
  commission?: number
  otherCosts?: number
}

export interface LandedCostComputedItem {
  itemCode: string
  productName: string
  quantity: number
  cartonCount: number | null
  purchasePrice: number
  allocatedExtraCost: number
  landedCostPerUnit: number
  landedCostPerCarton: number | null
  suggestedSalePrice: number | null
  expectedProfit: number | null
  matchStatus: LandedCostMatchStatus
  productId: string | null
  matchedProduct: { id: string; name: string; itemNumber: string; salePrice: number; purchasePrice: number; imageUrl: string | null; thumbnailUrl: string | null } | null
}

export interface LandedCostPreviewResult {
  items: LandedCostComputedItem[]
  totalExtraCost: number
  allocationMethod: LandedCostAllocationMethod
  manualExtraCosts: LandedCostManualExtraCosts
  totalRows: number
  ambiguousCount: number
  notFoundCount: number
}

export interface LandedCostItem extends LandedCostComputedItem {
  id: string
  action: LandedCostItemAction
  confirmedSalePrice: number | null
  newProductDraft: { name?: string; itemCode?: string; barcode?: string; category?: string; pcsPerCarton?: number; imageUrl?: string } | null
  product?: { id: string; name: string; itemNumber: string; imageUrl: string | null; thumbnailUrl: string | null; salePrice: number; purchasePrice: number; costPrice: number } | null
  // China fixed-template fields (null on legacy generic batches)
  piecesPerCarton?: number | null
  unitPriceCny?: number | null
  cartonCbm?: number | null
  cartonCostUsd?: number | null
  unitCostUsd?: number | null
}

export interface LandedCostBatch {
  id: string
  invoiceNumber: string | null
  supplier: string | null
  allocationMethod: LandedCostAllocationMethod
  totalExtraCost: number
  status: LandedCostBatchStatus
  note: string | null
  originalFileName: string | null
  purchaseInvoice: { id: string; invoiceNumber: string } | null
  createdAt: string
  appliedAt: string | null
  items: LandedCostItem[]
}

export async function previewLandedCost(file: File, allocationMethod: LandedCostAllocationMethod, manualExtraCosts: LandedCostManualExtraCosts) {
  const form = new FormData()
  form.append("file", file)
  form.append("allocationMethod", allocationMethod)
  Object.entries(manualExtraCosts).forEach(([k, v]) => { if (v !== undefined) form.append(k, String(v)) })
  const { data } = await api.post<ApiEnvelope<LandedCostPreviewResult>>("/landed-cost/preview", form, { headers: { "Content-Type": "multipart/form-data" } })
  return data.data!
}

export function getLandedCostTemplateUrl() {
  return `${api.defaults.baseURL}/landed-cost/template`
}

export async function createLandedCostBatch(payload: {
  invoiceNumber?: string
  supplier?: string
  allocationMethod: LandedCostAllocationMethod
  freight?: number; customs?: number; localTransport?: number; unloading?: number; commission?: number; otherCosts?: number
  note?: string
  originalFileName?: string
  items: LandedCostComputedItem[]
}) {
  const { data } = await api.post<ApiEnvelope<LandedCostBatch>>("/landed-cost/batches", payload)
  return data.data!
}

export async function listLandedCostBatches() {
  const { data } = await api.get<ApiEnvelope<LandedCostBatch[]>>("/landed-cost/batches")
  return data.data ?? []
}

export async function getLandedCostBatch(id: string) {
  const { data } = await api.get<ApiEnvelope<LandedCostBatch>>(`/landed-cost/batches/${id}`)
  return data.data!
}

export async function setLandedCostItemDecision(batchId: string, itemId: string, payload: {
  action: LandedCostItemAction
  productId?: string | null
  confirmedSalePrice?: number | null
  newProductDraft?: LandedCostItem["newProductDraft"]
}) {
  const { data } = await api.patch<ApiEnvelope<LandedCostItem>>(`/landed-cost/batches/${batchId}/items/${itemId}`, payload)
  return data.data!
}

export async function cancelLandedCostBatch(id: string) {
  await api.post(`/landed-cost/batches/${id}/cancel`)
}

export interface LandedCostConfirmSummary {
  purchaseInvoiceId: string
  invoiceNumber: string
  linkedCount: number
  createdCount: number
  skippedCount: number
  totalStockAdded: number
  warnings: string[]
}

export async function confirmLandedCostBatch(id: string, payload: { supplierCustomerId: string; warehouseId?: string; paymentType?: string; paidAmount?: number }) {
  const { data } = await api.post<ApiEnvelope<LandedCostConfirmSummary>>(`/landed-cost/batches/${id}/confirm`, payload)
  return data.data!
}

// ── China fixed-template order pricing (the only visible landed-cost flow) ──

export interface ChinaPricingParams {
  cbmPriceUsd: number
  officePercent: number
  cnyPerUsd: number
  usdToIqd: number
}

export interface ChinaPricedItem {
  itemNumber: string
  image: string
  cartonCount: number
  piecesPerCarton: number
  totalPieces: number
  unitPriceCny: number
  cartonCbm: number
  cartonCny: number
  cartonUsdBeforeOffice: number
  cartonUsdAfterOffice: number
  cartonShippingUsd: number
  cartonCostUsd: number
  unitCostUsd: number
  unitCostIqd: number
  cartonCostIqd: number
  suggestedSalePrice: number | null
  matchStatus: LandedCostMatchStatus
  productId: string | null
  matchedProduct: { id: string; name: string; itemNumber: string; salePrice: number; purchasePrice: number; imageUrl: string | null; thumbnailUrl: string | null } | null
}

export interface ChinaPricingResult {
  items: ChinaPricedItem[]
  totalCartons: number
  totalPieces: number
  totalOrderCostUsd: number
  totalOrderCostIqd: number
  ambiguousCount: number
  notFoundCount: number
  params: ChinaPricingParams
}

export function getChinaTemplateUrl() {
  return `${api.defaults.baseURL}/landed-cost/china/template`
}

export async function previewChinaOrder(file: File, params: ChinaPricingParams) {
  const form = new FormData()
  form.append("file", file)
  Object.entries(params).forEach(([k, v]) => form.append(k, String(v)))
  const { data } = await api.post<ApiEnvelope<ChinaPricingResult>>("/landed-cost/china/preview", form, { headers: { "Content-Type": "multipart/form-data" } })
  return data.data!
}

export async function createChinaOrderBatch(payload: {
  invoiceNumber?: string
  supplier?: string
  note?: string
  originalFileName?: string
  params: ChinaPricingParams
  items: ChinaPricedItem[]
}) {
  const { data } = await api.post<ApiEnvelope<LandedCostBatch>>("/landed-cost/china/batches", payload)
  return data.data!
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
  warehouseId?: string
  isSubscriber?: boolean
  interests?: string[]
  wishNote?: string
  items: Array<{ retailItemId: string; quantity: number; warehouseId?: string }>
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


export interface VarietyConvertResult {
  targetProductId: string
  targetProductName: string
  addedPieces: number
  newCost: number
  lines: Array<{ productId: string; productName: string; pieces: number }>
}

export async function convertToVariety(payload: {
  fromWarehouseId: string
  targetProductId: string
  toWarehouseId?: string
  allowNegative?: boolean
  notes?: string
  items: Array<{ productId: string; unit: "PIECE" | "DOZEN" | "BOX" | "CARTON"; quantity: number }>
}) {
  const { data } = await api.post<ApiEnvelope<VarietyConvertResult>>("/products/variety-convert", payload)
  return data.data
}

// ── Voice Invoice ─────────────────────────────────────────────────────────────

export interface VoiceParsedPlan {
  type: "confirm" | "clarify" | "answer" | "cancel"
  reply: string
  plan?: {
    operation: "INVOICE" | "VOUCHER"
    customerId: string
    customerName: string
    items?: Array<{
      productId: string
      productName: string
      quantity: number
      unit: string
      unitPrice: number
      totalPrice: number
      warehouseId?: string
    }>
    totalAmount?: number
    paymentType?: string
    paidAmount?: number
    amount?: number
    voucherType?: string
  }
  missing?: string[]
  suggestions?: Record<string, string[]>
}

export interface VoiceChatMessage {
  role: "user" | "assistant"
  content: string
}

export async function voiceParse(payload: {
  command: string
  history?: VoiceChatMessage[]
}) {
  const { data } = await api.post<ApiEnvelope<VoiceParsedPlan>>("/voice/parse", payload)
  return data.data!
}

export async function voiceExecute(plan: VoiceParsedPlan["plan"]) {
  const { data } = await api.post<ApiEnvelope<{ invoiceId?: string; invoiceNumber?: string; voucherId?: string }>>("/voice/execute", { plan })
  return data.data!
}
