-- New retail catalog item fields
ALTER TABLE "retail_catalog_items" ADD COLUMN "old_price" DECIMAL(12,2);
ALTER TABLE "retail_catalog_items" ADD COLUMN "category" TEXT;
ALTER TABLE "retail_catalog_items" ADD COLUMN "sub_category" TEXT;
ALTER TABLE "retail_catalog_items" ADD COLUMN "is_best_seller" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "retail_catalog_items" ADD COLUMN "is_new" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "retail_catalog_items" ADD COLUMN "is_offer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "retail_catalog_items" ADD COLUMN "low_stock_badge" BOOLEAN NOT NULL DEFAULT false;

-- Retail categories (main + sub, independent of wholesale catalog)
CREATE TABLE "retail_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "sub_categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "retail_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "retail_categories_name_key" ON "retail_categories"("name");
