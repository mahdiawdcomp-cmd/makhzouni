-- China fixed-template order pricing (additive only, all columns nullable).
-- Batch-level screen inputs + per-item CNY/CBM/USD values. Deliberately NOT a
-- general currency/exchange-rate system — these numbers live only inside a
-- landed-cost batch.

ALTER TABLE "landed_cost_import_batches"
  ADD COLUMN IF NOT EXISTS "cbm_price_usd" DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS "office_percent" DECIMAL(6,3),
  ADD COLUMN IF NOT EXISTS "cny_per_usd" DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS "usd_to_iqd" DECIMAL(12,4);

ALTER TABLE "landed_cost_import_items"
  ADD COLUMN IF NOT EXISTS "pieces_per_carton" INTEGER,
  ADD COLUMN IF NOT EXISTS "unit_price_cny" DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS "carton_cbm" DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS "carton_cost_usd" DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS "unit_cost_usd" DECIMAL(12,4);
