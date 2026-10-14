-- Stocktake review audit fields: who approved/rejected an item, when, and the
-- reject reason. All nullable (legacy + still-PENDING rows have none). Idempotent
-- to match the startup-migration safety net in src/config/startup-migrations.ts.
ALTER TABLE "stocktake_items" ADD COLUMN IF NOT EXISTS "reviewed_by" UUID;
ALTER TABLE "stocktake_items" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3);
ALTER TABLE "stocktake_items" ADD COLUMN IF NOT EXISTS "reject_reason" TEXT;
