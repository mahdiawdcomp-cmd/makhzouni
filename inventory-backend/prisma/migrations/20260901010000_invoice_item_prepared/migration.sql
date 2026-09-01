-- «تم تجهيز» per invoice line: the picker's tick, so reopening an invoice shows
-- what was already pulled from the shelf and what is still outstanding.
-- Additive and defaulted, so every existing line reads as "not prepared".
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "prepared" BOOLEAN NOT NULL DEFAULT false;
