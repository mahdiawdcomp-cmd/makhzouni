-- Add cost_price and expiry_date to products (idempotent)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "cost_price" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "expiry_date" TIMESTAMP(3);

-- Add credit_limit to customers
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "credit_limit" DECIMAL(12,2);

-- Add cost_price snapshot to invoice_items
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "cost_price" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Stocktake sessions table
CREATE TABLE IF NOT EXISTS "stocktake_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    CONSTRAINT "stocktake_sessions_pkey" PRIMARY KEY ("id")
);

-- Stocktake items table
CREATE TABLE IF NOT EXISTS "stocktake_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "system_qty" INTEGER NOT NULL DEFAULT 0,
    "actual_qty" INTEGER,
    "variance" INTEGER,
    "notes" TEXT,
    CONSTRAINT "stocktake_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stocktake_items_session_product_unique" UNIQUE ("session_id", "product_id")
);

-- Foreign keys (idempotent via DO block)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stocktake_sessions_branch_id_fkey') THEN
    ALTER TABLE "stocktake_sessions" ADD CONSTRAINT "stocktake_sessions_branch_id_fkey"
      FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stocktake_sessions_created_by_fkey') THEN
    ALTER TABLE "stocktake_sessions" ADD CONSTRAINT "stocktake_sessions_created_by_fkey"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stocktake_items_session_id_fkey') THEN
    ALTER TABLE "stocktake_items" ADD CONSTRAINT "stocktake_items_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "stocktake_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stocktake_items_product_id_fkey') THEN
    ALTER TABLE "stocktake_items" ADD CONSTRAINT "stocktake_items_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexes (idempotent)
CREATE INDEX IF NOT EXISTS "stocktake_sessions_branch_id_idx" ON "stocktake_sessions"("branch_id");
CREATE INDEX IF NOT EXISTS "stocktake_sessions_created_by_idx" ON "stocktake_sessions"("created_by");
CREATE INDEX IF NOT EXISTS "stocktake_sessions_status_idx" ON "stocktake_sessions"("status");
CREATE INDEX IF NOT EXISTS "stocktake_items_session_id_idx" ON "stocktake_items"("session_id");
CREATE INDEX IF NOT EXISTS "stocktake_items_product_id_idx" ON "stocktake_items"("product_id");
