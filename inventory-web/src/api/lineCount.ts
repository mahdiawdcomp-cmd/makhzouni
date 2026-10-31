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
}

export interface LineCountReviewItem {
  productId: string
  productName: string
  itemNumber: string | null
  category: string | null
  pcsPerCarton: number
  systemQty: number
  countedQty: number
  delta: number
  decision: LineCountDecision
  unitPrice: number
  value: number
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
  deleted: boolean
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
  items: LineCountReviewItem[]
  uncounted: { productId: string; productName: string; itemNumber: string | null; pcsPerCarton: number; systemQty: number }[]
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
export const recountLineCount = (id: string, productIds: string[]) =>
  api.post(`/stocktake/lines/${id}/recount`, { productIds }).then(unwrap<{ products: number }>)
export const finalizeLineCount = (id: string) =>
  api.post(`/stocktake/lines/${id}/finalize`, {}, { timeout: 150_000 }).then(unwrap<{ saleInvoiceId: string | null; purchaseInvoiceId: string | null }>)
export const cancelLineCount = (id: string) => api.post(`/stocktake/lines/${id}/cancel`).then(unwrap<unknown>)
export const reopenLineCount = (id: string) => api.post(`/stocktake/lines/${id}/reopen`).then(unwrap<unknown>)

export const lineCountPublicUrl = (token: string) => `${window.location.origin}/line-count/${token}`
