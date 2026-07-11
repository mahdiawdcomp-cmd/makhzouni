-- Additive: Meta status-webhook failure reason on chat messages.
ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "status_error" TEXT;
