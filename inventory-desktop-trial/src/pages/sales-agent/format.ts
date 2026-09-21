/**
 * Wording and number formatting shared by the rep screens.
 *
 * Kept apart from `shared.tsx` (which exports components) so fast refresh keeps
 * working: a file that mixes components with plain values loses it.
 */
export type AgentUnit = "PIECE" | "DOZEN" | "BOX" | "CARTON"

export const UNIT_LABEL: Record<AgentUnit, string> = {
  PIECE: "قطعة",
  DOZEN: "دزينة",
  BOX: "علبة",
  CARTON: "كارتون",
}

export const money = (n: number) => Math.round(n).toLocaleString("en-US")
export const shortDate = (d: string | Date) => new Date(d).toLocaleDateString("en-GB")

/** «قبل ساعتين» — relative time, so a pending order says how long it has waited. */
export function sinceLabel(ms: number | undefined): string {
  if (!ms) return "وقت غير معروف"
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60000))
  if (minutes < 1) return "الآن"
  if (minutes < 60) return `قبل ${minutes} دقيقة`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `قبل ${hours} ساعة`
  return `قبل ${Math.round(hours / 24)} يوم`
}
