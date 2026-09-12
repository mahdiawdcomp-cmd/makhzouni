-- Four capabilities for «الموظف الذكي», all additive:
--
-- 1. ai_muted_until — the agent goes quiet on a number right after a human
--    replies from the chat screen, so the customer never gets two answers to
--    one message.
-- 2. images_today — vision is the expensive part of a turn, so photos get
--    their own daily ceiling next to the existing reply ceiling.
-- 3. ai_escalations.kind / alerted_at — an upset customer is a different kind
--    of escalation from a price question, and the owner is texted about it
--    once (alerted_at is the rate-limit anchor).
-- 4. whatsapp_ai_memories — durable one-line facts about a number, so the
--    agent still knows the customer tomorrow. Short-term history is 24h; this
--    is what survives it.

ALTER TABLE "whatsapp_ai_chats" ADD COLUMN IF NOT EXISTS "ai_muted_until" TIMESTAMP(3);
ALTER TABLE "whatsapp_ai_chats" ADD COLUMN IF NOT EXISTS "images_today" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ai_escalations" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'GENERAL';
ALTER TABLE "ai_escalations" ADD COLUMN IF NOT EXISTS "alerted_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "whatsapp_ai_memories" (
  "id"          UUID NOT NULL,
  "phone"       TEXT NOT NULL,
  "customer_id" UUID,
  "fact"        TEXT NOT NULL,
  -- Arabic-folded copy of the fact, used only to stop the agent writing the
  -- same thing twice in slightly different spelling.
  "normalized"  TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_ai_memories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_ai_memories_phone_normalized_key"
  ON "whatsapp_ai_memories"("phone", "normalized");
CREATE INDEX IF NOT EXISTS "whatsapp_ai_memories_phone_created_at_idx"
  ON "whatsapp_ai_memories"("phone", "created_at");
