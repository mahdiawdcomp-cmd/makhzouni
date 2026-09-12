import { AppError } from "./app-error";

export type PriceMode = "WHOLESALE" | "RETAIL" | "CARTON";
export type PricedProduct = { salePrice: unknown; retailPrice?: unknown; cartonPiecePrice?: unknown };

export function piecePriceFor(product: PricedProduct, mode: PriceMode = "WHOLESALE"): number {
  if (mode === "CARTON" && product.cartonPiecePrice != null) return Number(product.cartonPiecePrice);
  if (mode === "RETAIL" && Number(product.retailPrice) > 0) return Number(product.retailPrice);
  return Number(product.salePrice ?? 0);
}

export function assertCartonPrice(salePrice: unknown, cartonPiecePrice: unknown) {
  if (cartonPiecePrice == null) return;
  const carton = Number(cartonPiecePrice);
  if (!Number.isFinite(carton) || carton <= 0 || carton > Number(salePrice ?? 0)) {
    throw new AppError("سعر القطعة بالكارتون يجب أن يكون أكبر من صفر ولا يتجاوز سعر الجملة", 400, "INVALID_CARTON_PRICE");
  }
}

export function assertCatalogUnits(items: Array<{ productId: string; unit: string; quantity: number; isSample?: boolean }>, mode?: PriceMode) {
  const samples = new Set<string>();
  for (const item of items) {
    if (item.isSample) {
      if (item.unit !== "PIECE" || item.quantity !== 1 || samples.has(item.productId)) {
        throw new AppError("العينة قطعة واحدة لكل مادة", 400, "INVALID_SAMPLE");
      }
      samples.add(item.productId);
    } else if (mode === "CARTON" && item.unit !== "CARTON") {
      throw new AppError("بوضع الكراتين يمكن شراء كارتون كامل فقط", 400, "CARTON_ONLY");
    }
  }
}
