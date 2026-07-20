-- «قناة تيليگرام» — maps each product published to the Telegram channel to its
-- channel message id so the sync worker can edit/delete it. Additive only.
CREATE TABLE "telegram_channel_posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "message_id" INTEGER NOT NULL,
    "caption_hash" TEXT NOT NULL,
    "image_hash" TEXT NOT NULL DEFAULT '',
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_channel_posts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telegram_channel_posts_product_id_key" ON "telegram_channel_posts"("product_id");
