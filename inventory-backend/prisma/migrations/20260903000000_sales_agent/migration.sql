-- «المندوب» — sales rep attribution. Every column is additive and nullable, so
-- existing rows and every code path that never sets them keep working unchanged.

-- The rep a customer belongs to, plus the in-city area (distinct from province,
-- which stays the governorate).
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "sales_agent_id" UUID;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "area" TEXT;

-- The rep a sale is credited to. Deliberately separate from created_by: the
-- invoice is created by whoever approves the order, the sale belongs to the rep.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "sales_agent_id" UUID;

-- The rep who physically collected the cash. Attribution only — the voucher's
-- effect on the customer balance is untouched.
ALTER TABLE "payment_vouchers" ADD COLUMN IF NOT EXISTS "sales_agent_id" UUID;

CREATE INDEX IF NOT EXISTS "customers_sales_agent_id_idx" ON "customers"("sales_agent_id");
CREATE INDEX IF NOT EXISTS "invoices_sales_agent_id_idx" ON "invoices"("sales_agent_id");
CREATE INDEX IF NOT EXISTS "payment_vouchers_sales_agent_id_idx" ON "payment_vouchers"("sales_agent_id");

DO $$ BEGIN
  ALTER TABLE "customers" ADD CONSTRAINT "customers_sales_agent_id_fkey"
    FOREIGN KEY ("sales_agent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sales_agent_id_fkey"
    FOREIGN KEY ("sales_agent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_sales_agent_id_fkey"
    FOREIGN KEY ("sales_agent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
