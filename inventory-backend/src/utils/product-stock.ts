// Unified stock source: sum quantityPieces across all warehouses from
// ProductWarehouseStock.
//
// There used to be a fallback here: a product with no warehouse rows reported
// `openingBalancePcs + cartonsAvailable * pcsPerCarton` "so it doesn't vanish
// from public catalogs". Those two legacy fields are NEVER decremented by a
// sale, so the fallback reported day-one quantities forever — sold-out goods
// kept showing as available in the catalog and in every value/profit figure
// built on top of this number. No warehouse row means zero, not "unknown, use
// the old number". Use `legacyOnlyStock()` to REPORT products that still carry
// a legacy quantity, never to sell them.
export type StockSource = {
  openingBalancePcs: number;
  cartonsAvailable: number;
  pcsPerCarton: number;
  warehouseStocks?: Array<{ quantityPieces: number }>;
};

export function totalStock(product: StockSource): number {
  return product.warehouseStocks?.reduce((sum, row) => sum + row.quantityPieces, 0) ?? 0;
}

/**
 * The quantity the legacy fields claim. Only meaningful for products that have
 * no warehouse rows at all — those are the ones whose stock was never migrated
 * and which now correctly read zero everywhere.
 */
export function legacyOnlyStock(product: StockSource): number {
  if (product.warehouseStocks && product.warehouseStocks.length > 0) return 0;
  return product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton;
}
