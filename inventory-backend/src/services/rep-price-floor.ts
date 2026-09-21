/**
 * The two price floors a rep's edit is held to, answered as yes/no only.
 *
 * Kept in its own file on purpose. This is the ONE place on the rep's side that
 * reads what the shop paid for a product, and it hands back nothing but line
 * indexes. The rep-facing services never import a cost column, and the guard
 * test that forbids cost names in them keeps working — a later edit that tried
 * to return a cost from here would have to change this file's signature to do
 * it, which is where a reviewer looks.
 *
 * The rules, as the owner set them:
 *   - a discount of up to 6% off the catalog price is the rep's to give;
 *   - more than that needs the owner;
 *   - selling below cost needs the owner even inside the 6% — on a thin-margin
 *     product 6% is already a loss, and the rep cannot see that;
 *   - RAISING a price is not limited. It costs the shop nothing.
 */
import { Unit } from "@prisma/client";
import prisma from "../config/database";
import { priceForUnit } from "../utils/catalog-units";

/** The most a rep may take off the catalog price on their own. */
export const REP_MAX_DISCOUNT = 0.06;

export type PricedLine = {
  productId: string;
  unit: Unit;
  unitPrice: number;
};

export type FloorResult = {
  /** Lines discounted more than REP_MAX_DISCOUNT below the catalog price. */
  overDiscount: number[];
  /** Lines priced below what the shop paid. Indexes only — never the cost. */
  belowCost: number[];
  /** Lines whose product is gone or unreadable: the owner must look at them. */
  unknown: number[];
};

/**
 * Check every line against both floors.
 *
 * `priceMode` is the invoice's own — a carton-distribution invoice is compared
 * with the carton price, not the wholesale one it would otherwise undercut.
 *
 * A tolerance of one dinar absorbs rounding on per-piece prices multiplied up to
 * a carton; without it a rep re-typing the exact catalog price could trip the
 * rule on a fraction.
 */
export async function checkRepPriceFloors(
  lines: PricedLine[],
  priceMode: string,
): Promise<FloorResult> {
  const result: FloorResult = { overDiscount: [], belowCost: [], unknown: [] };
  if (lines.length === 0) return result;

  const ids = [...new Set(lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      salePrice: true,
      cartonPiecePrice: true,
      costPrice: true,
      pcsPerCarton: true,
      boxPieces: true,
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  lines.forEach((line, index) => {
    const product = byId.get(line.productId);
    if (!product) {
      result.unknown.push(index);
      return;
    }
    const perPiece =
      priceMode === "CARTON" && product.cartonPiecePrice != null
        ? Number(product.cartonPiecePrice)
        : Number(product.salePrice);
    const catalog = priceForUnit(line.unit, perPiece, product.pcsPerCarton, product.boxPieces);
    const cost = priceForUnit(line.unit, product.costPrice, product.pcsPerCarton, product.boxPieces);

    if (catalog > 0 && line.unitPrice < catalog * (1 - REP_MAX_DISCOUNT) - 1) {
      result.overDiscount.push(index);
    }
    // A product with no recorded cost (0) is not "below cost" — there is no
    // floor to fall under, and flagging every such line would send every edit
    // to the owner for a missing number the rep cannot fix.
    if (cost > 0 && line.unitPrice < cost - 1) {
      result.belowCost.push(index);
    }
  });

  return result;
}
