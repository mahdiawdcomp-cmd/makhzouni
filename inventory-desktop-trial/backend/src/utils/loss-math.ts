import { Unit } from "@prisma/client";
import { AppError } from "./app-error";

/**
 * Convert a stock-loss line quantity into pieces, rejecting any non-positive,
 * non-finite (NaN/Infinity) quantity and any unrecognised unit. This is the
 * single guard that keeps a damaged-goods record from ever *increasing* stock
 * (negative quantity) or corrupting it (NaN). Mirrors the unit math used by
 * sales/transfers but is intentionally strict because a loss only ever removes
 * stock.
 */
export function lossUnitToPieces(unit: Unit, quantity: number, pcsPerCarton: number): number {
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
    throw new AppError("الكمية يجب أن تكون رقمًا موجبًا", 400, "INVALID_LOSS_QUANTITY");
  }
  const ppc = Number.isFinite(pcsPerCarton) && pcsPerCarton > 0 ? pcsPerCarton : 1;
  if (unit === "CARTON") return quantity * ppc;
  if (unit === "DOZEN") return quantity * 12;
  if (unit === "PIECE") return quantity;
  throw new AppError("وحدة غير صحيحة", 400, "INVALID_LOSS_UNIT");
}
