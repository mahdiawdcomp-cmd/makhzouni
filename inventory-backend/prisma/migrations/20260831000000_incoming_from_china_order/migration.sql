-- A China order can be confirmed before its shipment lands. Everything here is
-- additive: existing batches keep their status and existing incoming items keep
-- their NULLs, so nothing already on the books changes meaning.

ALTER TYPE "LandedCostBatchStatus" ADD VALUE IF NOT EXISTS 'AWAITING_ARRIVAL' BEFORE 'PURCHASE_INVOICE_CREATED';

ALTER TABLE "landed_cost_import_batches"
  ADD COLUMN IF NOT EXISTS "expected_arrival_at"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "arrival_supplier_id"  UUID,
  ADD COLUMN IF NOT EXISTS "arrival_warehouse_id" UUID,
  ADD COLUMN IF NOT EXISTS "arrival_payment_type" "PaymentType",
  ADD COLUMN IF NOT EXISTS "arrival_paid_amount"  DECIMAL(12,2);

-- Per row, because a shipment can land in parts. Rows of batches that were
-- already applied are backfilled so they are never re-applied on arrival.
ALTER TABLE "landed_cost_import_items"
  ADD COLUMN IF NOT EXISTS "applied_at" TIMESTAMP(3);

UPDATE "landed_cost_import_items" i
SET "applied_at" = COALESCE(b."applied_at", b."created_at")
FROM "landed_cost_import_batches" b
WHERE i."batch_id" = b."id"
  AND b."status" = 'PURCHASE_INVOICE_CREATED'
  AND i."applied_at" IS NULL;

ALTER TABLE "catalog_incoming_items"
  ADD COLUMN IF NOT EXISTS "quantity_pieces"      INTEGER,
  ADD COLUMN IF NOT EXISTS "pcs_per_carton"       INTEGER,
  ADD COLUMN IF NOT EXISTS "category"             TEXT,
  ADD COLUMN IF NOT EXISTS "source_batch_id"      UUID,
  ADD COLUMN IF NOT EXISTS "source_batch_item_id" UUID;

CREATE INDEX IF NOT EXISTS "catalog_incoming_items_source_batch_id_idx"
  ON "catalog_incoming_items"("source_batch_id");
