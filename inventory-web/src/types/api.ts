export type Role = "ADMIN" | "STAFF"
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED"

export interface ApiEnvelope<T> {
  success: boolean
  message?: string
  data?: T
  token?: string
  user?: User
  approvalId?: string
}

export interface User {
  id: string
  name: string
  username: string
  role: Role
  isActive: boolean
  createdAt?: string
  updatedAt?: string
}

export interface LoginPayload {
  username: string
  password: string
}

export interface CreateUserPayload {
  name: string
  username: string
  password: string
  role: Role
  isActive?: boolean
}

export interface UpdateUserPayload {
  name?: string
  username?: string
  password?: string
  role?: Role
  isActive?: boolean
}

export interface Approval {
  id: string
  requestType: string
  requestData: unknown
  requestedBy: string
  status: ApprovalStatus
  reviewedBy?: string | null
  reviewedAt?: string | null
  createdAt?: string
  requester?: User
}

export interface PagedResponse<T> {
  success: boolean
  data: T[]
  pagination?: {
    total: number
    page: number
    limit: number
    pages: number
  }
}

export interface Product {
  id: string
  itemNumber: string
  name: string
  qrCode?: string
  cartonQrCode?: string | null
  category?: string | null
  openingBalancePcs: number
  cartonsAvailable: number
  pcsPerCarton: number
  purchasePrice: number
  salePrice: number
  minStock: number
  currentStock?: number
  updatedAt?: string
}

export interface ProductPayload {
  // Only `name` is required; the server will auto-generate item number / QR codes if omitted.
  name: string
  itemNumber?: string
  qrCode?: string
  cartonQrCode?: string
  category?: string
  openingBalancePcs?: number
  cartonsAvailable?: number
  pcsPerCarton?: number
  purchasePrice?: number
  salePrice?: number
  minStock?: number
  branchId?: string   // optional — defaults to main branch on server
}

export interface ProductMovement {
  date: string
  customerName: string
  quantity: number
  unit?: string
  unitPrice?: number
  price?: number
  totalPrice?: number
  invoiceNumber: string
  invoiceId?: string
}

export interface ProductMovementResponse {
  product?: Pick<Product, "id" | "itemNumber" | "name">
  rows: ProductMovement[]
  totals?: {
    quantitySold: number
    totalRevenue: number
  }
}

export interface Customer {
  id: string
  name: string
  phone: string
  address?: string | null
  notes?: string | null
  openingBalance: number
  currentBalance: number
  isSupplier?: boolean
  lastTransactionAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface CustomerPayload {
  name: string
  phone: string
  address?: string
  notes?: string
  openingBalance: number
  isSupplier?: boolean
}

export interface CustomerTransaction {
  id: string
  date: string
  type: string
  amount: number
  referenceNumber: string
  debit?: number
  credit?: number
  runningBalance: number
}

export interface CustomerTransactionsResponse {
  customer: {
    id: string
    name: string
    openingBalance: number
  }
  transactions: CustomerTransaction[]
}

export interface LastTransaction {
  id?: string
  date?: string
  type?: string
  amount?: number
  referenceNumber?: string
}

export interface Invoice {
  id: string
  invoiceNumber: string
  type?: "SALE" | "PURCHASE"
  customerId: string
  customer?: Customer
  date: string
  subtotal?: number
  discount?: number
  tax?: number
  totalAmount: number
  paidAmount: number
  remainingAmount: number
  previousBalance?: number
  finalBalance?: number
  paymentType?: "CASH" | "CREDIT" | "PARTIAL"
  status: string
  items?: InvoiceItem[]
  createdAt?: string
  updatedAt?: string
  creator?: User
}

export interface InvoiceItem {
  id?: string
  invoiceId?: string
  productId: string
  productName?: string
  unit: "PIECE" | "DOZEN" | "CARTON"
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface CreateInvoicePayload {
  customerId: string
  type?: "SALE" | "PURCHASE"
  date?: string
  discount: number
  tax: number
  paidAmount: number
  paymentType?: "CASH" | "CREDIT" | "PARTIAL"
  items: Array<{
    productId: string
    unit: "PIECE" | "DOZEN" | "CARTON"
    quantity: number
    unitPrice?: number
  }>
}

export interface Voucher {
  id: string
  voucherNumber: string
  customerId?: string | null
  customer?: Customer | null
  creator?: Pick<User, "id" | "name" | "username" | "role">
  amount: number
  type: "RECEIPT" | "PAYMENT" | "EXPENSE"
  date: string
  notes?: string | null
  description?: string | null
}

export interface VoucherPayload {
  customerId?: string
  amount: number
  type: "RECEIPT" | "PAYMENT" | "EXPENSE"
  date?: string
  notes?: string
  description?: string
}

export type ReceiptPayload = VoucherPayload & {
  type: "RECEIPT"
  date: string
}

export interface DashboardReport {
  todaySales: number
  todayInvoices: number
  totalDebts: number
  lowStockProducts: number
  topProductsThisMonth: Array<{
    productId: string
    productName: string
    quantitySold: number
    totalSales: number
  }>
  lastSevenDaysSales: Array<{
    date: string
    totalSales: number
  }>
}

export interface SalesReport {
  totalSales: number
  invoiceCount: number
  netProfit: number
  chart: Array<{
    period: string
    totalSales: number
    netProfit: number
  }>
}

export interface InventoryValuation {
  products: Array<{
    id: string
    itemNumber: string
    name: string
    category: string
    currentStock: number
    purchasePrice: number
    salePrice: number
    purchaseValue: number
    saleValue: number
  }>
  totals: {
    currentStock: number
    purchaseValue: number
    saleValue: number
  }
}

export interface CustomerDebt {
  id: string
  name: string
  phone: string
  currentBalance: number
  lastTransactionAt?: string | null
  debtAgeDays: number
}

export interface TopCustomer {
  customerId: string
  name: string
  phone: string
  currentBalance: number
  totalPurchases: number
  totalPaid: number
  invoiceCount: number
}

export interface EndOfDayReport {
  date: string
  sales: { count: number; total: number; collected: number }
  purchases: { count: number; total: number }
  receipts: { count: number; total: number }
  payments: { count: number; total: number }
  expenses: { count: number; total: number }
  invoices: Array<{ invoiceNumber: string; customerName: string; total: number; paid: number }>
}

export type ThemePreset = "classic" | "iraqi" | "exclusive" | "bold" | "designer"

export interface AppSettings {
  storeName: string
  storeLogo: string
  storePhone: string
  storeAddress: string
  currency: string
  debtReminderDays: number
  inactiveCustomerDays: number
  autoSendDebtReminder: boolean
  autoSendInactiveMessage: boolean
  invoiceTemplate?: string
  voucherTemplate?: string
  statementTemplate?: string
  themePreset?: ThemePreset
}

export interface MessageTemplate {
  id: string
  name: string
  body: string
  type: string
  isActive: boolean
  createdAt?: string
  updatedAt?: string
}

export interface AuditLog {
  id: string
  userId?: string | null
  user?: Pick<User, "id" | "name" | "username" | "role"> | null
  action: string
  entity: string
  recordId?: string | null
  before?: unknown
  after?: unknown
  metadata?: unknown
  ipAddress?: string | null
  userAgent?: string | null
  createdAt: string
}

export interface Branch {
  id: string
  name: string
  code: string
  phone?: string | null
  address?: string | null
  isActive: boolean
  createdAt?: string
  updatedAt?: string
}

export interface BranchPayload {
  name: string
  code: string
  phone?: string
  address?: string
  isActive?: boolean
}
