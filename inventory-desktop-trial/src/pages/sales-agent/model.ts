/**
 * «المندوب» — the shapes the rep's screens share, and the pure unit/number
 * helpers. Split out of SalesAgentPage.tsx; nothing here renders.
 */

import { piecesPerUnit as sharedPiecesPerUnit } from "../../utils/units"
import { agentWholesaleUnits } from "../../utils/salesAgentCatalog"
import { cartonEligible, type AgentMode } from "../../utils/salesAgentDrafts"
import type { FollowUpReason } from "./types"

export type Unit = "PIECE" | "DOZEN" | "BOX" | "CARTON"

export type AgentProduct = {
  id: string
  itemNumber: string
  name: string
  category: string | null
  salePrice: number
  cartonPiecePrice?: number | null
  oldPrice: number | null
  isOffer: boolean
  isNewArrival: boolean
  pcsPerCarton: number
  boxPieces: number | null
  hiddenUnits: string[]
  hasImage: boolean
  currentStock: number
}

type AgentCustomer = {
  id: string
  name: string
  phone: string
  address: string | null
  area: string | null
  province: string | null
  currentBalance: number
  lastTransactionAt: string | null
  lastSaleAt: string | null
  /** null = never bought anything, which reads differently from "quiet 40 days". */
  daysSinceLastSale: number | null
  /** Present when the screen asked for reasons; server-worded. */
  followUpReasons?: FollowUpReason[]
}

export type CustomerPage = {
  total: number
  page: number
  limit: number
  hasMore: boolean
  /** The shop's own inactive-customer setting, so no screen invents a number. */
  quietDays?: number
  customers: AgentCustomer[]
}

/** «يومي» — the rep's own day. Contains no figure the owner keeps private. */
export type AgentToday = {
  orders: number
  /** Refused orders, shown separately so the number never silently shrinks. */
  rejectedOrders: number
  rejectedValue: number
  orderValue: number
  receipts: number
  collected: number
  issues: number
  newCustomers: number
  customersVisited: number
}

export type CustomerHeader = AgentCustomer & {
  lastPayment: { amount: number; date: string } | null
  /** The SHOP position, for showing the rep how far they are from it. */
  latitude: number | null
  longitude: number | null
}

export type PhoneLookup = {
  found: boolean
  phone: string
  id?: string
  name?: string
  mine?: boolean
  claimable?: boolean
  reason?: "MINE" | "UNASSIGNED" | "OTHER_AGENT" | "DELETED"
  message?: string
}

export type CartLine = { productId: string; unit: Unit; quantity: number }

export type AgentOrder = {
  id: string
  status: string
  createdAt: string
  reviewedAt: string | null
  /** Why it was refused, so the rep can fix it instead of telephoning. */
  reviewNote: string | null
  customerName: string
  total: number
  lineCount: number
}

export type CashOnHand = { collected: number; handedOver: number; onHand: number }

export type AgentReceipt = {
  id: string
  voucherNumber: string
  amount: number
  date: string
  cancelled: boolean
  customerId: string | null
  customerName: string
}

export type AgentIssue = {
  id: string
  reason: string
  reasonLabel: string
  note: string | null
  competitorInfo: string | null
  createdAt: string
  customerName: string
  productName: string | null
}

export type AgentPriceRequest = {
  id: string
  unit: Unit
  currentPrice: number
  requestedPrice: number
  reason: string | null
  status: string
  used: boolean
  createdAt: string
  customerId: string
  customerName: string
  productId: string
  productName: string
}

export type UsablePrice = { id: string; productId: string; unit: Unit; price: number }

export type AgentHandoverRow = {
  id: string
  amount: number
  date: string
  notes: string | null
  receivedBy: string
}

type StatementRow = {
  id: string
  date: string
  type: string
  invoiceType: string | null
  amount: number
  referenceNumber: string
  status?: string | null
  runningBalance?: number
  createdByName?: string | null
  /** Written under this rep's account — the only rows they may change. */
  mine?: boolean
  /** A change to this row already waits on the owner. */
  pending?: "EDIT" | "CANCEL" | null
}

export type CustomerStatement = {
  customer: { id: string; name: string; openingBalance: number }
  transactions: StatementRow[]
}

export type IssueReason = { code: string; label: string; aboutProduct: boolean }

/* ── unit helpers ────────────────────────────────────────────────────
 * Mirrors the server's conversion exactly. The server recomputes every price
 * from the database when the order is submitted — what is shown here is a
 * preview, never the number that gets billed.
 *
 * `piecesPerUnit` is imported from the shared util, not reimplemented here.
 * A from-scratch copy of this once existed on this page and rounded a BOX
 * DOWN for any odd carton size instead of up — pcsPerCarton=5 showed a box as
 * 5 pieces (a full carton) here while the server billed it at 3. The rep read
 * a wrong preview price and the picker's max-quantity was wrong too, off the
 * same broken number. `utils/units.ts` is the copy every other order-taking
 * page in the app already uses; this page just was not one of them.
 */

function piecesPerUnit(product: AgentProduct, unit: Unit) {
  // Only these two fields matter to the conversion; passed explicitly so a
  // wider (or narrower) AgentProduct shape can never trip up the shared util.
  return sharedPiecesPerUnit(unit, { pcsPerCarton: product.pcsPerCarton, boxPieces: product.boxPieces })
}

export function unitPrice(product: AgentProduct, unit: Unit, mode: AgentMode = "WHOLESALE") {
  return (mode === "CARTON" ? Number(product.cartonPiecePrice ?? 0) : product.salePrice) * piecesPerUnit(product, unit)
}

export function maxQty(product: AgentProduct, unit: Unit) {
  return Math.floor(product.currentStock / piecesPerUnit(product, unit))
}

export function availableUnits(product: AgentProduct, mode: AgentMode = "WHOLESALE"): Unit[] {
  if (mode === "CARTON") return cartonEligible(product) ? ["CARTON"] : []
  return agentWholesaleUnits
}

export type Screen = "today" | "catalog" | "customers" | "new-customer" | "orders" | "money" | "receipts" | "customer-detail" | "issues" | "visits" | "pending"

export type CatalogColumns = 2 | 3 | 4

export type CatalogSort = "name" | "newest" | "stock" | "price-low" | "price-high"

// Reps type on Arabic keyboards. Stripping non-ASCII digits read «١٢» as an
// empty string, so the field silently fell back to 1.
function toAsciiDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf))
}

// Money is written «50.000» here and means fifty thousand, so the separator is
// dropped. Quantities are the opposite: they are whole units and small, so a
// separator is a typo — «1.5» must read as 1, not 15. Stripping the dot turned
// a habit of typing a decimal point into ten times the order.
export function digitsOnly(value: string) {
  return toAsciiDigits(value).replace(/\D/g, "")
}

export function wholeUnits(value: string, max = 100_000) {
  const n = Number(digitsOnly(toAsciiDigits(value).split(/[.,٫٬]/)[0]))
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.min(n, max)
}


/* ── catalog ─────────────────────────────────────────────────────────── */
