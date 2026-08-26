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
  CatalogStockFilter,
  OrderPreparation,
  CatalogOrderPayload,
  GuestCatalogOrderPayload,
  CatalogAccessRequestPayload,
  CatalogAccessStatus,
  CatalogSession,
  Campaign,
  CampaignDetail,
  CampaignFunnelReport,
  FirstOrderCouponReport,
  CampaignPayload,
  CampaignStatus,
  SystemHealth,
  ErrorLog,
  ErrorLogSource,
  ErrorAnalysis,
  ProspectStatus,
  ProspectListResult,
  InboundMessage,
  InboundMessageStatus,
  WhatsappConversation,
  WhatsappChatMessage,
  WhatsappQuickReply,
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
  ProductReview,
  PersonalDebt,
  CreatePersonalDebtPayload,
  UpdatePersonalDebtPayload,
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
  CollectionsSummary,
  ProfitReport,
  WarehouseComparisonRow,
  CrossSellPair,
  SearchMissRow,
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
  StockCorrectionReason,
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

// «الديون الشخصية» — unrelated to shop customers.
export async function getPersonalDebts() {
  const { data } = await api.get<ApiEnvelope<PersonalDebt[]>>("/personal-debts")
  return data.data ?? []
}

export async function createPersonalDebt(payload: CreatePersonalDebtPayload) {
  const { data } = await api.post<ApiEnvelope<PersonalDebt>>("/personal-debts", payload)
  return data.data
}

export async function updatePersonalDebt(id: string, payload: UpdatePersonalDebtPayload) {
  const { data } = await api.put<ApiEnvelope<PersonalDebt>>(`/personal-debts/${id}`, payload)
  return data.data
}

export async function markPersonalDebtPaid(id: string) {
  const { data } = await api.put<ApiEnvelope<PersonalDebt>>(`/personal-debts/${id}/paid`, {})
  return data.data
}

export async function deletePersonalDebt(id: string) {
  const { data } = await api.delete<ApiEnvelope<never>>(`/personal-debts/${id}`)
  return data
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

/* ── Storefront login ─────────────────────────────────────────────── */

export type CustomerLoginResult =
  | { kind: "CUSTOMER"; token: string; customer: { id: string; name: string; phone: string } }
  | {
      kind: "VISITOR"
      phone: string
      token: string
      detailsSubmitted: boolean
      pricesUnlocked: boolean
      priceRequestPending: boolean
    }

export interface VisitorSession {
  phone: string
  name: string | null
  address: string | null
  notes: string | null
  province: string | null
  businessType: string | null
  detailsSubmitted: boolean
  pricesUnlocked: boolean
  priceRequestPending: boolean
  customerId: string | null
}

export async function customerLogin(phone: string, code: string) {
  const { data } = await api.post<ApiEnvelope<CustomerLoginResult>>(
    "/public/catalog/login", { phone, code },
  )
  return data.data!
}

/** Identified by the browsing session, never by a phone the caller supplies. */
export async function submitStorefrontSignupDetails(payload: {
  token: string; customerName: string; address?: string; notes?: string
  province?: string; businessType?: string
}) {
  const { data } = await api.post<ApiEnvelope<{ ok: boolean }>>(
    "/public/catalog/signup-details", payload,
  )
  return data
}

export async function getVisitorSession(token: string) {
  const { data } = await api.get<ApiEnvelope<VisitorSession>>(
    "/public/catalog/visitor-session", { params: { token } },
  )
  return data.data!
}

export async function getVisitorCatalogProducts(token: string) {
  const { data } = await api.get<ApiEnvelope<PublicCatalogProduct[]>>(
    "/public/catalog/visitor-products", { params: { token } },
  )
  return data.data ?? []
}

export async function requestCatalogPrices(token: string) {
  const { data } = await api.post<ApiEnvelope<{ alreadyUnlocked: boolean; pending: boolean }>>(
    "/public/catalog/request-prices", { token },
  )
  return data.data!
}

/* ── «احجز البضاعة القادمة الجديدة» ───────────────────────────────── */

export interface IncomingItem {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  expectedAt: string | null
  price: number | null
  active?: boolean
  sortOrder?: number
  reservationCount?: number
}

export async function getPublicIncomingItems(phone = "") {
  const { data } = await api.get<ApiEnvelope<{ items: IncomingItem[]; mine: Record<string, number> }>>(
    "/public/catalog/incoming", { params: phone ? { phone } : {} },
  )
  return data.data ?? { items: [], mine: {} }
}

export async function reserveIncomingItem(payload: {
  itemId: string; phone: string; name?: string; quantity?: number; note?: string
}) {
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; quantity: number }>>(
    "/public/catalog/incoming/reserve", payload,
  )
  return data.data!
}

export async function listIncomingItems() {
  const { data } = await api.get<ApiEnvelope<IncomingItem[]>>("/catalog-management/incoming")
  return data.data ?? []
}

export async function saveIncomingItem(payload: Partial<IncomingItem> & { name: string }, id?: string) {
  const { data } = id
    ? await api.put<ApiEnvelope<IncomingItem>>(`/catalog-management/incoming/${id}`, payload)
    : await api.post<ApiEnvelope<IncomingItem>>("/catalog-management/incoming", payload)
  return data.data!
}

export async function deleteIncomingItem(id: string) {
  await api.delete(`/catalog-management/incoming/${id}`)
}

export interface IncomingReservation {
  id: string
  phone: string
  name: string | null
  quantity: number
  note: string | null
  status: string
  createdAt: string
}

export async function listIncomingReservations(itemId: string) {
  const { data } = await api.get<ApiEnvelope<IncomingReservation[]>>(
    `/catalog-management/incoming/${itemId}/reservations`,
  )
  return data.data ?? []
}

export async function setIncomingReservationStatus(id: string, status: "PENDING" | "CONFIRMED" | "CANCELLED") {
  await api.patch(`/catalog-management/incoming/reservations/${id}`, { status })
}

/* ── Storefront accounts, admin side ──────────────────────────────── */

export interface StorefrontAccountRow {
  kind: "CUSTOMER" | "VISITOR"
  phone: string
  name: string
  address: string | null
  province: string | null
  lastLoginAt: string | null
  detailsSubmitted: boolean
  pricesUnlocked: boolean
  priceRequestPending: boolean
  customerId: string | null
  hasCode: boolean
  locked: boolean
}

export async function listStorefrontAccountsUnified(search?: string) {
  const { data } = await api.get<ApiEnvelope<StorefrontAccountRow[]>>(
    "/catalog-management/accounts/unified", { params: search ? { search } : {} },
  )
  return data.data ?? []
}

export async function grantCatalogPrices(phone: string) {
  const { data } = await api.post<ApiEnvelope<{ phone: string }>>(
    "/catalog-management/accounts/grant-prices", { phone },
  )
  return data.data!
}

export async function revokeCatalogPrices(phone: string) {
  const { data } = await api.post<ApiEnvelope<{ phone: string }>>(
    "/catalog-management/accounts/revoke-prices", { phone },
  )
  return data.data!
}

/**
 * «أظهر الرمز» — get the credentials in hand instead of sending them.
 *
 * Mints a NEW code (the stored one is a hash nobody can read back) and returns
 * it once, with the message and a wa.me link so the admin can send it from
 * their own WhatsApp rather than the shop number.
 */
export async function revealStorefrontCredentials(
  target: { kind: "CUSTOMER" | "VISITOR"; id?: string; phone?: string },
) {
  const { data } = await api.post<ApiEnvelope<{
    phone: string; name: string; username: string; code: string
    message: string; waLink: string; link: string
  }>>("/catalog-management/accounts/reveal", target)
  return data.data!
}

/** «احفظ كزبون بالمحل» — the only thing that puts a visitor on the books. */
export async function promoteVisitorToCustomer(phone: string) {
  const { data } = await api.post<ApiEnvelope<{ customerId: string; customerName: string; created: boolean }>>(
    "/catalog-management/accounts/promote", { phone },
  )
  return data.data!
}

export interface CustomerAccountTx {
  id: string
  type: string
  invoiceType?: string | null
  date: string
  description: string
  referenceNumber?: string | null
  debit: number
  credit: number
  runningBalance: number
  status?: string | null
}

export interface CustomerAccount {
  customer: {
    id: string; name: string; phone: string; address: string | null
    openingBalance: number; currentBalance: number
    lastTransactionAt: string | null; loyaltyPoints: number
  }
  transactions: CustomerAccountTx[]
  storeName: string
  storePhone: string | null
  currency: string
}

export async function getCustomerAccount(access: string) {
  const { data } = await api.get<ApiEnvelope<CustomerAccount>>(
    "/public/catalog/account", { params: { access } },
  )
  return data.data!
}

/* ── Marketing opt-out («توقف») ───────────────────────────────────── */

export interface MarketingOptOut {
  phone: string
  name: string | null
  reason: string | null
  source: string
  createdAt: string
}

export async function listMarketingOptOuts(search?: string) {
  const { data } = await api.get<ApiEnvelope<MarketingOptOut[]>>(
    "/catalog-management/opt-outs", { params: search ? { search } : {} },
  )
  return data.data ?? []
}

export async function addMarketingOptOut(phone: string, reason?: string) {
  await api.post("/catalog-management/opt-outs", { phone, reason })
}

export async function resumeMarketingFor(phone: string) {
  await api.post("/catalog-management/opt-outs/resume", { phone })
}

/* ── Storefront accounts (admin) ──────────────────────────────────── */

export interface StorefrontCustomerAccount {
  kind: "CUSTOMER"
  id: string
  name: string
  phone: string
  hasCode: boolean
  codeSetAt: string | null
  lastLoginAt: string | null
  locked: boolean
  pricesHidden: boolean
}

export interface StorefrontVisitorAccount {
  kind: "VISITOR"
  phone: string
  hasCode: boolean
  codeSetAt: string | null
  lastLoginAt: string | null
  locked: boolean
  detailsSubmitted: boolean
}

export async function listStorefrontAccounts(search?: string) {
  const { data } = await api.get<ApiEnvelope<{
    customers: StorefrontCustomerAccount[]
    visitors: StorefrontVisitorAccount[]
  }>>("/catalog-management/accounts", { params: search ? { search } : {} })
  return data.data ?? { customers: [], visitors: [] }
}

export async function sendStorefrontCredentials(
  target: { kind: "CUSTOMER" | "VISITOR"; id?: string; phone?: string },
) {
  const { data } = await api.post<ApiEnvelope<{ phone: string; sent: boolean }>>(
    "/catalog-management/accounts/send-credentials", target,
  )
  return data
}

export async function sendStorefrontCredentialsBulk(
  targets: Array<{ kind: "CUSTOMER" | "VISITOR"; id?: string; phone?: string }>,
) {
  const { data } = await api.post<ApiEnvelope<{
    total: number; sent: number; failed: number
    results: Array<{ phone: string; ok: boolean; error?: string }>
  }>>("/catalog-management/accounts/send-credentials-bulk", { targets })
  return data.data!
}

/** True recipient counts — the accounts list is paged, these are not. */
export async function getCredentialTargetCounts() {
  const { data } = await api.get<ApiEnvelope<{ customers: number; visitors: number }>>(
    "/catalog-management/accounts/target-counts",
  )
  return data.data ?? { customers: 0, visitors: 0 }
}

/** Sends to every recipient in the group, resolved server-side. */
export async function sendStorefrontCredentialsToAll(group: "customers" | "visitors" | "all") {
  const { data } = await api.post<ApiEnvelope<{
    total: number; sent: number; failed: number
    results: Array<{ phone: string; ok: boolean; error?: string }>
  }>>("/catalog-management/accounts/send-credentials-all", { group })
  return data.data!
}

/**
 * «دعوة الحساب» — the cold invite. Credentials cannot be pushed to a number
 * that has not messaged us (Meta approves no template carrying a code), so
 * this asks the shopper to reply; their reply is what earns the credentials.
 */
export async function sendStorefrontInvitesToAll(group: "customers" | "visitors" | "all") {
  const { data } = await api.post<ApiEnvelope<{
    queued: number; remaining: number; total: number
  }>>("/catalog-management/accounts/send-invites-all", { group })
  return data.data!
}

/** Push the shop-wide price default onto every live catalog link. */
export async function applyPricesDefaultToAll() {
  const { data } = await api.post<ApiEnvelope<{ ok: boolean; visible: boolean }>>(
    "/catalog-management/accounts/apply-prices-default",
  )
  return data.data!
}

export async function setCustomerPricesHidden(customerId: string, hidden: boolean) {
  await api.patch(`/catalog-management/accounts/${customerId}/prices-hidden`, { hidden })
}

export async function unlockStorefrontAccount(kind: "CUSTOMER" | "VISITOR", idOrPhone: string) {
  await api.post("/catalog-management/accounts/unlock", { kind, idOrPhone })
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

/* ── Guest catalog (no phone/OTP — only served when the merchant has
   turned off catalogRequireOtp) ────────────────────────────────────── */
export async function getGuestCatalogProducts() {
  const { data } = await api.get<ApiEnvelope<PublicCatalogProduct[]>>("/public/catalog/guest-products")
  return data.data ?? []
}

// Phone gate: record a guest's phone before they browse (guest mode only).
export async function guestCatalogEnter(phone: string) {
  const { data } = await api.post<ApiEnvelope<{ ok: boolean }>>("/public/catalog/guest-enter", { phone })
  return data.data
}

// Fire-and-forget: record that a shopper opened a product card (analytics).
// Deduped per device per day so repeat opens of the same product by the same
// visitor count once — the counter reflects unique daily interest, not clicks.
export async function trackCatalogProductView(productId: string, phone?: string) {
  if (!productId) return
  try {
    const key = `catalog_viewed_${new Date().toISOString().slice(0, 10)}`
    const seen: string[] = JSON.parse(localStorage.getItem(key) || "[]")
    if (seen.includes(productId)) return
    seen.push(productId)
    localStorage.setItem(key, JSON.stringify(seen))
  } catch { /* localStorage unavailable — fall through and still count */ }
  try { await api.post("/public/catalog/track-view", { productId, phone }) } catch { /* best-effort */ }
}

// Fire-and-forget: accumulate seconds of active browsing time for this visitor.
export async function postVisitorHeartbeat(phone: string, seconds: number) {
  if (!phone || seconds <= 0) return
  try { await api.post("/public/catalog/visitor-heartbeat", { phone, seconds }) } catch { /* best-effort */ }
}

export async function getGuestCatalogProductImage(id: string, visitor = "") {
  const { data } = await api.get<ApiEnvelope<{ imageUrl: string | null }>>(
    "/public/catalog/guest-product-image",
    { params: { id, ...(visitor ? { visitor } : {}) } },
  )
  return data.data?.imageUrl ?? null
}

export async function submitGuestCatalogOrder(payload: GuestCatalogOrderPayload & { visitorToken?: string }) {
  const { data } = await api.post<ApiEnvelope<{ approvalId: string }>>("/public/catalog/guest-orders", payload)
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

/* ── WhatsApp chat (Meta Cloud API messenger screen) ─────────────────── */
export async function getWhatsappConversations(search?: string, includeArchived?: boolean) {
  const { data } = await api.get<ApiEnvelope<WhatsappConversation[]>>("/whatsapp-chat/conversations", { params: { search, includeArchived } })
  return data.data ?? []
}

export async function getWhatsappUnreadCount() {
  const { data } = await api.get<ApiEnvelope<{ count: number }>>("/whatsapp-chat/unread-count")
  return data.data?.count ?? 0
}

export async function getWhatsappMessages(phone: string, params?: { before?: string; limit?: number }) {
  const { data } = await api.get<ApiEnvelope<{ conversation: WhatsappConversation | null; messages: WhatsappChatMessage[]; hasMore: boolean; lastInboundAt?: string | null }>>(
    `/whatsapp-chat/conversations/${encodeURIComponent(phone)}/messages`,
    { params }
  )
  return data.data ?? { conversation: null, messages: [], hasMore: false, lastInboundAt: null }
}

export async function sendWhatsappChatMessage(phone: string, text: string, replyToWaMessageId?: string) {
  const { data } = await api.post<ApiEnvelope<WhatsappChatMessage>>(`/whatsapp-chat/conversations/${encodeURIComponent(phone)}/messages`, { text, replyToWaMessageId })
  return data.data
}

export async function sendWhatsappChatMedia(phone: string, payload: { dataUrl: string; filename?: string; caption?: string }) {
  const { data } = await api.post<ApiEnvelope<WhatsappChatMessage>>(`/whatsapp-chat/conversations/${encodeURIComponent(phone)}/media`, payload)
  return data.data
}

export async function sendWhatsappChatReaction(phone: string, waMessageId: string, emoji: string) {
  const { data } = await api.post<ApiEnvelope<WhatsappChatMessage>>(`/whatsapp-chat/conversations/${encodeURIComponent(phone)}/reaction`, { waMessageId, emoji })
  return data.data
}

export async function markWhatsappConversationRead(phone: string) {
  const { data } = await api.post<ApiEnvelope<WhatsappConversation>>(`/whatsapp-chat/conversations/${encodeURIComponent(phone)}/read`, {})
  return data.data
}

export async function archiveWhatsappConversation(phone: string, isArchived: boolean) {
  const { data } = await api.post<ApiEnvelope<WhatsappConversation>>(`/whatsapp-chat/conversations/${encodeURIComponent(phone)}/archive`, { isArchived })
  return data.data
}

export async function pinWhatsappConversation(phone: string, isPinned: boolean) {
  const { data } = await api.post<ApiEnvelope<WhatsappConversation>>(`/whatsapp-chat/conversations/${encodeURIComponent(phone)}/pin`, { isPinned })
  return data.data
}

export async function updateWhatsappConversationNotes(phone: string, notes: string) {
  const { data } = await api.put<ApiEnvelope<WhatsappConversation>>(`/whatsapp-chat/conversations/${encodeURIComponent(phone)}/notes`, { notes })
  return data.data
}

// Generate + send the customer's account statement as a WhatsApp PDF document.
// `date` (YYYY-MM-DD) caps movements up to that day; omit for full history.
export async function sendCustomerStatementPdfWhatsapp(customerId: string, date?: string, channel?: WhatsAppSendChannel) {
  const { data } = await api.post<ApiEnvelope<never>>(`/customers/${customerId}/statement-pdf-whatsapp`, { date, channel })
  return data
}

export async function getWhatsappQuickReplies() {
  const { data } = await api.get<ApiEnvelope<WhatsappQuickReply[]>>("/whatsapp-chat/quick-replies")
  return data.data ?? []
}

export async function createWhatsappQuickReply(name: string, body: string) {
  const { data } = await api.post<ApiEnvelope<WhatsappQuickReply>>("/whatsapp-chat/quick-replies", { name, body })
  return data.data
}

export async function deleteWhatsappQuickReply(id: string) {
  await api.delete(`/whatsapp-chat/quick-replies/${id}`)
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

// بند ٦ — جدول القمع لكل صيغة رسالة.
export async function getCampaignFunnelReport(params?: { from?: string; to?: string; tag?: string }) {
  const { data } = await api.get<ApiEnvelope<CampaignFunnelReport>>("/campaigns/funnel-report", { params })
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

export async function getPublicCatalogProductImage(access: string, id: string) {
  const { data } = await api.get<ApiEnvelope<{ imageUrl: string | null }>>("/public/catalog/product-image", { params: { access, id } })
  return data.data?.imageUrl ?? null
}

/* ── Catalog product page ─────────────────────────────────────────── */

export interface CatalogProductSpec { label: string; value: string }

export interface CatalogProductReviewItem {
  id: string
  rating: number
  comment: string | null
  createdAt: string
  authorName: string
}

export interface CatalogProductDetail {
  id: string
  itemNumber: string
  name: string
  thumbnailUrl: string | null
  category: string | null
  isNewArrival: boolean
  isOffer: boolean
  oldPrice: number | null
  offerEndsAt: string | null
  salePrice: number | null
  pcsPerCarton: number
  boxPieces: number | null
  hiddenUnits: Array<"DOZEN" | "BOX" | "CARTON">
  currentStock: number
  showStock: boolean
  description: string
  specs: CatalogProductSpec[]
  gallery: Array<{ id: string; thumbnailUrl: string | null }>
  reviews: { average: number | null; count: number; items: CatalogProductReviewItem[] }
  related: Array<{
    id: string; name: string; itemNumber: string; thumbnailUrl: string | null
    salePrice: number | null; pcsPerCarton: number; currentStock: number
  }>
}

export interface MyCatalogReview {
  id: string
  rating: number
  comment: string | null
  status: "PENDING" | "APPROVED" | "REJECTED"
  createdAt: string
}

/** `access` is "" for guest browsing — the backend refuses if guests are off. */
export async function getCatalogProductDetail(productId: string, access: string, visitor = "") {
  const { data } = await api.get<ApiEnvelope<CatalogProductDetail>>(
    `/public/catalog/product/${productId}`,
    { params: { ...(access ? { access } : {}), ...(visitor ? { visitor } : {}) } },
  )
  return data.data!
}

/**
 * Thumbnails for the products currently on screen.
 *
 * The grid ships without them on purpose: a few hundred base64 thumbnails is
 * several megabytes on the first open. `access` is "" for guest browsing.
 */
/**
 * A signed-in visitor carries their own token: without it the request falls
 * into the guest branch, which the backend refuses whenever the shop requires
 * a login — and every card silently loses its picture.
 */
export async function getCatalogThumbnails(ids: string[], access: string, visitor = "") {
  if (ids.length === 0) return {}
  const { data } = await api.post<ApiEnvelope<Record<string, string | null>>>(
    "/public/catalog/thumbnails", { ids },
    { params: { ...(access ? { access } : {}), ...(visitor ? { visitor } : {}) } },
  )
  return data.data ?? {}
}

export async function getCatalogGalleryImage(productId: string, imageId: string, access: string, visitor = "") {
  const { data } = await api.get<ApiEnvelope<{ imageUrl: string | null }>>(
    `/public/catalog/product/${productId}/image/${imageId}`,
    { params: { ...(access ? { access } : {}), ...(visitor ? { visitor } : {}) } },
  )
  return data.data?.imageUrl ?? null
}

export async function getMyCatalogReview(productId: string, access: string) {
  if (!access) return null
  const { data } = await api.get<ApiEnvelope<MyCatalogReview | null>>(
    `/public/catalog/product/${productId}/my-review`,
    { params: { access } },
  )
  return data.data ?? null
}

export async function submitCatalogProductReview(
  productId: string, access: string, payload: { rating: number; comment?: string },
) {
  const { data } = await api.post<ApiEnvelope<{ id: string; status: string }>>(
    `/public/catalog/product/${productId}/review`, payload, { params: { access } },
  )
  return data
}

/* ── Catalog product content + review moderation (admin) ──────────── */

export interface AdminProductContent {
  id: string
  name: string
  itemNumber: string
  thumbnailUrl: string | null
  description: string
  specs: CatalogProductSpec[]
  gallery: Array<{ id: string; thumbnailUrl: string | null; sortOrder: number }>
  isOffer: boolean
  offerEndsAt: string | null
}

export interface AdminCatalogReview {
  id: string
  rating: number
  comment: string | null
  status: "PENDING" | "APPROVED" | "REJECTED"
  createdAt: string
  reviewedAt: string | null
  product: { id: string; name: string; itemNumber: string; thumbnailUrl: string | null }
  customer: { id: string; name: string; phone: string }
}

export async function getProductCatalogContent(productId: string) {
  const { data } = await api.get<ApiEnvelope<AdminProductContent>>(
    `/catalog-management/products/${productId}/content`,
  )
  return data.data!
}

export async function updateProductCatalogContent(
  productId: string,
  payload: { description?: string; specs?: CatalogProductSpec[]; offerEndsAt?: string },
) {
  const { data } = await api.put<ApiEnvelope<AdminProductContent>>(
    `/catalog-management/products/${productId}/content`, payload,
  )
  return data.data!
}

export async function addProductCatalogImage(
  productId: string, payload: { url: string; thumbnailUrl?: string },
) {
  const { data } = await api.post<ApiEnvelope<{ id: string }>>(
    `/catalog-management/products/${productId}/images`, payload,
  )
  return data.data!
}

export async function deleteProductCatalogImage(productId: string, imageId: string) {
  await api.delete(`/catalog-management/products/${productId}/images/${imageId}`)
}

export async function listCatalogReviews(status?: "PENDING" | "APPROVED" | "REJECTED") {
  const { data } = await api.get<ApiEnvelope<AdminCatalogReview[]>>(
    "/catalog-management/reviews", { params: status ? { status } : {} },
  )
  return data.data ?? []
}

export async function setCatalogReviewStatus(id: string, status: "APPROVED" | "REJECTED") {
  await api.patch(`/catalog-management/reviews/${id}`, { status })
}

export async function deleteCatalogReview(id: string) {
  await api.delete(`/catalog-management/reviews/${id}`)
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

export async function getDeletedProducts() {
  const { data } = await api.get<ApiEnvelope<Product[]>>("/products/deleted")
  return data.data
}

export interface ManualStockAdjustment {
  id: string
  type: "IN" | "OUT" | "DAMAGE"
  quantity: number
  balanceBefore: number
  balanceAfter: number
  warehouseName: string | null
  userName: string | null
  note: string | null
  createdAt: string
}

export async function adjustProductStock(
  id: string,
  payload: { warehouses: Array<{ warehouseId: string; quantityPieces: number }>; note?: string; reason: StockCorrectionReason },
) {
  const { data } = await api.post<ApiEnvelope<Product>>(`/products/${id}/adjust-stock`, payload)
  return data.data
}

export async function getManualStockAdjustments(id: string) {
  const { data } = await api.get<ApiEnvelope<ManualStockAdjustment[]>>(`/products/${id}/manual-adjustments`)
  return data.data ?? []
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

export async function restoreProduct(id: string) {
  const { data } = await api.post<ApiEnvelope<Product>>(`/products/${id}/restore`)
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

// DLabel is the label printer bridge exposed by the DESKTOP app's bundled
// sidecar on localhost:5050. From the HTTPS-hosted web build this is blocked
// mixed content, so the fetch throws a raw network error and window.open opens
// a dead tab — the feature can never work there. Detect the desktop runtime and
// fail with an actionable message instead.
function assertDesktopRuntime() {
  const isTauri =
    typeof window !== "undefined" &&
    ("__TAURI__" in window || "__TAURI_INTERNALS__" in window)
  if (!isTauri) {
    throw new Error("طباعة الملصقات عبر DLabel متاحة في تطبيق سطح المكتب فقط")
  }
}

export function isDLabelAvailable() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI__" in window || "__TAURI_INTERNALS__" in window)
  )
}

export async function openPieceLabelInDLabel(payload: {
  name: string
  itemNumber: string
  qrCode: string
  pcsPerCarton: number
}) {
  assertDesktopRuntime()
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
  assertDesktopRuntime()
  const params = new URLSearchParams({
    name: payload.name,
    itemNumber: payload.itemNumber,
    qrCode: payload.qrCode,
    pcsPerCarton: String(payload.pcsPerCarton),
  })
  const url = `http://localhost:5050/api/products/label/piece/dlabel-open-link?${params.toString()}`
  window.open(url, "_blank", "noopener,noreferrer,width=520,height=360")
}

/**
 * Fetch a paginated list COMPLETELY, instead of guessing a big enough `limit`.
 *
 * Guessed limits are why "المواد تختفي" / "الزبائن تختفي": the cashier screen
 * asked for 300 products and the shared customer list for 500, so everything
 * past those cut-offs simply did not exist as far as the UI was concerned —
 * silently, with no error and no indication that the list was truncated.
 *
 * This pages until the server says there is nothing left. `pagination.total`
 * tells us when to stop; a response without pagination is treated as complete.
 * The page size is generous so the common case is still a single request.
 */
async function fetchAllPages<T>(
  path: string,
  params: Record<string, unknown> = {},
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = []
  let page = 1
  // Hard ceiling so a malformed pagination block can never spin forever.
  const MAX_PAGES = 50
  while (page <= MAX_PAGES) {
    const { data } = await api.get<PagedResponse<T>>(path, {
      params: { ...params, page, limit: pageSize },
    })
    const rows = data.data ?? []
    all.push(...rows)
    const total = data.pagination?.total
    if (total === undefined || all.length >= total || rows.length === 0) break
    page += 1
  }
  return all
}

export async function getCustomers(params?: { search?: string; isSupplier?: boolean; limit?: number; includeDeleted?: boolean; page?: number; tags?: string[] }) {
  // An explicit limit/page means the caller wants ONE specific page — honour it.
  // Otherwise return the complete list: the old hardcoded 500 silently hid
  // every customer past the first 500 from pickers and dropdowns.
  if (params?.limit !== undefined || params?.page !== undefined) {
    const { data } = await api.get<PagedResponse<Customer>>("/customers", { params })
    return data.data ?? []
  }
  return fetchAllPages<Customer>("/customers", { ...params })
}

// ── One-off opening-balance migration (temporary «نقل الأرصدة» page) ──
export interface BalanceMigrationEntry {
  tempId: string
  action: "create" | "link"
  name: string
  phone?: string | null
  amount: number
  customerId?: string | null
  notes?: string | null
  oldCode?: string | null
}

export interface BalanceMigrationResult {
  created: number
  linked: number
  failed: number
  totalApplied: number
  results: Array<{ tempId: string; status: "created" | "linked" | "failed"; customerId?: string; error?: string }>
}

export async function applyOpeningBalances(entries: BalanceMigrationEntry[]) {
  const { data } = await api.post<ApiEnvelope<BalanceMigrationResult>>("/balance-migration/apply", { entries })
  return data.data!
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

// One page of the "حفظ الكشف العام" bulk export — every customer by default
// (filterable to only-with-balance / inactive-for-N-days), each with their
// full merged statement + invoice line items, optionally date-bounded.
export async function getCustomerStatementsExport(params: {
  page: number
  limit: number
  customerFilter?: "all" | "withBalance" | "inactive"
  inactiveDays?: number
  from?: string
  to?: string
  all?: boolean
}) {
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

export interface CustomerProductHistory {
  timesSold: number
  totalQuantityPieces: number
  last: LastSoldPrice | null
}

// Purchase-history summary for one customer + product — "sold N times to this
// customer, last at price X" (or "never bought before") — used by the
// sales-return screen the moment a product is added to a return line.
export async function getCustomerProductHistory(customerId: string, productId: string) {
  const { data } = await api.get<ApiEnvelope<CustomerProductHistory>>(
    "/invoices/customer-product-history",
    { params: { customerId, productId } },
  )
  return data.data
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
  const { data } = await api.delete<ApiEnvelope<Invoice>>(`/invoices/${id}/permanent`, {
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

export async function getCollectionsSummary(date?: string) {
  const { data } = await api.get<ApiEnvelope<CollectionsSummary>>("/reports/collections-summary", { params: date ? { date } : {} })
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

// Send the (customer-safe) invoice PDF to selected preparation workers.
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

export interface WabaSubscribedApp {
  whatsapp_business_api_data?: { id?: string; name?: string; link?: string }
}

export async function getWabaSubscribedApps(wabaId?: string) {
  const { data } = await api.get<ApiEnvelope<{ wabaId: string; apps: WabaSubscribedApp[] }>>("/whatsapp/waba-subscribed-apps", { params: { wabaId } })
  return data.data
}

export async function subscribeAppToWaba(wabaId?: string) {
  const { data } = await api.post<ApiEnvelope<{ wabaId: string; apps: WabaSubscribedApp[] }>>("/whatsapp/waba-subscribed-apps", { wabaId })
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
  customerId: string | null; customerName: string | null; totalTimeSeconds: number
  /** بند ١٠ — عدد مشاهدات المنتجات، تستخدم لترتيب أولوية الاتصال. */
  viewCount: number
  /** بند ١٠ — طلب رمز دخول بس لسه ما صار زبون (قريب من التسجيل). */
  accessCodeSetAt?: string | null
}

export type CatalogVisitorProductView = {
  id: string; productId: string; productName: string; viewedAt: string
}

export async function getCatalogVisitors() {
  const { data } = await api.get<ApiEnvelope<{ visitors: CatalogVisitor[]; uniquePhones: number; totalVisits: number }>>("/catalog-management/visitors")
  return data.data ?? { visitors: [], uniquePhones: 0, totalVisits: 0 }
}

export async function getVisitorProductViews(phone: string) {
  const { data } = await api.get<ApiEnvelope<CatalogVisitorProductView[]>>(`/catalog-management/visitors/${encodeURIComponent(phone)}/views`)
  return data.data ?? []
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

// ── Catalog Design Settings ───────────────────────────────────────────────────
/** Storefront footer. Every string is "" until an admin fills it in, and an
 *  empty value hides its row in the catalog rather than showing a blank one. */
export interface CatalogFooter {
  enabled: boolean
  about: string
  phone: string
  whatsapp: string
  address: string
  hours: string
  instagram: string
  facebook: string
  telegram: string
  tiktok: string
  deliveryAreas: string
  deliveryTime: string
  minOrder: string
  cashOnDelivery: boolean
}

export const EMPTY_CATALOG_FOOTER: CatalogFooter = {
  enabled: true, about: "", phone: "", whatsapp: "", address: "", hours: "",
  instagram: "", facebook: "", telegram: "", tiktok: "",
  deliveryAreas: "", deliveryTime: "", minOrder: "", cashOnDelivery: true,
}

export interface CatalogTrustBadge { enabled: boolean; text: string }

/** Trust strip above the grid + the shop's own low-stock threshold (cartons). */
export interface CatalogTrust {
  badges: CatalogTrustBadge[]
  lowStockCartons: number
}

export const EMPTY_CATALOG_TRUST: CatalogTrust = {
  badges: [
    { enabled: false, text: "" },
    { enabled: false, text: "" },
    { enabled: false, text: "" },
  ],
  lowStockCartons: 0,
}

export interface CatalogDesign {
  primaryColor: string | null
  bgColor: string | null
  defaultTheme: "clean" | "warm" | "dark" | "vibrant"
  logoUrl: string | null
  welcomeMessage: string | null
  bannerEnabled: boolean
  bannerImages: Array<{ url: string; title: string; order: number }>
  footer: CatalogFooter
  trust: CatalogTrust
}

export async function getCatalogDesign() {
  const { data } = await api.get<ApiEnvelope<CatalogDesign>>("/catalog-management/design")
  return data.data!
}

export async function updateCatalogDesign(payload: Partial<CatalogDesign>) {
  const { data } = await api.put<ApiEnvelope<never>>("/catalog-management/design", payload)
  return data
}

// ── Promo Codes ───────────────────────────────────────────────────────────────
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

// بند ٧ — تقرير كوبون أول طلب.
export async function getFirstOrderCouponReport() {
  const { data } = await api.get<ApiEnvelope<FirstOrderCouponReport>>("/catalog-management/promo-codes/first-order-report")
  return data.data
}

export async function validatePublicPromoCode(code: string, customerId: string) {
  const { data } = await api.post<ApiEnvelope<{ code: string; type: string; value: number | null; description: string | null }>>(
    "/public/catalog/validate-promo", { code, customerId }
  )
  return data.data!
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

// Cancel a pending preparation (rejected / not prepared)
// «زبون جديد — نسويله حساب؟» (Telegram bot orders with an unregistered phone)
export async function createPreparationCustomer(id: string) {
  const { data } = await api.post<ApiEnvelope<{ customerId: string; name: string; created: boolean }>>(
    `/order-preparations/${id}/create-customer`,
    {},
  )
  return data
}

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

export async function getSearchMisses() {
  const { data } = await api.get<ApiEnvelope<SearchMissRow[]>>("/reports/search-misses")
  return data.data ?? []
}

export async function getProductReviews(params: { page: number; limit: number }) {
  const { data } = await api.get<PagedResponse<ProductReview>>("/product-reviews", { params })
  return { data: data.data ?? [], pagination: data.pagination ?? { total: 0, page: 1, limit: params.limit, pages: 1 } }
}

export async function getStoreBrainReport(params?: { from?: string; to?: string }) {
  const { data } = await api.get<ApiEnvelope<StoreBrainReport>>("/reports/store-brain", { params })
  return data.data!
}

// ── «المساعد الذكي اليومي» (Daily Smart Assistant) ────────────────────────────
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

export async function closeStocktakeSession(id: string, force?: boolean) {
  const { data } = await api.post<ApiEnvelope<StocktakeSessionDetail>>(`/stocktake/${id}/close`, force ? { force: true } : undefined)
  return data.data!
}

export async function archiveStocktakeSession(id: string) {
  const { data } = await api.post<ApiEnvelope<{ success: boolean }>>(`/stocktake/${id}/archive`)
  return data.data
}

export async function approveStocktakeItem(sessionId: string, itemId: string, reason: StockCorrectionReason) {
  const { data } = await api.post<ApiEnvelope<{ success: boolean; delta: number; newQty: number }>>(`/stocktake/${sessionId}/items/${itemId}/approve`, { reason })
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

export async function closeCycleCountSession(id: string, force?: boolean) {
  const { data } = await api.post<ApiEnvelope<CycleCountSessionDetail>>(`/cycle-count/${id}/close`, force ? { force: true } : undefined)
  return data.data!
}

export async function cancelCycleCountSession(id: string) {
  const { data } = await api.post<ApiEnvelope<{ success: boolean }>>(`/cycle-count/${id}/cancel`)
  return data.data!
}

export async function approveCycleCountItem(sessionId: string, itemId: string, reason: StockCorrectionReason) {
  const { data } = await api.post<ApiEnvelope<{ success: boolean; delta: number; newQty: number }>>(`/cycle-count/${sessionId}/items/${itemId}/approve`, { reason })
  return data.data!
}

export async function rejectCycleCountItem(sessionId: string, itemId: string) {
  const { data } = await api.post<ApiEnvelope<{ success: boolean }>>(`/cycle-count/${sessionId}/items/${itemId}/reject`)
  return data.data!
}

export async function approveAllCycleCountItems(sessionId: string, reason: StockCorrectionReason) {
  const { data } = await api.post<ApiEnvelope<{ success: boolean; approvedCount: number }>>(`/cycle-count/${sessionId}/approve-all`, { reason })
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

export async function upsertCatalogCartSession(payload: { phone: string; itemCount: number; totalValue: number }) {
  await publicApi.post("/public/retail/cart-session", payload)
}

export async function logCatalogSearchMiss(payload: { query: string; phone?: string }) {
  await publicApi.post("/public/retail/search-miss", payload)
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

// Keyed on the customer's private orders token, not their phone: the phone
// form was an unauthenticated enumeration oracle over the customer list.
export async function getPublicCustomerReferral(ordersToken: string) {
  const { data } = await publicApi.get<ApiEnvelope<CustomerReferral | null>>(`/public/retail/my-referral/${encodeURIComponent(ordersToken)}`)
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

// ── Instagram auto-publish («كتلوك المفرد») ───────────────────────────────────

export interface InstagramAccount {
  id: string
  igUserId: string
  username: string
  name?: string | null
  profilePictureUrl?: string | null
  pageName?: string | null
  status: "connected" | "error" | "disconnected"
  lastError?: string | null
  tokenExpiresAt?: string | null
  tokenExpiringSoon?: boolean
  createdAt: string
}

export type InstagramMediaPlan = {
  media: Array<{ kind: "image"; imageIndex: number } | { kind: "video" }>
  coverImageIndex?: number
}

export interface InstagramPost {
  id: string
  retailItemId?: string | null
  productTitle: string
  accountId: string
  queueId?: string | null
  position: number
  postType: "IMAGE" | "CAROUSEL" | "REEL"
  status: "DRAFT" | "QUEUED" | "PREPARING" | "UPLOADING" | "PUBLISHED" | "FAILED"
  caption: string
  mediaPlan: InstagramMediaPlan
  permalink?: string | null
  errorMessage?: string | null
  attemptCount: number
  publishedAt?: string | null
  createdAt: string
  account?: { username: string; profilePictureUrl?: string | null }
  queue?: { id: string; name?: string | null } | null
}

export interface InstagramQueue {
  id: string
  accountId: string
  name?: string | null
  status: "ACTIVE" | "PAUSED" | "DONE"
  scheduleType: "FIXED_TIMES" | "INTERVAL"
  times: string[]
  intervalMinutes?: number | null
  postsPerDay: number
  publishedToday: number
  lastPublishedAt?: string | null
  createdAt: string
  account?: { username: string; profilePictureUrl?: string | null; status: string }
  pendingCount?: number
}

export interface InstagramHashtagGroup {
  id: string
  name: string
  category?: string | null
  hashtags: string[]
}

export async function getInstagramAppConfig() {
  const { data } = await api.get<ApiEnvelope<{ appId: string; hasAppSecret: boolean }>>("/instagram/app-config")
  return data.data!
}

export async function saveInstagramAppConfig(payload: { appId?: string; appSecret?: string }) {
  const { data } = await api.put<ApiEnvelope<{ appId: string; hasAppSecret: boolean }>>("/instagram/app-config", payload)
  return data.data!
}

export async function getInstagramAccounts() {
  const { data } = await api.get<ApiEnvelope<InstagramAccount[]>>("/instagram/accounts")
  return data.data ?? []
}

export async function getInstagramOauthUrl(returnTo: string) {
  const { data } = await api.get<ApiEnvelope<{ url: string }>>("/instagram/oauth-url", { params: { returnTo } })
  return data.data!.url
}

export async function connectInstagramManual(accessToken: string) {
  const { data } = await api.post<ApiEnvelope<InstagramAccount[]>>("/instagram/accounts/manual", { accessToken })
  return data.data ?? []
}

export async function checkInstagramAccount(id: string) {
  const { data } = await api.post<ApiEnvelope<InstagramAccount>>(`/instagram/accounts/${id}/check`)
  return data.data!
}

export async function disconnectInstagramAccount(id: string) {
  await api.post(`/instagram/accounts/${id}/disconnect`)
}

export async function deleteInstagramAccount(id: string) {
  await api.delete(`/instagram/accounts/${id}`)
}

export async function getInstagramQuota(accountId: string) {
  const { data } = await api.get<ApiEnvelope<{ used: number; total: number }>>(`/instagram/accounts/${accountId}/quota`)
  return data.data!
}

export async function uploadRetailItemVideo(itemId: string, file: File, meta: { duration?: number; width?: number; height?: number }) {
  const form = new FormData()
  form.append("video", file)
  if (meta.duration) form.append("duration", String(meta.duration))
  if (meta.width) form.append("width", String(meta.width))
  if (meta.height) form.append("height", String(meta.height))
  const { data } = await api.post<ApiEnvelope<{ id: string; url: string; duration?: number }>>(
    `/instagram/catalog-items/${itemId}/video`,
    form,
    { headers: { "Content-Type": "multipart/form-data" }, timeout: 300000 }
  )
  return data.data!
}

export async function deleteRetailItemVideo(itemId: string) {
  await api.delete(`/instagram/catalog-items/${itemId}/video`)
}

export async function getInstagramHashtagGroups() {
  const { data } = await api.get<ApiEnvelope<InstagramHashtagGroup[]>>("/instagram/hashtag-groups")
  return data.data ?? []
}

export async function createInstagramHashtagGroup(payload: { name: string; category?: string; hashtags: string[] }) {
  const { data } = await api.post<ApiEnvelope<InstagramHashtagGroup>>("/instagram/hashtag-groups", payload)
  return data.data!
}

export async function updateInstagramHashtagGroup(id: string, payload: { name?: string; category?: string; hashtags?: string[] }) {
  const { data } = await api.put<ApiEnvelope<InstagramHashtagGroup>>(`/instagram/hashtag-groups/${id}`, payload)
  return data.data!
}

export async function deleteInstagramHashtagGroup(id: string) {
  await api.delete(`/instagram/hashtag-groups/${id}`)
}

export async function validateInstagramMedia(retailItemId: string, mediaPlan: InstagramMediaPlan) {
  const { data } = await api.post<ApiEnvelope<{ warnings: string[] }>>("/instagram/validate-media", { retailItemId, mediaPlan })
  return data.data!
}

export async function saveInstagramDraft(payload: { retailItemId: string; accountId: string; caption: string; mediaPlan: InstagramMediaPlan }) {
  const { data } = await api.post<ApiEnvelope<InstagramPost>>("/instagram/posts/draft", payload)
  return data.data!
}

export async function publishInstagramPost(payload: { retailItemId: string; accountId: string; caption: string; mediaPlan: InstagramMediaPlan; draftId?: string }) {
  const { data } = await api.post<ApiEnvelope<{ id: string; status: string }>>("/instagram/posts/publish", payload)
  return data.data!
}

export async function retryInstagramPost(id: string) {
  await api.post(`/instagram/posts/${id}/retry`)
}

export async function getInstagramPosts(params?: { status?: string; retailItemId?: string }) {
  const { data } = await api.get<ApiEnvelope<InstagramPost[]>>("/instagram/posts", { params })
  return data.data ?? []
}

export async function getInstagramPost(id: string) {
  const { data } = await api.get<ApiEnvelope<InstagramPost>>(`/instagram/posts/${id}`)
  return data.data!
}

export async function deleteInstagramPost(id: string) {
  await api.delete(`/instagram/posts/${id}`)
}

export async function getInstagramQueues() {
  const { data } = await api.get<ApiEnvelope<InstagramQueue[]>>("/instagram/queues")
  return data.data ?? []
}

export async function createInstagramQueue(payload: { accountId: string; name?: string; scheduleType: "FIXED_TIMES" | "INTERVAL"; times?: string[]; intervalMinutes?: number; postsPerDay: number }) {
  const { data } = await api.post<ApiEnvelope<InstagramQueue>>("/instagram/queues", payload)
  return data.data!
}

export async function updateInstagramQueue(id: string, payload: Partial<{ name: string; status: "ACTIVE" | "PAUSED"; scheduleType: "FIXED_TIMES" | "INTERVAL"; times: string[]; intervalMinutes: number; postsPerDay: number }>) {
  const { data } = await api.put<ApiEnvelope<InstagramQueue>>(`/instagram/queues/${id}`, payload)
  return data.data!
}

export async function deleteInstagramQueue(id: string) {
  await api.delete(`/instagram/queues/${id}`)
}

export async function addPostToInstagramQueue(queueId: string, payload: { retailItemId: string; accountId: string; caption: string; mediaPlan: InstagramMediaPlan }) {
  const { data } = await api.post<ApiEnvelope<InstagramPost>>(`/instagram/queues/${queueId}/posts`, payload)
  return data.data!
}

export async function getInstagramQueuePosts(queueId: string) {
  const { data } = await api.get<ApiEnvelope<InstagramPost[]>>(`/instagram/queues/${queueId}/posts`)
  return data.data ?? []
}
