// Unit conversion helpers. The whole system is piece-based: units only
// convert for entry/display. Mirrors backend utils/financial.ts exactly.

export type InvoiceUnit = "PIECE" | "DOZEN" | "BOX" | "CARTON"

export const UNIT_LABELS: Record<InvoiceUnit, string> = {
  PIECE: "قطعة",
  DOZEN: "درزن",
  BOX: "علبة",
  CARTON: "كرتون",
}

type UnitProduct = {
  pcsPerCarton: number
  boxPieces?: number | null
  hiddenUnits?: ("DOZEN" | "BOX" | "CARTON")[]
}

// Pieces inside one BOX: manual per-product override, or half the carton
// (rounded up) when no override is set.
export function effectiveBoxPieces(pcsPerCarton: number, boxPieces?: number | null): number {
  if (boxPieces != null && boxPieces > 0) return boxPieces
  return Math.ceil(Math.max(1, pcsPerCarton) / 2)
}

export function piecesPerUnit(unit: InvoiceUnit, product: UnitProduct): number {
  const n = Math.max(1, product.pcsPerCarton)
  if (unit === "CARTON") return n
  if (unit === "BOX") return effectiveBoxPieces(n, product.boxPieces)
  if (unit === "DOZEN") return 12
  return 1
}

export function unitToPieces(unit: InvoiceUnit, quantity: number, product: UnitProduct): number {
  return quantity * piecesPerUnit(unit, product)
}

// Unit price is always derived: piece price × pieces in the unit.
export function unitPriceFrom(basePiecePrice: number, unit: InvoiceUnit, product: UnitProduct): number {
  return basePiecePrice * piecesPerUnit(unit, product)
}

// Units offered on NEW invoice lines: PIECE always; others unless soft-hidden.
export function visibleUnits(product: UnitProduct): InvoiceUnit[] {
  const hidden = new Set(product.hiddenUnits ?? [])
  return (["PIECE", "DOZEN", "BOX", "CARTON"] as InvoiceUnit[]).filter(
    (u) => u === "PIECE" || !hidden.has(u as "DOZEN" | "BOX" | "CARTON")
  )
}
