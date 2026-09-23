/**
 * Unit conversion for the shopper-facing catalog and the sales rep.
 *
 * This existed twice, byte for byte, in `catalog.service.ts` and
 * `sales-agent.service.ts` — a rep's carton MUST mean exactly what a shopper's
 * carton means, and two copies of that rule is one edit away from it not.
 *
 * Deliberately NOT `amountInPieces` from `utils/financial.ts`, which looks like
 * the same function and is not: it multiplies by `pcsPerCarton` raw, while this
 * clamps with `Math.max(1, …)`. On a product whose carton size is 0 — and such
 * products exist — the raw version prices a carton at zero pieces and zero
 * money. Unifying onto it would have silently changed what those products sell
 * for, so the catalog's own behaviour is what got extracted here instead.
 */
import { Unit } from "@prisma/client";
import { effectiveBoxPieces, roundMoney } from "./financial";

/** Carton size, floored at 1 so a mis-entered 0 cannot collapse a line to nothing. */
function cartonSize(pcsPerCarton: number) {
  return Math.max(1, pcsPerCarton);
}

/** How many single pieces `quantity` of `unit` amounts to. */
export function piecesForUnit(
  unit: Unit,
  quantity: number,
  pcsPerCarton: number,
  boxPieces?: number | null,
): number {
  const n = cartonSize(pcsPerCarton);
  if (unit === Unit.CARTON) return quantity * n;
  if (unit === Unit.BOX) return quantity * effectiveBoxPieces(n, boxPieces);
  if (unit === Unit.DOZEN) return quantity * 12;
  return quantity; // PIECE
}

/**
 * The price of ONE `unit`, given the per-piece sale price — as a whole dinar.
 *
 * The rounding happens on the finished unit price, never on the per-piece
 * price: a piece at 833.33 must sell by the carton at exactly 10,000, and
 * rounding the piece first would make it 833 × 12 = 9,996.
 */
export function priceForUnit(
  unit: Unit,
  salePricePerPiece: unknown,
  pcsPerCarton: number,
  boxPieces?: number | null,
): number {
  const price = salePricePerPiece == null ? 0 : Number(salePricePerPiece);
  const n = cartonSize(pcsPerCarton);
  if (unit === Unit.CARTON) return roundMoney(price * n);
  if (unit === Unit.BOX) return roundMoney(price * effectiveBoxPieces(n, boxPieces));
  if (unit === Unit.DOZEN) return roundMoney(price * 12);
  return roundMoney(price); // PIECE
}
