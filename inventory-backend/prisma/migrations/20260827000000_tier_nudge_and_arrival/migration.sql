-- «كنت قريب» nudge bookkeeping, and the arrival half of «البضاعة القادمة».
-- All additive and nullable: existing rows and queries are untouched.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "tier_nudge_sent_at" TIMESTAMP(3);
ALTER TABLE "catalog_incoming_items" ADD COLUMN IF NOT EXISTS "arrived_at" TIMESTAMP(3);
ALTER TABLE "catalog_incoming_items" ADD COLUMN IF NOT EXISTS "product_id" UUID;
