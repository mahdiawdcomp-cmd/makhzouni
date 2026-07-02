// Unified stock source: sum quantityPieces across all warehouses from
// ProductWarehouseStock. Products created before the warehouse-stock system may
// have no rows at all — for those we fall back to the legacy Product fields so
// they don't vanish from public catalogs.
export type StockSource = {
  openingBalancePcs: number;
  cartonsAvailable: number;
  pcsPerCarton: number;
  warehouseStocks?: Array<{ quantityPieces: number }>;
};

export function totalStock(product: StockSource): number {
  const rows = product.warehouseStocks;
  if (rows && rows.length > 0) {
    return rows.reduce((sum, row) => sum + row.quantityPieces, 0);
  }
  return product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton;
}
