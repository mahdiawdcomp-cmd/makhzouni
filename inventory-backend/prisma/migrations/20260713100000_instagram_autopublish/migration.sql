-- Instagram auto-publish for «كتلوك المفرد» — additive only

CREATE TYPE "InstagramPostStatus" AS ENUM ('DRAFT', 'QUEUED', 'PREPARING', 'UPLOADING', 'PUBLISHED', 'FAILED');
CREATE TYPE "InstagramPostType" AS ENUM ('IMAGE', 'CAROUSEL', 'REEL');
CREATE TYPE "InstagramQueueStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DONE');
CREATE TYPE "InstagramScheduleType" AS ENUM ('FIXED_TIMES', 'INTERVAL');

CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'video',
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "duration" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" BYTEA NOT NULL,
    "public_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "media_assets_public_token_key" ON "media_assets"("public_token");

CREATE TABLE "instagram_accounts" (
    "id" UUID NOT NULL,
    "ig_user_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT,
    "profile_picture_url" TEXT,
    "access_token_enc" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3),
    "page_id" TEXT,
    "page_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "instagram_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "instagram_accounts_ig_user_id_key" ON "instagram_accounts"("ig_user_id");

CREATE TABLE "instagram_queues" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "name" TEXT,
    "status" "InstagramQueueStatus" NOT NULL DEFAULT 'ACTIVE',
    "schedule_type" "InstagramScheduleType" NOT NULL,
    "times" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interval_minutes" INTEGER,
    "posts_per_day" INTEGER NOT NULL DEFAULT 1,
    "published_today" INTEGER NOT NULL DEFAULT 0,
    "today_key" TEXT,
    "last_published_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "instagram_queues_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "instagram_queues_status_idx" ON "instagram_queues"("status");
ALTER TABLE "instagram_queues" ADD CONSTRAINT "instagram_queues_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "instagram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "instagram_posts" (
    "id" UUID NOT NULL,
    "retail_item_id" UUID,
    "product_title" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "queue_id" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "post_type" "InstagramPostType" NOT NULL,
    "status" "InstagramPostStatus" NOT NULL DEFAULT 'DRAFT',
    "caption" TEXT NOT NULL DEFAULT '',
    "media_plan" JSONB NOT NULL,
    "ig_creation_id" TEXT,
    "ig_media_id" TEXT,
    "permalink" TEXT,
    "error_message" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "instagram_posts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "instagram_posts_status_idx" ON "instagram_posts"("status");
CREATE INDEX "instagram_posts_retail_item_id_idx" ON "instagram_posts"("retail_item_id");
CREATE INDEX "instagram_posts_queue_id_position_idx" ON "instagram_posts"("queue_id", "position");
ALTER TABLE "instagram_posts" ADD CONSTRAINT "instagram_posts_retail_item_id_fkey" FOREIGN KEY ("retail_item_id") REFERENCES "retail_catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "instagram_posts" ADD CONSTRAINT "instagram_posts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "instagram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "instagram_posts" ADD CONSTRAINT "instagram_posts_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "instagram_queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "instagram_hashtag_groups" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "instagram_hashtag_groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "instagram_hashtag_groups_name_key" ON "instagram_hashtag_groups"("name");

ALTER TABLE "retail_catalog_items" ADD COLUMN "video_asset_id" UUID;
ALTER TABLE "retail_catalog_items" ADD COLUMN "instagram_published_at" TIMESTAMP(3);
ALTER TABLE "retail_catalog_items" ADD COLUMN "instagram_permalink" TEXT;
ALTER TABLE "retail_catalog_items" ADD COLUMN "instagram_account_name" TEXT;
CREATE UNIQUE INDEX "retail_catalog_items_video_asset_id_key" ON "retail_catalog_items"("video_asset_id");
ALTER TABLE "retail_catalog_items" ADD CONSTRAINT "retail_catalog_items_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
