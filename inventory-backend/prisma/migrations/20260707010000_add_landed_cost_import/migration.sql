-- Landed-Cost Excel Import (additive only). Nothing here touches existing
-- tables except adding one nullable FK column to invoices for traceability.
-- Stock/product data is never written by this feature directly — only the
-- existing invoice-creation flow (called when the user confirms the priced
-- order as a purchase invoice) ever changes stock.

CREATE TYPE "LandedCostBatchStatus" AS ENUM ('DRAFT_PRICED', 'REVIEWING_ITEMS', 'PURCHASE_INVOICE_CREATED', 'CANCELLED');
CREATE TYPE "LandedCostMatchStatus" AS ENUM ('MATCHED', 'NOT_FOUND', 'AMBIGUOUS');
CREATE TYPE "LandedCostAllocationMethod" AS ENUM ('BY_QUANTITY', 'BY_VALUE', 'BY_CARTON');
CREATE TYPE "LandedCostItemAction" AS ENUM ('PENDING', 'LINK_EXISTING', 'CREATE_NEW', 'SKIP');

CREATE TABLE IF NOT EXISTS "landed_cost_import_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "invoice_number" TEXT,
  "supplier" TEXT,
  "allocation_method" "LandedCostAllocationMethod" NOT NULL DEFAULT 'BY_VALUE',
  "total_extra_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "freight" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "customs" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "local_transport" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "unloading" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "commission" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "other_costs" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "note" TEXT,
  "status" "LandedCostBatchStatus" NOT NULL DEFAULT 'DRAFT_PRICED',
  "original_file_name" TEXT,
  "purchase_invoice_id" UUID,
  "created_by" UUID NOT NULL,
  "applied_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_at" TIMESTAMP(3),
  CONSTRAINT "landed_cost_import_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "landed_cost_import_batches_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "landed_cost_import_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "landed_cost_import_batches_applied_by_fkey" FOREIGN KEY ("applied_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "landed_cost_import_batches_created_by_idx" ON "landed_cost_import_batches" ("created_by");
CREATE INDEX IF NOT EXISTS "landed_cost_import_batches_status_idx" ON "landed_cost_import_batches" ("status");

CREATE TABLE IF NOT EXISTS "landed_cost_import_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" UUID NOT NULL,
  "product_id" UUID,
  "item_code" TEXT NOT NULL,
  "product_name" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "carton_count" INTEGER,
  "purchase_price" DECIMAL(12,2) NOT NULL,
  "allocated_extra_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "landed_cost_per_unit" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "landed_cost_per_carton" DECIMAL(12,2),
  "suggested_sale_price" DECIMAL(12,2),
  "confirmed_sale_price" DECIMAL(12,2),
  "expected_profit" DECIMAL(12,2),
  "match_status" "LandedCostMatchStatus" NOT NULL DEFAULT 'NOT_FOUND',
  "action" "LandedCostItemAction" NOT NULL DEFAULT 'PENDING',
  "new_product_draft" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "landed_cost_import_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "landed_cost_import_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "landed_cost_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "landed_cost_import_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "landed_cost_import_items_batch_id_idx" ON "landed_cost_import_items" ("batch_id");
CREATE INDEX IF NOT EXISTS "landed_cost_import_items_product_id_idx" ON "landed_cost_import_items" ("product_id");
