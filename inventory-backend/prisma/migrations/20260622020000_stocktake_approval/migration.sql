-- Add approval columns to stocktake items
ALTER TABLE "stocktake_items" ADD COLUMN "approval_status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "stocktake_items" ADD COLUMN "approved_qty" INTEGER;

-- Index for approval status (for querying pending approvals)
CREATE INDEX "idx_stocktake_items_approval_status" ON "stocktake_items"("approval_status");
