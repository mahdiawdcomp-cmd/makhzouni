-- Additive only: updated_at on invoices + payment_vouchers so the incremental
-- backup (/backup/changes) can see EDITS, not just newly-created rows.
-- Existing rows are backfilled with now(); Prisma bumps the value on every update.
ALTER TABLE "invoices" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "payment_vouchers" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "invoices_updated_at_idx" ON "invoices"("updated_at");
CREATE INDEX "payment_vouchers_updated_at_idx" ON "payment_vouchers"("updated_at");
