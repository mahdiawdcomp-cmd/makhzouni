// Client-side "does this price look wrong?" guard. WARNING ONLY — it never
// blocks a save and never talks to the server. Used to flag fat-fingered unit
// prices (extra/missing zero) before the clerk commits the line.
//
// Thresholds are intentionally loose so normal promotions/markups don't nag.
// Tune these two numbers to make the guard stricter or looser.
export const PRICE_GUARD = {
  // Warn when the entered price is more than HIGH_FACTOR× the reference price.
  HIGH_FACTOR: 5,
  // Warn when the entered price is below LOW_FACTOR× the reference price
  // (e.g. 0.2 = priced at less than a fifth of the reference).
  LOW_FACTOR: 0.2,
}

/**
 * Reference "expected" per-unit price for a line, derived from the product and
 * invoice type. Returns null when there is no reliable reference (so we stay
 * quiet instead of warning against a 0 baseline).
 *
 * `piecesInUnit` converts the per-piece product price up to the line's unit.
 */
export function referenceUnitPrice(
  product: { salePrice?: number | null; purchasePrice?: number | null; costPrice?: number | null; retailPrice?: number | null },
  isPurchase: boolean,
  piecesInUnit: number,
): number | null {
  const pick = (n?: number | null) => (typeof n === "number" && n > 0 ? n : 0)
  let base = 0
  if (isPurchase) {
    // For purchases the last purchase / cost price is the natural reference.
    base = pick(product.purchasePrice) || pick(product.costPrice)
  } else {
    // For sales the sale price is the reference, falling back to retail then cost.
    base = pick(product.salePrice) || pick(product.retailPrice) || pick(product.costPrice) || pick(product.purchasePrice)
  }
  if (base <= 0) return null
  return base * Math.max(1, piecesInUnit)
}

export type PriceFlag = "HIGH" | "LOW" | null

/** Compare an entered unit price against the reference; null = looks fine / no reference. */
export function priceLooksSuspicious(enteredUnitPrice: number, reference: number | null): PriceFlag {
  if (reference === null || reference <= 0) return null
  if (!(enteredUnitPrice > 0)) return null // zero price is handled elsewhere, don't double-warn
  if (enteredUnitPrice > reference * PRICE_GUARD.HIGH_FACTOR) return "HIGH"
  if (enteredUnitPrice < reference * PRICE_GUARD.LOW_FACTOR) return "LOW"
  return null
}
