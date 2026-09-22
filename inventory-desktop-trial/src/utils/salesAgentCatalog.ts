import type { AgentMode, AgentUnit } from "./salesAgentDrafts"

// Invoice-only hidden units must not restrict the wholesale catalog.
export const agentWholesaleUnits: AgentUnit[] = ["PIECE", "DOZEN", "BOX", "CARTON"]
export function agentDefaultUnit(mode: AgentMode, stock: number): AgentUnit {
  return mode === "CARTON" ? "CARTON" : stock >= 12 ? "DOZEN" : "PIECE"
}
export function stableThumbnailBatches(allIds: string[], visibleIds: string[]) {
  const visible = new Set(visibleIds)
  return Array.from({ length: Math.ceil(allIds.length / 24) }, (_, index) => {
    const ids = allIds.slice(index * 24, (index + 1) * 24)
    return { ids, enabled: ids.some(id => visible.has(id)) }
  })
}
