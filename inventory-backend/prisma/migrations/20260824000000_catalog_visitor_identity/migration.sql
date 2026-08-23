-- Catalog visitors become a standing identity of their own: they browse and
-- order without a Customer row ever being created for them. Everything here is
-- additive and nullable, so existing rows and every existing query are
-- untouched.
ALTER TABLE "catalog_visitors" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "catalog_visitors" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "catalog_visitors" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "catalog_visitors" ADD COLUMN IF NOT EXISTS "province" TEXT;
ALTER TABLE "catalog_visitors" ADD COLUMN IF NOT EXISTS "business_type" TEXT;
ALTER TABLE "catalog_visitors" ADD COLUMN IF NOT EXISTS "session_token_hash" TEXT;
ALTER TABLE "catalog_visitors" ADD COLUMN IF NOT EXISTS "session_issued_at" TIMESTAMP(3);
ALTER TABLE "catalog_visitors" ADD COLUMN IF NOT EXISTS "prices_unlocked_at" TIMESTAMP(3);
ALTER TABLE "catalog_visitors" ADD COLUMN IF NOT EXISTS "price_requested_at" TIMESTAMP(3);
ALTER TABLE "catalog_visitors" ADD COLUMN IF NOT EXISTS "customer_id" UUID;

CREATE INDEX IF NOT EXISTS "catalog_visitors_session_token_hash_idx"
  ON "catalog_visitors"("session_token_hash");
