-- Remember which depot a SALE line was pulled from (see InvoiceItem.sourceWarehouseId).
-- Additive and nullable: NULL means "sold straight from المحل".
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "source_warehouse_id" UUID;

-- Backfill from the automatic depot→المحل transfers that are still standing, so
-- invoices written before this column existed reopen with their depot too.
-- Only unambiguous cases: one (invoice, product) pair pulled from exactly one depot.
UPDATE "invoice_items" ii
SET "source_warehouse_id" = src.from_branch_id
FROM (
  SELECT t."source_invoice_id" AS invoice_id,
         ti."product_id"       AS product_id,
         MIN(t."from_branch_id"::text)::uuid AS from_branch_id
  FROM "inventory_transfers" t
  JOIN "transfer_items" ti ON ti."transfer_id" = t."id"
  WHERE t."source_invoice_id" IS NOT NULL
    AND t."status" = 'COMPLETED'
  GROUP BY t."source_invoice_id", ti."product_id"
  HAVING COUNT(DISTINCT t."from_branch_id") = 1
) src
WHERE ii."invoice_id" = src.invoice_id
  AND ii."product_id" = src.product_id
  AND ii."source_warehouse_id" IS NULL;
