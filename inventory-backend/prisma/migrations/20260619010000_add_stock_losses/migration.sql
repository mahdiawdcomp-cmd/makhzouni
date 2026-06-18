-- Add DAMAGE to StockMovementType enum
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'DAMAGE';

-- Add LossReason enum
DO $$ BEGIN
  CREATE TYPE "LossReason" AS ENUM ('DAMAGE', 'EXPIRY', 'THEFT', 'DEFECT', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Add lossId to stock_movements
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "loss_id" UUID;

-- Create stock_losses table
CREATE TABLE IF NOT EXISTS "stock_losses" (
  "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
  "loss_number"  TEXT         NOT NULL,
  "date"         TIMESTAMP(3) NOT NULL,
  "warehouse_id" UUID         NOT NULL,
  "reason"       "LossReason" NOT NULL DEFAULT 'DAMAGE',
  "notes"        TEXT,
  "cancelled_at" TIMESTAMP(3),
  "created_by"   UUID         NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stock_losses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_losses_loss_number_key" ON "stock_losses"("loss_number");
CREATE INDEX IF NOT EXISTS "stock_losses_date_idx"         ON "stock_losses"("date");
CREATE INDEX IF NOT EXISTS "stock_losses_warehouse_id_idx" ON "stock_losses"("warehouse_id");

ALTER TABLE "stock_losses"
  ADD CONSTRAINT "stock_losses_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_losses"
  ADD CONSTRAINT "stock_losses_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create stock_loss_items table
CREATE TABLE IF NOT EXISTS "stock_loss_items" (
  "id"           UUID    NOT NULL DEFAULT gen_random_uuid(),
  "loss_id"      UUID    NOT NULL,
  "product_id"   UUID    NOT NULL,
  "product_name" TEXT    NOT NULL,
  "unit"         "Unit"  NOT NULL,
  "quantity"     INTEGER NOT NULL,

  CONSTRAINT "stock_loss_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "stock_loss_items_loss_id_idx"    ON "stock_loss_items"("loss_id");
CREATE INDEX IF NOT EXISTS "stock_loss_items_product_id_idx" ON "stock_loss_items"("product_id");

ALTER TABLE "stock_loss_items"
  ADD CONSTRAINT "stock_loss_items_loss_id_fkey"
    FOREIGN KEY ("loss_id") REFERENCES "stock_losses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_loss_items"
  ADD CONSTRAINT "stock_loss_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
