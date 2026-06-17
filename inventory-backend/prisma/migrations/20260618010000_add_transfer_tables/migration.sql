-- The InventoryTransfer / TransferItem models were added to schema.prisma but a
-- migration was never generated, so the tables exist on machines that ran
-- `prisma db push` (local) but NOT on production (which runs `migrate deploy`).
-- This migration creates them idempotently. The Unit enum + stock_movements
-- already exist from the init migration.

-- TransferStatus enum (CREATE TYPE has no IF NOT EXISTS — guard it).
DO $$ BEGIN
  CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "inventory_transfers" (
  "id" UUID NOT NULL,
  "transfer_number" TEXT NOT NULL,
  "from_branch_id" UUID NOT NULL,
  "to_branch_id" UUID NOT NULL,
  "status" "TransferStatus" NOT NULL DEFAULT 'COMPLETED',
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_transfers_transfer_number_key" ON "inventory_transfers"("transfer_number");

CREATE TABLE IF NOT EXISTS "transfer_items" (
  "id" UUID NOT NULL,
  "transfer_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit" "Unit" NOT NULL,
  CONSTRAINT "transfer_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "transfer_items_transfer_id_idx" ON "transfer_items"("transfer_id");
CREATE INDEX IF NOT EXISTS "transfer_items_product_id_idx" ON "transfer_items"("product_id");

-- Foreign keys (guarded so a re-run / partially-pushed DB doesn't error).
DO $$ BEGIN
  ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "inventory_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
