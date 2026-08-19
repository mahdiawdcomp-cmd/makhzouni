-- Additive only. بند ٥ — WhatsApp registration conversation (name + province +
-- business type -> CATALOG_ACCESS approval), the "أريد أحچي مع موظف" escalation
-- flag, and a per-campaign opt-in for the "رد 1/2" registration-funnel footer.

CREATE TABLE "whatsapp_bot_chats" (
    "id"         UUID NOT NULL,
    "phone"      TEXT NOT NULL,
    "state"      JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_bot_chats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_bot_chats_phone_key" ON "whatsapp_bot_chats"("phone");

ALTER TABLE "inbound_messages" ADD COLUMN "urgent" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "campaigns" ADD COLUMN "offer_registration_choices" BOOLEAN NOT NULL DEFAULT false;
