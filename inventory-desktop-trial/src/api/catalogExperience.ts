import { api, publicApi } from "./client"

type Stage = "OPEN" | "VIEW" | "ADD" | "CHECKOUT"
let fallbackSession = ""
export function catalogSessionId(): string {
  try {
    const saved = JSON.parse(sessionStorage.getItem("catalog-funnel-v1") || "null")
    const now = Date.now()
    const id = saved?.id && now - saved.at < 30 * 60_000 ? saved.id : crypto.randomUUID()
    sessionStorage.setItem("catalog-funnel-v1", JSON.stringify({ id, at: now }))
    return id
  } catch { return fallbackSession ||= crypto.randomUUID() }
}
const sent = new Set<string>()
export async function trackCatalogStage(stage: Stage): Promise<void> {
  if (stage !== "OPEN") void trackCatalogStage("OPEN")
  const sessionId = catalogSessionId()
  const key = `${sessionId}:${stage}`
  if (sent.has(key)) return
  sent.add(key)
  try { await publicApi.post("/public/catalog/funnel", { sessionId, stage }) }
  catch { sent.delete(key) } // Metrics must never stop shopping; retry on the next interaction.
}
export async function getCatalogPurchaseHistory(access: string, visitor: string): Promise<string[]> {
  const r = await publicApi.get("/public/catalog/purchase-history", { params: { access: access || undefined, visitor: visitor || undefined } })
  return r.data.data.productIds
}
export type FunnelReport = { days: number; stages: number[]; sessions: number; successfulSessions: number; incompletePathOrders: number }
export async function getCatalogFunnel(days: number): Promise<FunnelReport> {
  const r = await api.get("/catalog-management/funnel", { params: { days } })
  return r.data.data
}
