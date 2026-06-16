-- #5 Order privacy: secret per-customer token to view own orders via a private
-- link instead of by phone number. Additive + nullable — safe on prod.

ALTER TABLE "retail_customers" ADD COLUMN IF NOT EXISTS "orders_token" VARCHAR(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'retail_customers_orders_token_key'
  ) THEN
    CREATE UNIQUE INDEX "retail_customers_orders_token_key" ON "retail_customers" ("orders_token");
  END IF;
END $$;
