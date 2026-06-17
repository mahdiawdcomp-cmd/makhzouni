import { AppError } from "./app-error";
import { amountInPieces } from "./financial";

export type DistributionEntry = { warehouseId: string; pieces: number };

/** Total pieces across a warehouse-distribution list (ignores non-positive). */
export function distributionTotal(entries: DistributionEntry[]): number {
  return entries.reduce((sum, e) => sum + (e.pieces > 0 ? e.pieces : 0), 0);
}

/**
 * Keep only positive entries and assert their sum equals the product's total
 * opening pieces. Used when creating a product with a per-warehouse split.
 * Throws DISTRIBUTION_MISMATCH (400) when the sum differs.
 */
export function validateDistribution(entries: DistributionEntry[], totalPieces: number): DistributionEntry[] {
  const positive = entries.filter((e) => e.pieces > 0);
  const sum = distributionTotal(positive);
  if (sum !== totalPieces) {
    throw new AppError(
      `مجموع التوزيع (${sum}) لا يساوي الكمية الكلية (${totalPieces}). صحّح التوزيع قبل الحفظ.`,
      400,
      "DISTRIBUTION_MISMATCH"
    );
  }
  return positive;
}

/** True when a requested quantity (in the given unit) exceeds available pieces. */
export function requestExceedsStock(
  unit: "PIECE" | "DOZEN" | "CARTON",
  quantity: number,
  pcsPerCarton: number,
  availablePieces: number
): boolean {
  return amountInPieces(unit, quantity, pcsPerCarton) > availablePieces;
}
