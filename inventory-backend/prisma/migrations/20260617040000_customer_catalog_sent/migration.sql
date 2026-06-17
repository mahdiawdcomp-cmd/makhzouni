-- Track when the wholesale-catalog link was last sent to a customer over
-- WhatsApp, so the catalog management page can flag "sent but not opened yet".
-- Additive — safe on prod.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "catalog_link_sent_at" TIMESTAMP(3);
