export type AgentMode = "WHOLESALE" | "CARTON"
export type AgentUnit = "PIECE" | "DOZEN" | "BOX" | "CARTON"
export type AgentLine = { productId: string; unit: AgentUnit; quantity: number }
export type OrderPayload = { customerId: string; priceMode: AgentMode; notes?: string; clientRequestId: string; items: AgentLine[]; reviewToken: string }
/**
 * What the «الطلبات المعلّقة» screen needs to explain an unconfirmed attempt,
 * kept BESIDE the payload rather than inside it: the payload is posted to the
 * server exactly as stored, and it should carry nothing the server did not ask
 * for.
 *
 * Every field is optional in practice — an attempt saved on a rep's phone
 * before this existed has no meta, and the screen says «وقت غير معروف» instead
 * of hiding the order.
 */
export type PendingMeta = {
  /** When the rep pressed send, ms epoch. */
  createdAt: number
  lastAttemptAt: number
  attempts: number
  /** The total the review showed, so the screen can state what was sent. */
  subtotal: number
  customerName?: string
  /** Arabic, already human. Never a raw technical error. */
  reason?: string
  /**
   * The server answered definitively (prices moved, product gone, …). The
   * attempt is over: it may be edited or removed, and must not be re-sent.
   */
  settled?: boolean
}
export type AgentDraft = { items: AgentLine[]; notes: string; pending?: OrderPayload; pendingMeta?: PendingMeta }
export type AgentWorkspace = { customerId: string | null; mode: AgentMode; drafts: Record<string, AgentDraft> }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const EMPTY_DRAFT: AgentDraft = { items: [], notes: "" }
export const draftKey = (mode: AgentMode, customerId: string | null) => `${mode}:${customerId ?? "guest"}`
export const workspaceKey = (userId: string) => `sales-agent-workspace:v2:${userId}`
export function cleanAgentLines(value: unknown): AgentLine[] {
  if (!Array.isArray(value)) return []
  return value.filter((x): x is AgentLine => x && typeof x.productId === "string" && uuid.test(x.productId)
    && ["PIECE", "DOZEN", "BOX", "CARTON"].includes(x.unit)
    && Number.isInteger(x.quantity) && x.quantity > 0 && x.quantity <= 100000)
    .map(({ productId, unit, quantity }) => ({ productId, unit, quantity }))
}
function cleanPendingMeta(value: unknown): PendingMeta | undefined {
  if (!value || typeof value !== "object") return undefined
  const m = value as Record<string, unknown>
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0)
  const createdAt = num(m.createdAt)
  if (createdAt <= 0) return undefined
  const text = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim().slice(0, 300) : undefined)
  return {
    createdAt,
    lastAttemptAt: num(m.lastAttemptAt) || createdAt,
    attempts: Math.max(1, Math.min(999, Math.floor(num(m.attempts)) || 1)),
    subtotal: num(m.subtotal),
    customerName: text(m.customerName),
    reason: text(m.reason),
    settled: m.settled === true,
  }
}

/**
 * Every unconfirmed attempt on this device, newest first.
 *
 * Derived from the workspace rather than kept as a second list: one source of
 * truth means the queue and the carts can never disagree about what was sent.
 */
export function pendingAttempts(workspace: AgentWorkspace): Array<{
  key: string
  mode: AgentMode
  customerId: string | null
  /** Absent once the attempt is settled: there is nothing left to re-send. */
  payload?: OrderPayload
  meta?: PendingMeta
  lineCount: number
}> {
  return Object.entries(workspace.drafts)
    .flatMap(([key, draft]) => {
      if (!draft.pending && !draft.pendingMeta) return []
      const [modePart, customerPart] = key.split(":")
      return [{
        key,
        mode: (draft.pending?.priceMode ?? (modePart === "CARTON" ? "CARTON" : "WHOLESALE")) as AgentMode,
        customerId: draft.pending?.customerId ?? (customerPart === "guest" ? null : customerPart),
        payload: draft.pending,
        meta: draft.pendingMeta,
        lineCount: (draft.pending?.items ?? draft.items).length,
      }]
    })
    .sort((a, b) => (b.meta?.createdAt ?? 0) - (a.meta?.createdAt ?? 0))
}

export function readAgentWorkspace(raw: string | null): AgentWorkspace {
  const empty: AgentWorkspace = { customerId: null, mode: "WHOLESALE", drafts: {} }
  try {
    const parsed = JSON.parse(raw || "null")
    if (!parsed || typeof parsed.drafts !== "object" || !parsed.drafts) return empty
    const drafts: Record<string, AgentDraft> = {}
    for (const [key, value] of Object.entries(parsed.drafts)) {
      if (!/^(WHOLESALE|CARTON):(guest|[0-9a-f-]{36})$/i.test(key) || !value || typeof value !== "object") continue
      const d = value as AgentDraft
      const items = cleanAgentLines(d.items)
      const p = d.pending
      // Keep a sent attempt exactly, including its key, for safe retries after reload.
      const pending = p && uuid.test(p.customerId) && uuid.test(p.clientRequestId)
        && typeof p.reviewToken === "string" && /^[0-9a-f]{64}$/.test(p.reviewToken)
        && ["WHOLESALE", "CARTON"].includes(p.priceMode)
        && draftKey(p.priceMode, p.customerId) === key && Array.isArray(p.items)
        && cleanAgentLines(p.items).length === p.items.length ? { ...p, items: cleanAgentLines(p.items) } : undefined
      drafts[key] = {
        items: pending?.items ?? items,
        notes: typeof d.notes === "string" ? d.notes : "",
        pending,
        // Meta is display-only, so a corrupt or missing one must never discard
        // the attempt it describes. It also survives WITHOUT a payload: a
        // settled attempt keeps its reason on screen after the payload is
        // dropped, which is how the rep learns why the order did not go.
        pendingMeta: cleanPendingMeta(d.pendingMeta),
      }
    }
    return { drafts, mode: parsed.mode === "CARTON" ? "CARTON" : "WHOLESALE", customerId: typeof parsed.customerId === "string" && uuid.test(parsed.customerId) ? parsed.customerId : null }
  } catch { return empty }
}
export function mergeAgentDrafts(target: AgentDraft, source: AgentDraft): AgentDraft {
  if (target.pending || source.pending) throw new Error("راجع حالة الطلب المُرسل قبل الدمج")
  const items = target.items.map(x => ({ ...x }))
  for (const line of source.items) {
    const found = items.find(x => x.productId === line.productId && x.unit === line.unit)
    if (found) {
      if (found.quantity + line.quantity > 100000) throw new Error("الكمية بعد الدمج كبيرة جداً")
      found.quantity += line.quantity
    } else items.push({ ...line })
  }
  const notes = [target.notes, source.notes].filter(Boolean).join("\n")
  if (notes.length > 4000) throw new Error("الملاحظات بعد الدمج طويلة؛ اختصرها أولاً، السلتان محفوظتان")
  return { items, notes }
}
export function cartonEligible(p: { cartonPiecePrice?: number | null; pcsPerCarton: number; currentStock: number; hiddenUnits: string[] }) {
  return Number.isFinite(p.cartonPiecePrice) && Number(p.cartonPiecePrice) > 0
    && Number.isInteger(p.pcsPerCarton) && p.pcsPerCarton > 0 && p.currentStock >= p.pcsPerCarton && !p.hiddenUnits.includes("CARTON")
}
export function isDefinitiveOrderRejection(code: unknown) {
  // These are emitted only after the service has looked for the idempotency key.
  // Auth, ownership, gateway and server errors cannot prove a previous attempt failed.
  return typeof code === "string" && ["ORDER_REVIEW_CHANGED", "CARTON_UNAVAILABLE", "PRODUCT_UNAVAILABLE", "UNIT_UNAVAILABLE", "PRODUCT_NOT_FOUND", "QUANTITY_TOO_LARGE"].includes(code)
}
