import { api } from "./client"
import type {
  ApiEnvelope,
  AppSettings,
  Approval,
  AuditLog,
  Branch,
  BranchPayload,
  CreateInvoicePayload,
  CreateUserPayload,
  Customer,
  CustomerDebt,
  CustomerPayload,
  CustomerTransactionsResponse,
  DashboardReport,
  Invoice,
  InventoryValuation,
  LoginPayload,
  LastTransaction,
  MessageTemplate,
  PagedResponse,
  Product,
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

export async function getApprovals() {
  const { data } = await api.get<ApiEnvelope<Approval[]>>("/approvals")
  return data.data ?? []
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

export async function getProducts(params?: { search?: string; category?: string }) {
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

export async function getCustomers(params?: { search?: string; isSupplier?: boolean }) {
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
  type?: "SALE" | "PURCHASE"
  paymentType?: "CASH" | "CREDIT" | "PARTIAL"
  page?: number
  limit?: number
}) {
  const { data } = await api.get<PagedResponse<Invoice>>("/invoices", { params: { limit: 100, ...params } })
  return data.data ?? []
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

export async function getSettings() {
  const { data } = await api.get<ApiEnvelope<AppSettings>>("/settings")
  return data.data
}

export async function updateSettings(payload: Partial<AppSettings>) {
  const { data } = await api.put<ApiEnvelope<AppSettings>>("/settings", payload)
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
