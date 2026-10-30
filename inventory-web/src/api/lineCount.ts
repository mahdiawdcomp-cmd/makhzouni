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
  lines: { position: number; qty: number; unit: "PIECE" | "CARTON"; qtyPieces: number; writtenAt: string }[]
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
export const decideLineCount = (id: string, decision: LineCountDecision, productId?: string) =>
  api.post(`/stocktake/lines/${id}/decision`, { decision, productId }).then(unwrap<{ updated: number }>)
export const finalizeLineCount = (id: string) =>
  api.post(`/stocktake/lines/${id}/finalize`, {}, { timeout: 150_000 }).then(unwrap<{ saleInvoiceId: string | null; purchaseInvoiceId: string | null }>)
export const cancelLineCount = (id: string) => api.post(`/stocktake/lines/${id}/cancel`).then(unwrap<unknown>)
export const reopenLineCount = (id: string) => api.post(`/stocktake/lines/${id}/reopen`).then(unwrap<unknown>)

export const lineCountPublicUrl = (token: string) => `${window.location.origin}/line-count/${token}`
