import type { PublicCatalogProduct } from "../types/api"
import { catalogProductForMode } from "./salePricing"

export type PurchaseMode = "WHOLESALE" | "CARTON"
export type SavedLine = { productId: string; unit: "PIECE" | "DOZEN" | "BOX" | "CARTON"; quantity: number; isSample?: boolean }
export type SavedCatalog = { version: 1; mode: PurchaseMode | null; lines: SavedLine[]; favorites: string[] }
export const emptyCatalog = (): SavedCatalog => ({ version: 1, mode: null, lines: [], favorites: [] })
const units = new Set(["PIECE", "DOZEN", "BOX", "CARTON"])

export function parseSavedCatalog(raw: string | null): SavedCatalog {
  try {
    const value = JSON.parse(raw || "null")
    if (!value || value.version !== 1) return emptyCatalog()
    return {
      version: 1,
      mode: value.mode === "CARTON" || value.mode === "WHOLESALE" ? value.mode : null,
      lines: Array.isArray(value.lines) ? value.lines.slice(0, 200).filter((l: SavedLine) => l && typeof l.productId === "string" && l.productId.length <= 64 && units.has(l.unit) && Number.isSafeInteger(l.quantity) && l.quantity > 0).map((l: SavedLine) => ({ productId: l.productId, unit: l.unit, quantity: Math.min(l.quantity, 100000), isSample: l.isSample === true })) : [],
      favorites: Array.isArray(value.favorites) ? [...new Set<string>(value.favorites.filter((id: unknown) => typeof id === "string" && id.length <= 64))].slice(0, 1000) : [],
    }
  } catch { return emptyCatalog() }
}

export function loadCatalog(storageKey: string): SavedCatalog {
  try { return parseSavedCatalog(localStorage.getItem(storageKey)) } catch { return emptyCatalog() }
}
export function saveCatalog(storageKey: string, value: SavedCatalog): boolean {
  try { localStorage.setItem(storageKey, JSON.stringify(value)); return true } catch { return false }
}

/** Rebuild exclusively from today's authorised catalog. Never trust stored prices or stock. */
export function restoreCatalogLines(lines: SavedLine[], products: PublicCatalogProduct[], mode: PurchaseMode) {
  const byId = new Map(products.map(p => [p.id, p]))
  const remaining = new Map(products.map(p => [p.id, Math.max(0, Number(p.currentStock))]))
  const seen = new Set<string>()
  return lines.flatMap(l => {
    const p = byId.get(l.productId)
    if (!p || (l.unit !== "PIECE" && p.hiddenUnits?.includes(l.unit)) || (l.isSample && l.unit !== "PIECE")) return []
    if (mode === "CARTON" && (p.pcsPerCarton < 1 || p.currentStock < p.pcsPerCarton || (!l.isSample && l.unit !== "CARTON"))) return []
    const count = l.unit === "CARTON" ? p.pcsPerCarton : l.unit === "DOZEN" ? 12 : l.unit === "BOX" ? (p.boxPieces || Math.ceil(p.pcsPerCarton / 2)) : 1
    if (!Number.isFinite(count) || count < 1) return []
    const id = `${p.id}:${l.unit}${l.isSample ? ":sample" : ""}`
    if (seen.has(id)) return []
    seen.add(id)
    const quantity = Math.min(l.isSample ? 1 : l.quantity, Math.floor((remaining.get(p.id) ?? 0) / count))
    if (quantity < 1) return []
    remaining.set(p.id, (remaining.get(p.id) ?? 0) - quantity * count)
    return [{ id, product: catalogProductForMode(p, l.isSample ? "WHOLESALE" : mode), unit: l.unit, quantity, isSample: l.isSample }]
  })
}
