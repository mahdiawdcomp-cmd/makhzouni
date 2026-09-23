import type { PriceMode, PublicCatalogProduct } from "../types/api"

export const PRICE_MODE_LABELS: Record<PriceMode, string> = { WHOLESALE: "جملة", RETAIL: "مفرد", CARTON: "توزيع كراتين" }

export function piecePriceFor(product: { salePrice: number; retailPrice?: number; cartonPiecePrice?: number | null }, mode: PriceMode): number {
  if (mode === "CARTON" && product.cartonPiecePrice != null) return Number(product.cartonPiecePrice)
  if (mode === "RETAIL" && Number(product.retailPrice) > 0) return Number(product.retailPrice)
  return Number(product.salePrice)
}

export function catalogProductForMode<T extends PublicCatalogProduct>(product: T, mode: "WHOLESALE" | "CARTON"): T {
  const wholesale = product.wholesalePiecePrice !== undefined ? product.wholesalePiecePrice : product.salePrice
  return { ...product, purchaseMode: mode, wholesalePiecePrice: wholesale, oldPrice: mode === "CARTON" ? null : product.oldPrice,
    salePrice: wholesale == null ? null : mode === "CARTON" ? Number(product.cartonPiecePrice ?? wholesale) : wholesale }
}
