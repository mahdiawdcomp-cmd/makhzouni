// «جرد بالسطور» admin API.
import { api } from "./client"

export type LineCountStatus = "OPEN" | "SUBMITTED" | "FINALIZED" | "CANCELLED"
export type LineCountDecision = "PENDING" | "ACCEPTED" | "REJECTED"

export interface LineCountSummary {
  id: string
  publicToken: string
  warehouseId: string
  warehouseName: string
  status: LineCountStatus
  notes: string | null
  createdAt: string
  submittedAt: string | null
  finalizedAt: string | null
  lineCount: number
  productCount: number
  /** Products sent back to the worker; the count is OPEN but still reviewable. */
  recountCount: number
  /** What the worker's phone has saved so far, before the upload. */
  progress: LineCountProgress | null
}

export interface LineCountProgress {
  lines: number
  products: number
  at: string
  devices: number
}

export interface LineCountReviewItem {
  productId: string
  productName: string
  itemNumber: string | null
  category: string | null
  pcsPerCarton: number
  systemQty: number
  countedQty: number
  /** Warehouse stock right now (systemQty is the stock at the count). */
  currentQty: number
  delta: number
  decision: LineCountDecision
  decidedBy: string | null
  decidedAt: string | null
  /** Cost per piece; `value` is |delta| × cost for shortages and overages alike. */
  unitPrice: number
  value: number
  /** What the shortage sale invoice will charge (sale price). */
  saleValue: number
  /** Finalize refuses it — no sale price (shortage) or no cost (overage). */
  noPrice: boolean
  deleted: boolean
  firstWrittenAt: string
  lastWrittenAt: string | null
  /** Stock moved between the first and last line of this product. */
  ambiguous: boolean
  systemQtyFirst: number
  systemQtyLast: number | null
  basis: "FIRST" | "LAST"
  movedAfterWriting: boolean
  /** The worker's own total, set once the manager corrects anything. */
  workerCountedQty: number | null
  /** A piece↔carton flip on these lines would explain the variance. Never applied on its own. */
  unitSuggestion: { lineIds: string[]; countedQty: number; delta: number } | null
  lines: LineCountLine[]
}

export type LineCountUnit = "PIECE" | "CARTON"

export interface LineCountLine {
  id: string
  position: number
  qty: number
  unit: LineCountUnit
  qtyPieces: number
  writtenAt: string
  source: "WORKER" | "ADMIN"
  originalQty: number | null
  originalUnit: LineCountUnit | null
  editedAt: string | null
  editedBy: string | null
  deleted: boolean
}

export interface LineCountEvent {
  id: string
  action: string
  userName: string | null
  detail: Record<string, unknown> | null
  createdAt: string
}

export interface LineCountReview {
  id: string
  publicToken: string
  warehouseId: string
  warehouseName: string
  status: LineCountStatus
  notes: string | null
  createdAt: string
  submittedAt: string | null
  finalizedAt: string | null
  saleInvoice: { id: string; invoiceNumber: string } | null
  purchaseInvoice: { id: string; invoiceNumber: string } | null
  lineCount: number
  /** Non-empty while some products are back with the worker for a recount. */
  recountProductIds: string[]
  recountRequestedAt: string | null
  progress: LineCountProgress | null
  createdByName: string | null
  finalizedByName: string | null
  items: LineCountReviewItem[]
  uncounted: { productId: string; productName: string; itemNumber: string | null; pcsPerCarton: number; systemQty: number }[]
  events: LineCountEvent[]
}

const unwrap = <T,>(r: { data: unknown }) => (r.data as { data: T }).data

export const listLineCounts = (warehouseId?: string) =>
  api.get("/stocktake/lines", { params: warehouseId ? { warehouseId } : {} }).then(unwrap<LineCountSummary[]>)
export const createLineCount = (body: { warehouseId: string; notes?: string }) =>
  api.post("/stocktake/lines", body).then(unwrap<LineCountSummary>)
export const getLineCount = (id: string) => api.get(`/stocktake/lines/${id}`).then(unwrap<LineCountReview>)
export const decideLineCount = (id: string, decision: LineCountDecision, productId?: string, productIds?: string[]) =>
  api.post(`/stocktake/lines/${id}/decision`, { decision, productId, productIds }).then(unwrap<{ updated: number }>)
export const editLineCountLine = (id: string, lineId: string, qty: number, unit: LineCountUnit) =>
  api.patch(`/stocktake/lines/${id}/line/${lineId}`, { qty, unit }).then(unwrap<unknown>)
export const deleteLineCountLine = (id: string, lineId: string) =>
  api.delete(`/stocktake/lines/${id}/line/${lineId}`).then(unwrap<unknown>)
export const setLineCountProductTotal = (id: string, productId: string, qty: number, unit: LineCountUnit) =>
  api.post(`/stocktake/lines/${id}/product/${productId}/total`, { qty, unit }).then(unwrap<unknown>)
export const swapLineCountUnits = (id: string, productId: string, lineIds: string[]) =>
  api.post(`/stocktake/lines/${id}/product/${productId}/swap-unit`, { lineIds }).then(unwrap<unknown>)
/** Which moment the shelf stood at, for a product written before and after a movement. */
export const setLineCountBasis = (id: string, productId: string, basis: "FIRST" | "LAST") =>
  api.post(`/stocktake/lines/${id}/product/${productId}/basis`, { basis }).then(unwrap<{ systemQty: number }>)
export const recountLineCount = (id: string, productIds: string[]) =>
  api.post(`/stocktake/lines/${id}/recount`, { productIds }).then(unwrap<{ products: number }>)
/** «أكيد خلصانة»: uncounted products entered as counted at zero (still PENDING). */
export const markLineCountGone = (id: string, productIds: string[]) =>
  api.post(`/stocktake/lines/${id}/gone`, { productIds }).then(unwrap<{ marked: number }>)

/** A product a finalized count missed and nothing has explained since. */
export interface LineCountWatchItem {
  productId: string
  productName: string
  itemNumber: string | null
  pcsPerCarton: number
  warehouseId: string
  warehouseName: string | null
  stock: number
  firstMissedAt: string
  lastMissedAt: string
  times: number
}
export const getLineCountWatch = (days = 60) =>
  api.get("/stocktake/lines/watch", { params: { days } }).then(unwrap<{ days: number; count: number; data: LineCountWatchItem[] }>)

export const finalizeLineCount = (id: string) =>
  api.post(`/stocktake/lines/${id}/finalize`, {}, { timeout: 150_000 }).then(unwrap<{ saleInvoiceId: string | null; purchaseInvoiceId: string | null }>)
export const cancelLineCount = (id: string) => api.post(`/stocktake/lines/${id}/cancel`).then(unwrap<unknown>)
export const reopenLineCount = (id: string) => api.post(`/stocktake/lines/${id}/reopen`).then(unwrap<unknown>)
/** «إلغاء إعادة العدّ»: back to review with every earlier line and decision. */
export const cancelLineCountRecount = (id: string) => api.post(`/stocktake/lines/${id}/cancel-recount`).then(unwrap<unknown>)

export const lineCountPublicUrl = (token: string) => `${window.location.origin}/line-count/${token}`
