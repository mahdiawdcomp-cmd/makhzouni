-- Additive: reply/quote + emoji reactions on chat messages.
ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "reply_to_wa_message_id" TEXT;
ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "reply_to_text" TEXT;
ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "reaction_emoji" TEXT;
