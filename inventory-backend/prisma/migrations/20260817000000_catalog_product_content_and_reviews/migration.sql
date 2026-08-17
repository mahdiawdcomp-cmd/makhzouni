-- Additive only. Backs the wholesale catalog's product page: marketing copy
-- and a spec table on the product itself, an extra image gallery, and
-- per-product shopper reviews that stay hidden until an admin approves them.
--
-- Note the review table is NOT "product_reviews" — that name is already taken
-- by the one-rating-per-sale-invoice model collected over WhatsApp, which
-- cannot be attributed to an individual product. These are separate concepts
-- and both stay.

CREATE TYPE "ProductReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- Storefront content on the product. Both NULL for every existing row, so the
-- product page simply shows no description/specs until the shop fills them in.
ALTER TABLE "products" ADD COLUMN "catalog_description" TEXT;
ALTER TABLE "products" ADD COLUMN "catalog_specs" JSONB;

-- Extra gallery images. Same storage approach as products.image_url (a data
-- URI in a Text column) so the shop uploads straight from a phone with no
-- external image hosting to depend on.
CREATE TABLE "product_catalog_images" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_catalog_images_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_catalog_images_product_id_sort_order_idx"
    ON "product_catalog_images"("product_id", "sort_order");

ALTER TABLE "product_catalog_images"
    ADD CONSTRAINT "product_catalog_images_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Per-product reviews written by wholesale customers on the catalog product
-- page. One per (product, customer): re-submitting edits their own review and
-- sends it back through approval.
CREATE TABLE "catalog_product_reviews" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "status" "ProductReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_product_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "catalog_product_reviews_product_id_customer_id_key"
    ON "catalog_product_reviews"("product_id", "customer_id");
CREATE INDEX "catalog_product_reviews_product_id_status_idx"
    ON "catalog_product_reviews"("product_id", "status");
CREATE INDEX "catalog_product_reviews_status_created_at_idx"
    ON "catalog_product_reviews"("status", "created_at");

ALTER TABLE "catalog_product_reviews"
    ADD CONSTRAINT "catalog_product_reviews_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "catalog_product_reviews"
    ADD CONSTRAINT "catalog_product_reviews_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
