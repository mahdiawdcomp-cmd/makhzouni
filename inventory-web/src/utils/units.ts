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

// How a piece count reads as cartons — for the invoice's carton column and the
// warehouse count sheet. A line rarely divides evenly, so the remainder is kept
// rather than rounded away: 3,640 pieces at 240/carton is "15 كرتون + 40 قطعة",
// never "15" (understates) and never "16" (overstates).
export type CartonBreakdown = { cartons: number; looseP: number; label: string }

export function cartonBreakdown(pieces: number, pcsPerCarton: number): CartonBreakdown {
  const per = Math.max(1, Math.floor(pcsPerCarton || 1))
  // A product with no carton size (1 piece/carton) has nothing to say here.
  if (per <= 1) return { cartons: 0, looseP: pieces, label: "—" }
  const sign = pieces < 0 ? -1 : 1
  const abs = Math.abs(pieces)
  const cartons = Math.floor(abs / per) * sign
  const looseP = (abs % per) * sign
  const label = cartons && looseP ? `${cartons} + ${looseP}` : cartons ? String(cartons) : looseP ? `0 + ${looseP}` : "0"
  return { cartons, looseP, label }
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
