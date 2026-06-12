-- Existing `branches` are retained as warehouse records for API compatibility.
-- Ensure old installations always have at least one warehouse.
INSERT INTO "branches" (
  "id", "name", "code", "is_active", "created_at", "updated_at"
)
SELECT gen_random_uuid(), 'المخزن الرئيسي', 'MAIN', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "branches");

-- Products without a location are assigned to the first active warehouse.
UPDATE "products"
SET "branch_id" = (
  SELECT "id" FROM "branches"
  ORDER BY "is_active" DESC, "created_at" ASC
  LIMIT 1
)
WHERE "branch_id" IS NULL;

CREATE TABLE "product_warehouse_stocks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "quantity_pieces" INTEGER NOT NULL DEFAULT 0,
  "storage_location" TEXT,
  "min_stock" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_warehouse_stocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_warehouse_stocks_product_id_warehouse_id_key"
  ON "product_warehouse_stocks"("product_id", "warehouse_id");
CREATE INDEX "product_warehouse_stocks_warehouse_id_idx"
  ON "product_warehouse_stocks"("warehouse_id");

ALTER TABLE "product_warehouse_stocks"
  ADD CONSTRAINT "product_warehouse_stocks_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_warehouse_stocks"
  ADD CONSTRAINT "product_warehouse_stocks_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the complete legacy balance into the product's selected warehouse.
INSERT INTO "product_warehouse_stocks" (
  "product_id", "warehouse_id", "quantity_pieces", "storage_location", "min_stock"
)
SELECT
  "id",
  "branch_id",
  "opening_balance_pcs" + ("cartons_available" * "pcs_per_carton"),
  "storage_location",
  "min_stock"
FROM "products"
WHERE "branch_id" IS NOT NULL
ON CONFLICT ("product_id", "warehouse_id") DO NOTHING;

ALTER TABLE "invoice_items" ADD COLUMN "warehouse_id" UUID;
UPDATE "invoice_items" AS ii
SET "warehouse_id" = p."branch_id"
FROM "products" AS p
WHERE p."id" = ii."product_id";
CREATE INDEX "invoice_items_warehouse_id_idx" ON "invoice_items"("warehouse_id");
ALTER TABLE "invoice_items"
  ADD CONSTRAINT "invoice_items_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
