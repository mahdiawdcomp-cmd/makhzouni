-- «بوت تيليگرام» Phase 2 — order button on channel posts + bot conversations.
-- Additive only.
ALTER TABLE "telegram_channel_posts" ADD COLUMN "button_added" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "telegram_bot_chats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chat_id" BIGINT NOT NULL,
    "first_name" TEXT NOT NULL DEFAULT '',
    "username" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "customer_id" UUID,
    "state" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_bot_chats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_bot_chats_chat_id_key" ON "telegram_bot_chats"("chat_id");
