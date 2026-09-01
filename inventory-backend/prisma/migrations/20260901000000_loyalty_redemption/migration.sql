-- Loyalty redemption. Additive: no existing balance changes, and a shop that
-- never redeems sees no difference.

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "loyalty_excluded" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "loyalty_redemptions" (
  "id"          UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "points"      INTEGER NOT NULL,
  "value"       DECIMAL(12,2) NOT NULL,
  "point_value" DECIMAL(12,4) NOT NULL,
  "invoice_id"  UUID,
  "note"        TEXT,
  "created_by"  UUID NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reverted_at" TIMESTAMP(3),
  CONSTRAINT "loyalty_redemptions_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "loyalty_redemptions_customer_id_created_at_idx"
  ON "loyalty_redemptions"("customer_id", "created_at");
CREATE INDEX IF NOT EXISTS "loyalty_redemptions_invoice_id_idx"
  ON "loyalty_redemptions"("invoice_id");
