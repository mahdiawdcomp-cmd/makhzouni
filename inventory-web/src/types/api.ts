export type Role = "ADMIN" | "STAFF"
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED"
export type InvoiceType = "SALE" | "PURCHASE" | "SALES_RETURN"
export type UserPermission =
  | "MANAGE_USERS"
  | "MANAGE_APPROVALS"
  | "MANAGE_PRODUCTS"
  | "MANAGE_CUSTOMERS"
  | "MANAGE_INVOICES"
  | "MANAGE_VOUCHERS"
  | "VIEW_REPORTS"
  | "MANAGE_SETTINGS"
  | "VIEW_WITHOUT_PRICES"
  | "SELL_WITH_DISCOUNT"
  | "VIEW_PURCHASE_PRICE"
  | "ACCESS_POS"
  | "REQUEST_TRANSFER"
  | "MANAGE_TRANSFERS"

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
  permissions: UserPermission[]
  phone?: string | null
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
  permissions?: UserPermission[]
  phone?: string
  isActive?: boolean
}

export interface UpdateUserPayload {
  name?: string
  username?: string
  password?: string
  role?: Role
  permissions?: UserPermission[]
  phone?: string | null
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

export interface WarehouseStock {
  id: string
  warehouseId: string
  warehouse: { id: string; name: string; code: string; isActive: boolean }
  quantityPieces: number
  storageLocation?: string | null
  minStock?: number | null
}

export interface Product {
  id: string
  itemNumber: string
  name: string
  qrCode?: string
  cartonQrCode?: string | null
  imageUrl?: string | null
  category?: string | null
  categoryTags?: string[]
  typeTags?: string[]
  isNewArrival?: boolean
  isOffer?: boolean
  oldPrice?: number | null
  openingBalancePcs: number
  cartonsAvailable: number
  pcsPerCarton: number
  purchasePrice: number
  salePrice: number
  retailPrice: number
  costPrice?: number
  expiryDate?: string | null
  minStock: number
  storageLocation?: string | null
  branchId?: string | null
  branch?: Branch | null
  currentStock?: number
  shopStock?: number
  warehouseStocks?: WarehouseStock[]
  createdAt?: string
  updatedAt?: string
}

export interface CatalogCategory {
  id: string
  name: string
  types: string[]
  sortOrder: number
}

export interface ProfitReport {
  summary: { totalRevenue: number; totalCost: number; totalProfit: number; avgMargin: number }
  periods: Array<{ period: string; revenue: number; cost: number; profit: number; margin: number }>
  topProducts: Array<{ id: string; name: string; revenue: number; cost: number; profit: number; margin: number; qty: number }>
}

export interface DebtCustomer {
  id: string
  name: string
  phone: string
  currentBalance: number
  debtAgeDays: number
  lastTransactionAt: string | null
}

export interface StocktakeSessionSummary {
  id: string
  status: string
  notes: string | null
  createdAt: string
  closedAt: string | null
  creator: { id: string; name: string }
  branch: { id: string; name: string } | null
  itemCount: number
  publicToken?: string
}

export interface StocktakeSessionDetail extends StocktakeSessionSummary {
  items: Array<{
    id: string
    productId: string
    productName: string
    category: string | null
    systemQty: number | null
    actualQty: number | null
    variance: number | null
    notes: string | null
    approvalStatus: "PENDING" | "APPROVED" | "REJECTED"
    approvedQty: number | null
    hasError?: boolean
  }>
  stats?: { filled: number; total: number }
}

export interface PublicCatalogProduct {
  id: string
  itemNumber: string
  name: string
  imageUrl?: string | null
  category?: string | null
  categoryTags?: string[]
  typeTags?: string[]
  isNewArrival?: boolean
  isOffer?: boolean
  oldPrice?: number | null
  createdAt?: string
  salePrice?: number | null
  pcsPerCarton: number
  currentStock: number
  showStock?: boolean
}

export interface CatalogAccessRequestPayload {
  customerName: string
  phone: string
  address?: string
  notes?: string
}

export interface CatalogAccessStatus {
  approved: boolean
  customer?: Pick<Customer, "id" | "name" | "phone">
  token?: string
  urlPath?: string
  allowPrices?: boolean
}

export interface CatalogSession {
  customer: Pick<Customer, "id" | "name" | "phone">
  allowPrices: boolean
  showStock: boolean
}

export interface CatalogOrderPayload {
  customerName: string
  phone: string
  address?: string
  notes?: string
  items: Array<{
    productId: string
    warehouseId?: string
    unit: "PIECE" | "DOZEN" | "CARTON"
    quantity: number
  }>
}

export interface ProductPayload {
  // Only `name` is required; the server will auto-generate item number / QR codes if omitted.
  name: string
  itemNumber?: string
  qrCode?: string
  cartonQrCode?: string
  imageUrl?: string | null
  category?: string
  categoryTags?: string[]
  typeTags?: string[]
  isNewArrival?: boolean
  isOffer?: boolean
  oldPrice?: number | null
  warehouseDistribution?: { warehouseId: string; pieces: number }[]
  openingBalancePcs?: number
  cartonsAvailable?: number
  pcsPerCarton?: number
  purchasePrice?: number
  salePrice?: number
  retailPrice?: number
  costPrice?: number
  expiryDate?: string | null
  minStock?: number
  storageLocation?: string | null
  branchId?: string   // optional — defaults to main branch on server
}

export interface ProductMovement {
  date: string
  movementType?: "SALE" | "PURCHASE" | "SALES_RETURN" | "TRANSFER" | "LOSS"
  movementLabel?: string
  customerName: string
  warehouseName?: string | null
  quantity: number
  unit?: string
  unitPrice?: number | null
  price?: number
  totalPrice?: number | null
  invoiceNumber: string
  invoiceId?: string | null
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
  tags?: string[]
  openingBalance: number
  currentBalance: number
  creditLimit?: number | null
  isSupplier?: boolean
  isBoth?: boolean
  lastTransactionAt?: string | null
  createdAt?: string
  updatedAt?: string
  deletedAt?: string | null
}

export interface CustomerPayload {
  name: string
  phone: string
  address?: string
  notes?: string
  tags?: string[]
  openingBalance: number
  creditLimit?: number | null
  isSupplier?: boolean
  isBoth?: boolean
}

export interface CustomerBroadcastPayload {
  tags: string[]
  productIds: string[]
  message: string
}

export interface CustomerBroadcastResult {
  total: number
}

export interface CustomerTransaction {
  id: string
  date: string
  createdAt?: string
  type: string
  invoiceType?: "SALE" | "PURCHASE" | "SALES_RETURN" | null
  amount: number
  referenceNumber: string
  debit?: number
  credit?: number
  runningBalance: number
  status?: string
  createdByName?: string | null
  createdBy?: Pick<User, "id" | "name" | "username" | "role"> | null
  lastAction?: string | null
  lastChangedAt?: string | null
  lastChangedByName?: string | null
  lastChangedBy?: Pick<User, "id" | "name" | "username" | "role"> | null
  lastChangeSummary?: unknown
}

export interface CustomerTransactionsResponse {
  customer: {
    id: string
    name: string
    openingBalance: number
  }
  transactions: CustomerTransaction[]
}

export interface CustomerPortalLink {
  token: string
  urlPath: string
  expiresAt?: string | null
  customer: Pick<Customer, "id" | "name" | "phone">
}

export interface CustomerPortalResponse {
  customer: Pick<Customer, "id" | "name" | "phone" | "openingBalance" | "currentBalance" | "lastTransactionAt">
  transactions: CustomerTransaction[]
  expiresAt?: string | null
}

export interface PublicInvoiceDetail {
  id: string
  invoiceNumber: string
  date: string
  type: string
  status: string
  paymentType: string
  totalAmount: number
  paidAmount: number
  remainingAmount: number
  discount: number
  items: Array<{
    id: string
    productName: string
    itemNumber?: string | null
    quantity: number
    unitPrice: number
    totalPrice: number
    unit: string
  }>
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
  type?: InvoiceType
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
  notes?: string | null
}

export interface InvoiceItem {
  id?: string
  invoiceId?: string
  productId: string
  productName?: string
  warehouseId?: string
  warehouseName?: string | null
  unit: "PIECE" | "DOZEN" | "CARTON"
  quantity: number
  unitPrice: number
  totalPrice: number
  notes?: string | null
}

export type LossReason = "DAMAGE" | "EXPIRY" | "THEFT" | "DEFECT" | "OTHER"

export interface StockLossItem {
  id: string
  lossId: string
  productId: string
  productName: string
  unit: "PIECE" | "DOZEN" | "CARTON"
  quantity: number
  product?: { id: string; name: string; pcsPerCarton: number }
}

export interface StockLoss {
  id: string
  lossNumber: string
  date: string
  warehouseId: string
  warehouse: { id: string; name: string }
  reason: LossReason
  notes?: string | null
  cancelledAt?: string | null
  createdAt: string
  creator?: { id: string; name: string; username: string }
  items: StockLossItem[]
}

export interface CreateInvoicePayload {
  customerId: string
  type?: InvoiceType
  date?: string
  clientRequestId?: string
  originalInvoiceId?: string
  couponCode?: string
  discount: number
  tax: number
  paidAmount: number
  paymentType?: "CASH" | "CREDIT" | "PARTIAL"
  notes?: string
  items: Array<{
    productId: string
    warehouseId?: string
    unit: "PIECE" | "DOZEN" | "CARTON"
    quantity: number
    unitPrice?: number
    allowNegativeStock?: boolean
    notes?: string
  }>
}

export interface Coupon {
  id: string
  code: string
  name: string
  discountType: "PERCENT" | "AMOUNT"
  discountValue: number
  startsAt?: string | null
  endsAt?: string | null
  maxUses?: number | null
  isActive: boolean
  usedCount?: number
}

export interface Quotation {
  id: string
  quotationNumber: string
  customerId: string
  customer?: Customer
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "CONVERTED"
  subtotal: number
  discount: number
  totalAmount: number
  expiresAt?: string | null
  notes?: string | null
  items?: InvoiceItem[]
  invoice?: Invoice | null
  createdAt?: string
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
  cancelledAt?: string | null
  createdAt?: string
  updatedAt?: string
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

export interface DailySummaryData {
  date: string
  todaySales: number
  yesterdaySales: number
  salesChangePercent: number | null
  collectionsToday: number
  topProduct: { name: string; quantity: number } | null
  lowStockCount: number
  lowStockNames: string[]
  mostOverdueCustomer: { name: string; daysLate: number } | null
  smartTip: string | null
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
  invoices: Array<{ id?: string; invoiceNumber: string; customerName: string; total: number; paid: number }>
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
  invoiceDesign?: string   // visual invoice designer layout (JSON) — separate from WhatsApp text templates above
  themePreset?: ThemePreset
  backupWhatsappNumber?: string
  shopWarehouseId?: string
  catalogPublicUrl?: string
  catalogAdminWhatsappNumber?: string
  orderPreparationWhatsappNumbers?: string
  adminApprovalWhatsappNumber?: string
  autoSendDailySummary?: boolean
  dailySummaryWhatsappNumber?: string
  dailySummaryHour?: number
  // WhatsApp Cloud API credentials
  whatsappProvider?: "web" | "cloud"
  whatsappCloudToken?: string
  whatsappCloudPhoneNumberId?: string
  // Telegram backup delivery
  telegramBotToken?: string
  telegramChatId?: string
  // Seasonal event alerts (JSON string: SeasonalAlert[])
  seasonalAlerts?: string
  // Retail storefront "designed by" credit (shown in shop footer)
  siteDesignerName?: string
  siteDesignerPhone?: string
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

export interface InvoiceAuditChange {
  field: string
  label: string
  before: string
  after: string
}

export interface InvoiceAuditEntry {
  id: string
  action: string
  actionLabel: string
  createdAt: string
  user?: Pick<User, "id" | "name" | "username" | "role"> | null
  changes: InvoiceAuditChange[]
}

export type CustomerRating = "A" | "B" | "C"

export interface CustomerRatingEntry {
  id: string
  name: string
  phone: string
  currentBalance: number
  totalPurchases: number
  invoiceCount: number
  avgPaymentDays: number
  rating: CustomerRating
  ratingLabel: string
}

export interface DebtAgingRow {
  id: string
  name: string
  phone: string
  current: number
  days30: number
  days60: number
  days90: number
  total: number
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

export interface OrderPreparation {
  id: string
  customerId: string
  invoiceId: string | null
  invoiceNumber: string | null
  totalAmount: number
  customerName: string
  customerPhone: string
  notes: string | null
  items: Array<{
    productId: string
    productName: string
    unit: string
    quantity: number
    unitPrice?: number
    totalPrice?: number
  }>
  createdAt: string
}

export interface CatalogCustomer {
  id: string
  name: string
  phone: string
  hasAccess: boolean
  allowPrices: boolean
  showStock: boolean
  token: string | null
  lastViewedAt: string | null
  createdAt: string | null
  catalogLinkSentAt: string | null
}

// ── Retail catalog (كتلوك المفرد) ──────────────────────────────────────────────
export interface RetailItem {
  id: string
  productId: string
  productName: string
  itemNumber: string
  title?: string | null
  description?: string | null
  price: number
  oldPrice?: number | null
  categories: string[]
  subCategories: string[]
  images: string[]
  sortOrder: number
  featured: boolean
  isBestSeller: boolean
  isNew: boolean
  isOffer: boolean
  lowStockBadge: boolean
  isActive: boolean
  currentStock: number
  createdAt?: string
}

export interface RetailItemPayload {
  productId: string
  title?: string
  description?: string
  price: number
  oldPrice?: number | null
  categories?: string[]
  subCategories?: string[]
  images?: string[]
  sortOrder?: number
  featured?: boolean
  isBestSeller?: boolean
  isNew?: boolean
  isOffer?: boolean
  lowStockBadge?: boolean
  isActive?: boolean
}

export interface RetailCategory {
  id: string
  name: string
  subCategories: string[]
  sortOrder: number
}

export interface RetailCategoryPayload {
  name: string
  subCategories?: string[]
  sortOrder?: number
}

export interface RetailCoupon {
  id: string
  code: string
  name: string
  discountType: "PERCENT" | "AMOUNT"
  discountValue: number
  startsAt?: string | null
  endsAt?: string | null
  maxUses?: number | null
  usedCount: number
  isActive: boolean
  createdAt?: string
}

export interface RetailCouponPayload {
  code: string
  name: string
  discountType: "PERCENT" | "AMOUNT"
  discountValue: number
  startsAt?: string
  endsAt?: string
  maxUses?: number
  isActive?: boolean
}

export interface RetailOrderItem {
  retailItemId: string
  productId: string
  productName: string
  title: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface RetailOrder {
  id: string
  orderNumber: string
  customerName: string
  phone: string
  address?: string | null
  notes?: string | null
  items: RetailOrderItem[]
  subtotal: number
  discount: number
  total: number
  couponCode?: string | null
  status: "PENDING" | "PROCESSING" | "PREPARED" | "CANCELLED" | "FAILED"
  invoiceId?: string | null
  preparedAt?: string | null
  createdAt: string
}

// Public storefront shapes
export interface PublicRetailItem {
  id: string
  title: string
  description?: string | null
  price: number
  oldPrice?: number | null
  categories: string[]
  subCategories: string[]
  images: string[]
  featured: boolean
  isBestSeller: boolean
  isNew: boolean
  isOffer: boolean
  lowStockBadge: boolean
  currentStock: number
}

export interface PublicRetailCategory {
  name: string
  subCategories: string[]
}

export interface RetailCustomerEntry {
  id: string
  phone: string
  name: string
  isSubscriber: boolean
  interests: string[]
  wishNote?: string | null
  ordersCount: number
  lastOrderAt?: string | null
}

export interface RetailMyOrder {
  id: string
  orderNumber: string
  status: "PENDING" | "PROCESSING" | "PREPARED" | "CANCELLED" | "FAILED"
  total: number
  createdAt: string
  preparedAt?: string | null
  items: Array<{ title: string; quantity: number; unitPrice: number }>
}

export interface PublicRetailCoupon {
  code: string
  name: string
  discountType: "PERCENT" | "AMOUNT"
  discountValue: number
  endsAt?: string | null
}

export interface RetailOrderResult {
  id: string
  orderNumber: string
  subtotal: number
  discount: number
  referralDiscount: number
  total: number
  ordersToken?: string | null
}

export interface AiChatProduct {
  id: string
  title: string
  price: number
  oldPrice: number | null
  images: string[]
  currentStock: number
}

export interface AiChatResponse {
  message: string
  products: AiChatProduct[]
}

export interface ReferralInfo {
  code: string
  referrerName: string
  discountPercent: number
}

export interface CustomerReferral {
  referralCode: string
  discountPercent: number
}

export interface PublicRetailOrderStatus {
  id: string
  orderNumber: string
  status: "PENDING" | "PROCESSING" | "PREPARED" | "CANCELLED" | "FAILED"
  total: number
  createdAt: string
  preparedAt?: string | null
}

export interface BranchSummary {
  branch: Branch
  products: number
  customers: number
  customerBalance: number
  sales: { count: number; total: number; paid: number; remaining: number }
  purchases: { count: number; total: number }
  vouchers: { receipts: number; payments: number; expenses: number }
  stock: { lowStock: number; totalPieces?: number; openingPieces: number; cartons: number }
  transfers: { out: number; in: number }
}
