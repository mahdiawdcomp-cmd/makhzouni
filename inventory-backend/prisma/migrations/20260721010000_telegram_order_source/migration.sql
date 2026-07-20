-- Origin-channel tracking for order preparations + invoices (Telegram bot
-- feature suite). Nullable, additive — legacy rows stay NULL.
ALTER TABLE "order_preparations" ADD COLUMN "source" TEXT;
ALTER TABLE "invoices" ADD COLUMN "source" TEXT;

CREATE INDEX "order_preparations_source_idx" ON "order_preparations"("source");
CREATE INDEX "invoices_source_idx" ON "invoices"("source");
