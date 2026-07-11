-- Additive: archive/pin + internal notes on WhatsApp conversations.
ALTER TABLE "whatsapp_conversations" ADD COLUMN IF NOT EXISTS "is_archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "whatsapp_conversations" ADD COLUMN IF NOT EXISTS "is_pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "whatsapp_conversations" ADD COLUMN IF NOT EXISTS "internal_notes" TEXT;
