/** Shapes the rep screens share with the server. Server-computed, never client-invented. */
import type { AgentMode, AgentUnit } from "../../utils/salesAgentDrafts"

export type PriceSource = "APPROVED_REQUEST" | "OFFER" | "CATALOG"

export type PriceChange = {
  previousPrice: number
  currentPrice: number
  difference: number
  percent: number
  direction: "UP" | "DOWN"
  lastPurchaseAt: string
}

export type LineOffer = {
  id: string
  /** EXCLUSIVE instant; `endsOnDate` is the day to show a human. */
  endsAt: string
  endsOnDate?: string
  discountType?: "PERCENT" | "AMOUNT"
  discountPercent?: number | null
  note?: string | null
  catalogPrice?: number
}

export type ReviewItem = {
  productId: string
  productName: string
  unit: AgentUnit
  quantity: number
  unitPrice: number
  totalPrice: number
  availableStock: number
  priceSource?: PriceSource
  /** Present when an approved price request set this line's price. */
  specialPrice?: { catalogPrice: number }
  offer?: LineOffer
  priceChange?: PriceChange
}

/**
 * The mandatory review, computed by the server.
 *
 * `reviewToken` is what the server checks on send: if any price or available
 * quantity moved after this was produced, the send is refused and the rep
 * reviews again. The client never recomputes it.
 */
export type OrderReview = {
  reviewToken: string
  customerName: string
  customerPhone?: string
  /** Shown for context only. Sending an order does not move the balance. */
  customerBalance?: number
  priceMode?: AgentMode
  notes?: string
  subtotal: number
  items: ReviewItem[]
  shortages: Array<{ productId?: string; productName: string; requested?: number; available?: number; short: number }>
  pricedAt?: string
}

/** «يشتريها عادةً» */
export type UsualProduct = {
  productId: string
  productName: string
  itemNumber: string | null
  unit: AgentUnit
  times: number
  /** Average of the last 3 purchases, rounded and capped by stock. */
  suggestedQuantity: number
  averageQuantity: number
  /** 1, 2 or 3 — how many purchases the average is built from. */
  averageSampleSize: number
  averageMatchesPriceMode: boolean
  stockCapped: boolean
  lastPurchaseAt: string
  availableStock: number
  pcsPerCarton: number
  boxPieces: number | null
  hasImage: boolean
  currentPrice: number
  catalogPrice: number
  priceSource: PriceSource
  offer?: { id: string; endsAt: string; endsOnDate: string; note: string | null }
  priceChange?: PriceChange
}

/** «عرض خاص للزبون» as every screen receives it. */
export type CustomerOffer = {
  id: string
  customerId: string
  customerName: string
  productId: string
  productName: string
  unit: AgentUnit
  priceMode: AgentMode
  discountType: "PERCENT" | "AMOUNT"
  fixedPrice: number | null
  discountPercent: number | null
  startsAt: string
  /** EXCLUSIVE instant. Use `endsOnDate` for anything shown to a human. */
  endsAt: string
  /** The days the owner picked, resolved in the SHOP's timezone by the server. */
  startsOnDate: string
  endsOnDate: string
  isActive: boolean
  note: string | null
  catalogPrice: number
  offerPrice: number | null
  /** Dearer than the shelf price — allowed, but said plainly. */
  aboveCatalog?: boolean
  isLive: boolean
  state: "LIVE" | "PAUSED" | "SCHEDULED" | "EXPIRED"
}

export type FollowUpReason = {
  code: "NEVER_BOUGHT" | "QUIET" | "BALANCE" | "ORDER_PENDING" | "ORDER_REJECTED" | "OFFER_ENDING"
  label: string
  detail?: string
}

export type VisitOutcome = "ORDERED" | "NO_ORDER" | "CLOSED" | "NEEDS_FOLLOW_UP" | "NOTE"

export type VisitCustomer = {
  id: string
  name: string
  phone: string
  address: string | null
  area: string | null
  latitude: number | null
  longitude: number | null
  currentBalance: number
  lastTransactionAt: string | null
  distanceKm: number | null
  todayVisit: {
    id: string
    startedAt: string
    endedAt: string | null
    outcome: string | null
    outcomeLabel: string | null
    note: string | null
  } | null
}

/** What `POST /sales-agent/orders` answers. */
export type SubmittedOrder = {
  approvalId?: string
  shortages?: Array<{ productName: string; short: number }>
  /** Set when the order was attached to an open visit for that customer. */
  linkedVisitId?: string | null
}

export type PlanStatus = "PLANNED" | "STARTED" | "DONE" | "CANCELLED"

/** One stop on «خطة زيارات اليوم» — the intention, plus the visit if it happened. */
export type VisitPlanEntry = {
  id: string
  salesAgentId: string
  customerId: string
  customerName: string
  customerPhone: string
  address: string | null
  area: string | null
  latitude: number | null
  longitude: number | null
  currentBalance: number
  planDate: string
  sortOrder: number | null
  note: string | null
  status: PlanStatus | string
  statusLabel: string
  visit: {
    id: string
    startedAt: string
    endedAt: string | null
    outcome: string | null
    outcomeLabel: string | null
    note: string | null
    /** True when a real order is attached to this visit. */
    orderLinked: boolean
    /** «أخذ طلب» with nothing behind it. */
    manualOutcome: boolean
  } | null
}

export type TodayVisit = {
  id: string
  startedAt: string
  endedAt: string | null
  outcome: string | null
  outcomeLabel: string | null
  note: string | null
  customerId: string
  customerName: string
  customerPhone: string
  area: string | null
  address: string | null
}
