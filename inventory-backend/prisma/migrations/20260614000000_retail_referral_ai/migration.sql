-- AddColumn referral_code + referred_by to retail_customers
ALTER TABLE "retail_customers"
  ADD COLUMN IF NOT EXISTS "referral_code" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "referred_by"   VARCHAR(20);

-- Unique index on referral_code (only if column doesn't already have one)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'retail_customers' AND indexname = 'retail_customers_referral_code_key'
  ) THEN
    CREATE UNIQUE INDEX retail_customers_referral_code_key ON "retail_customers"("referral_code");
  END IF;
END $$;

-- AddColumn referral_discount + referral_code to retail_orders
ALTER TABLE "retail_orders"
  ADD COLUMN IF NOT EXISTS "referral_discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "referral_code"     VARCHAR(20);
