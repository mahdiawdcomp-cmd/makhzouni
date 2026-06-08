-- Add cost_price and expiry_date to products
ALTER TABLE "products" ADD COLUMN "cost_price" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN "expiry_date" TIMESTAMP(3);

-- Add credit_limit to customers
ALTER TABLE "customers" ADD COLUMN "credit_limit" DECIMAL(12,2);

-- Add cost_price snapshot to invoice_items
ALTER TABLE "invoice_items" ADD COLUMN "cost_price" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Stocktake sessions table
CREATE TABLE "stocktake_sessions" (
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
CREATE TABLE "stocktake_items" (
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

-- Foreign keys
ALTER TABLE "stocktake_sessions" ADD CONSTRAINT "stocktake_sessions_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stocktake_sessions" ADD CONSTRAINT "stocktake_sessions_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stocktake_items" ADD CONSTRAINT "stocktake_items_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "stocktake_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stocktake_items" ADD CONSTRAINT "stocktake_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "stocktake_sessions_branch_id_idx" ON "stocktake_sessions"("branch_id");
CREATE INDEX "stocktake_sessions_created_by_idx" ON "stocktake_sessions"("created_by");
CREATE INDEX "stocktake_sessions_status_idx" ON "stocktake_sessions"("status");
CREATE INDEX "stocktake_items_session_id_idx" ON "stocktake_items"("session_id");
CREATE INDEX "stocktake_items_product_id_idx" ON "stocktake_items"("product_id");
