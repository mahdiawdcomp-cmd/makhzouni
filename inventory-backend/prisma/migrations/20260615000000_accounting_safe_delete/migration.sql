-- Accounting-safe deletion: invoices and payment vouchers are never physically
-- removed. Add archive metadata columns (all nullable, additive — safe on prod).

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "deleted_by" UUID;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "delete_reason" TEXT;
CREATE INDEX IF NOT EXISTS "invoices_archived_at_idx" ON "invoices" ("archived_at");

ALTER TABLE "payment_vouchers" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);
ALTER TABLE "payment_vouchers" ADD COLUMN IF NOT EXISTS "deleted_by" UUID;
ALTER TABLE "payment_vouchers" ADD COLUMN IF NOT EXISTS "delete_reason" TEXT;
CREATE INDEX IF NOT EXISTS "payment_vouchers_archived_at_idx" ON "payment_vouchers" ("archived_at");
