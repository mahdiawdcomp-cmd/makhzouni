-- Admin broadcast: channel post (optional pin) + optional DM blast to every
-- Telegram bot user. Additive only.
CREATE TABLE "telegram_broadcasts" (
    "id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "image_data_url" TEXT,
    "to_channel" BOOLEAN NOT NULL DEFAULT false,
    "to_bot_users" BOOLEAN NOT NULL DEFAULT false,
    "pin_in_channel" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "channel_message_id" INTEGER,
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_broadcasts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "telegram_broadcast_recipients" (
    "id" UUID NOT NULL,
    "broadcast_id" UUID NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "telegram_broadcast_recipients_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "telegram_broadcast_recipients_broadcast_id_status_idx" ON "telegram_broadcast_recipients"("broadcast_id", "status");

ALTER TABLE "telegram_broadcast_recipients" ADD CONSTRAINT "telegram_broadcast_recipients_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "telegram_broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
