-- Phase 2: Database integrity fixes
-- Fix 1: Add costPrice snapshot to stock_loss_items
ALTER TABLE "stock_loss_items" ADD COLUMN IF NOT EXISTS "cost_price" DECIMAL(12,2);

-- Fix 2a: Add transferId to stock_movements (traceable back to the transfer)
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "transfer_id" UUID;
CREATE INDEX IF NOT EXISTS "stock_movements_transfer_id_idx" ON "stock_movements"("transfer_id");
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stock_movements_transfer_id_fkey'
  ) THEN
    ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_id_fkey"
      FOREIGN KEY ("transfer_id") REFERENCES "inventory_transfers"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Fix 2b: Add index on loss_id in stock_movements (orphaned column now indexed)
CREATE INDEX IF NOT EXISTS "stock_movements_loss_id_idx" ON "stock_movements"("loss_id");

-- Fix 3a: Convert StocktakeSession.status String -> enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StocktakeSessionStatus') THEN
    CREATE TYPE "StocktakeSessionStatus" AS ENUM ('OPEN', 'SUBMITTED', 'CLOSED');
  END IF;
END $$;
ALTER TABLE "stocktake_sessions" ALTER COLUMN "status" DROP DEFAULT;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stocktake_sessions'
      AND column_name = 'status'
      AND udt_name <> 'StocktakeSessionStatus'
  ) THEN
    UPDATE "stocktake_sessions"
    SET "status" = 'OPEN'
    WHERE "status" NOT IN ('OPEN', 'SUBMITTED', 'CLOSED');

    ALTER TABLE "stocktake_sessions"
      ALTER COLUMN "status" TYPE "StocktakeSessionStatus"
      USING "status"::text::"StocktakeSessionStatus";
  END IF;
END $$;
ALTER TABLE "stocktake_sessions" ALTER COLUMN "status" SET DEFAULT 'OPEN'::"StocktakeSessionStatus";

-- Fix 3b: Convert StocktakeItem.approvalStatus String -> enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StocktakeApprovalStatus') THEN
    CREATE TYPE "StocktakeApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
  END IF;
END $$;
ALTER TABLE "stocktake_items" ALTER COLUMN "approval_status" DROP DEFAULT;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stocktake_items'
      AND column_name = 'approval_status'
      AND udt_name <> 'StocktakeApprovalStatus'
  ) THEN
    UPDATE "stocktake_items"
    SET "approval_status" = 'PENDING'
    WHERE "approval_status" NOT IN ('PENDING', 'APPROVED', 'REJECTED');

    ALTER TABLE "stocktake_items"
      ALTER COLUMN "approval_status" TYPE "StocktakeApprovalStatus"
      USING "approval_status"::text::"StocktakeApprovalStatus";
  END IF;
END $$;
ALTER TABLE "stocktake_items" ALTER COLUMN "approval_status" SET DEFAULT 'PENDING'::"StocktakeApprovalStatus";

-- Fix 3c: Convert RetailOrder.status String -> enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RetailOrderStatus') THEN
    CREATE TYPE "RetailOrderStatus" AS ENUM ('PENDING', 'PROCESSING', 'FAILED', 'PREPARED', 'CANCELLED');
  END IF;
END $$;
ALTER TABLE "retail_orders" ALTER COLUMN "status" DROP DEFAULT;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'retail_orders'
      AND column_name = 'status'
      AND udt_name <> 'RetailOrderStatus'
  ) THEN
    UPDATE "retail_orders"
    SET "status" = 'FAILED'
    WHERE "status" NOT IN ('PENDING', 'PROCESSING', 'FAILED', 'PREPARED', 'CANCELLED');

    ALTER TABLE "retail_orders"
      ALTER COLUMN "status" TYPE "RetailOrderStatus"
      USING "status"::text::"RetailOrderStatus";
  END IF;
END $$;
ALTER TABLE "retail_orders" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"RetailOrderStatus";

-- Fix 3d: Convert OrderPreparation.status String -> enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderPreparationStatus') THEN
    CREATE TYPE "OrderPreparationStatus" AS ENUM ('PENDING', 'CANCELLED', 'PREPARED');
  END IF;
END $$;
ALTER TABLE "order_preparations" ALTER COLUMN "status" DROP DEFAULT;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'order_preparations'
      AND column_name = 'status'
      AND udt_name <> 'OrderPreparationStatus'
  ) THEN
    UPDATE "order_preparations"
    SET "status" = 'PENDING'
    WHERE "status" NOT IN ('PENDING', 'CANCELLED', 'PREPARED');

    ALTER TABLE "order_preparations"
      ALTER COLUMN "status" TYPE "OrderPreparationStatus"
      USING "status"::text::"OrderPreparationStatus";
  END IF;
END $$;
ALTER TABLE "order_preparations" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"OrderPreparationStatus";
