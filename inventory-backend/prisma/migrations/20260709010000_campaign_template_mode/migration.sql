-- Adds pre-approved Meta template support to campaigns (additive, nullable/
-- defaulted — existing rows keep sending free-text messages as before).
-- Needed for cold/first-contact sends via Cloud API, which Meta rejects as
-- free text outside the 24h session window.

ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "use_template" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "template_name" TEXT;
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "template_language" TEXT DEFAULT 'ar';
