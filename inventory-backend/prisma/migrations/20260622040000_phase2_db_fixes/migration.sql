-- Phase 2: Database integrity fixes
-- Fix 1: Add costPrice snapshot to stock_loss_items
ALTER TABLE "stock_loss_items" ADD COLUMN IF NOT EXISTS "cost_price" DECIMAL(12,2);

-- Fix 2a: Add transferId to stock_movements (traceable back to the transfer)
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "transfer_id" UUID;
CREATE INDEX IF NOT EXISTS "stock_movements_transfer_id_idx" ON "stock_movements"("transfer_id");
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_id_fkey"
  FOREIGN KEY ("transfer_id") REFERENCES "inventory_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Fix 2b: Add index on loss_id in stock_movements (orphaned column now indexed)
CREATE INDEX IF NOT EXISTS "stock_movements_loss_id_idx" ON "stock_movements"("loss_id");

-- Fix 3a: Convert StocktakeSession.status String -> enum
CREATE TYPE "StocktakeSessionStatus" AS ENUM ('OPEN', 'SUBMITTED', 'CLOSED');
ALTER TABLE "stocktake_sessions"
  ALTER COLUMN "status" TYPE "StocktakeSessionStatus"
  USING "status"::"StocktakeSessionStatus";
ALTER TABLE "stocktake_sessions" ALTER COLUMN "status" SET DEFAULT 'OPEN'::"StocktakeSessionStatus";

-- Fix 3b: Convert StocktakeItem.approvalStatus String -> enum
CREATE TYPE "StocktakeApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
ALTER TABLE "stocktake_items"
  ALTER COLUMN "approval_status" TYPE "StocktakeApprovalStatus"
  USING "approval_status"::"StocktakeApprovalStatus";
ALTER TABLE "stocktake_items" ALTER COLUMN "approval_status" SET DEFAULT 'PENDING'::"StocktakeApprovalStatus";

-- Fix 3c: Convert RetailOrder.status String -> enum
CREATE TYPE "RetailOrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'FAILED', 'PREPARED', 'CANCELLED');
ALTER TABLE "retail_orders"
  ALTER COLUMN "status" TYPE "RetailOrderStatus"
  USING "status"::"RetailOrderStatus";
ALTER TABLE "retail_orders" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"RetailOrderStatus";

-- Fix 3d: Convert OrderPreparation.status String -> enum
CREATE TYPE "OrderPreparationStatus" AS ENUM ('PENDING', 'CANCELLED', 'PREPARED');
ALTER TABLE "order_preparations"
  ALTER COLUMN "status" TYPE "OrderPreparationStatus"
  USING "status"::"OrderPreparationStatus";
ALTER TABLE "order_preparations" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"OrderPreparationStatus";
