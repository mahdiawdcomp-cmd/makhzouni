-- «الموظف الذكي» — AI WhatsApp agent. Additive only: two new tables, nothing
-- existing is touched. The agent itself stays off until the shop enables it
-- (settings.whatsappAiAgentEnabled), so deploying this changes no behaviour.

-- Short-term conversation memory, kept apart from whatsapp_bot_chats (the
-- registration state machine) so neither can corrupt the other.
CREATE TABLE IF NOT EXISTS "whatsapp_ai_chats" (
  "id"         UUID NOT NULL,
  "phone"      TEXT NOT NULL,
  "messages"   JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_ai_chats_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_ai_chats_phone_key" ON "whatsapp_ai_chats"("phone");

-- «المنتجات المطلوبة» — demand for things the shop does not carry, one row
-- per normalized product name while OPEN (repeats bump request_count).
CREATE TABLE IF NOT EXISTS "requested_products" (
  "id"               UUID NOT NULL,
  "normalized_name"  TEXT NOT NULL,
  "product_name"     TEXT NOT NULL,
  "request_count"    INTEGER NOT NULL DEFAULT 1,
  "last_phone"       TEXT NOT NULL,
  "last_customer_id" UUID,
  "last_note"        TEXT,
  "status"           TEXT NOT NULL DEFAULT 'OPEN',
  "handled_at"       TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "requested_products_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "requested_products_status_updated_at_idx" ON "requested_products"("status", "updated_at");
CREATE INDEX IF NOT EXISTS "requested_products_normalized_name_status_idx" ON "requested_products"("normalized_name", "status");
