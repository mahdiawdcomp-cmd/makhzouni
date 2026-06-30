-- Snapshot the product item number on each invoice line so old invoices keep
-- showing it after a product is soft-deleted.
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "item_number" TEXT;

-- Backfill existing rows from the linked product.
UPDATE "invoice_items" ii
SET "item_number" = p."item_number"
FROM "products" p
WHERE ii."product_id" = p."id" AND ii."item_number" IS NULL;
