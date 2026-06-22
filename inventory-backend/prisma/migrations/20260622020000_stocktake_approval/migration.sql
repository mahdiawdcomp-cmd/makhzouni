-- Add approval columns to stocktake items
ALTER TABLE "stocktake_items" ADD COLUMN IF NOT EXISTS "approval_status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "stocktake_items" ADD COLUMN IF NOT EXISTS "approved_qty" INTEGER;

-- Index for approval status (for querying pending approvals)
CREATE INDEX IF NOT EXISTS "idx_stocktake_items_approval_status" ON "stocktake_items"("approval_status");
