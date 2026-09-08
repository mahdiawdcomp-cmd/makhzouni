-- «إنستغرام الجملة» — independent system for wholesale Product auto-publish.
-- Additive only: does not touch instagram_posts / instagram_queues /
-- retail_catalog_items or any column used by the retail (كتلوك المفرد) flow.

CREATE TYPE "WholesaleInstagramPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'SKIPPED_OUT_OF_STOCK');
CREATE TYPE "WholesaleInstagramPostType" AS ENUM ('IMAGE', 'CAROUSEL');

CREATE TABLE "wholesale_instagram_posts" (
    "id" UUID NOT NULL,
    "product_id" UUID,
    "product_title" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "post_type" "WholesaleInstagramPostType" NOT NULL,
    "status" "WholesaleInstagramPostStatus" NOT NULL DEFAULT 'DRAFT',
    "caption" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "ig_creation_id" TEXT,
    "ig_media_id" TEXT,
    "permalink" TEXT,
    "error_message" TEXT,
    "skip_reason" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "wholesale_instagram_posts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "wholesale_instagram_posts_status_idx" ON "wholesale_instagram_posts"("status");
CREATE INDEX "wholesale_instagram_posts_product_id_idx" ON "wholesale_instagram_posts"("product_id");
CREATE INDEX "wholesale_instagram_posts_account_id_idx" ON "wholesale_instagram_posts"("account_id");
CREATE INDEX "wholesale_instagram_posts_status_scheduled_at_idx" ON "wholesale_instagram_posts"("status", "scheduled_at");
ALTER TABLE "wholesale_instagram_posts" ADD CONSTRAINT "wholesale_instagram_posts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wholesale_instagram_posts" ADD CONSTRAINT "wholesale_instagram_posts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "instagram_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "wholesale_instagram_post_media" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wholesale_instagram_post_media_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "wholesale_instagram_post_media_post_id_sort_order_idx" ON "wholesale_instagram_post_media"("post_id", "sort_order");
ALTER TABLE "wholesale_instagram_post_media" ADD CONSTRAINT "wholesale_instagram_post_media_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "wholesale_instagram_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wholesale_instagram_post_media" ADD CONSTRAINT "wholesale_instagram_post_media_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
