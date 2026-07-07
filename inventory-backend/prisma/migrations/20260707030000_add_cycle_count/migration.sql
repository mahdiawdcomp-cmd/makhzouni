-- "جدولة الجرد الذكي" (scheduled smart cycle count) — fully independent,
-- additive-only feature. Does NOT touch stocktake_sessions / stocktake_items
-- (the manual "الجرد الدوري" tables) in any way — separate tables, separate
-- enums, separate FKs. Stock is only ever adjusted after per-item approval,
-- exactly like the existing manual stocktake flow.

CREATE TYPE "CycleCountSessionStatus" AS ENUM ('OPEN', 'SUBMITTED', 'CLOSED', 'CANCELLED');
CREATE TYPE "CycleCountSessionSource" AS ENUM ('MANUAL', 'SCHEDULED');
CREATE TYPE "CycleCountApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "CycleCountStrategy" AS ENUM ('RANDOM', 'HIGH_VALUE', 'FAST_MOVING', 'LOW_STOCK', 'LEAST_RECENTLY_COUNTED');

CREATE TABLE IF NOT EXISTS "cycle_count_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "warehouse_id" UUID NOT NULL,
  "status" "CycleCountSessionStatus" NOT NULL DEFAULT 'OPEN',
  "strategy" "CycleCountStrategy" NOT NULL,
  "item_limit" INTEGER NOT NULL,
  "scheduled_for" TIMESTAMP(3),
  "source" "CycleCountSessionSource" NOT NULL DEFAULT 'MANUAL',
  "created_by" UUID NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  CONSTRAINT "cycle_count_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cycle_count_sessions_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "cycle_count_sessions_warehouse_id_idx" ON "cycle_count_sessions" ("warehouse_id");
CREATE INDEX IF NOT EXISTS "cycle_count_sessions_status_idx" ON "cycle_count_sessions" ("status");
CREATE INDEX IF NOT EXISTS "cycle_count_sessions_created_by_idx" ON "cycle_count_sessions" ("created_by");

CREATE TABLE IF NOT EXISTS "cycle_count_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "system_qty" INTEGER NOT NULL,
  "actual_qty" INTEGER,
  "variance" INTEGER,
  "approval_status" "CycleCountApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "approved_qty" INTEGER,
  "approved_by" UUID,
  "approved_at" TIMESTAMP(3),
  "notes" TEXT,
  CONSTRAINT "cycle_count_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cycle_count_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "cycle_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_items_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "cycle_count_items_session_id_product_id_key" UNIQUE ("session_id", "product_id")
);

CREATE INDEX IF NOT EXISTS "cycle_count_items_session_id_idx" ON "cycle_count_items" ("session_id");
CREATE INDEX IF NOT EXISTS "cycle_count_items_product_id_idx" ON "cycle_count_items" ("product_id");
CREATE INDEX IF NOT EXISTS "cycle_count_items_approval_status_idx" ON "cycle_count_items" ("approval_status");
