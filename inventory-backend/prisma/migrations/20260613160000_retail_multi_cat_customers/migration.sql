-- Convert single category/sub_category to arrays
ALTER TABLE "retail_catalog_items" ADD COLUMN "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "retail_catalog_items" ADD COLUMN "sub_categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "retail_catalog_items"
   SET "categories" = CASE WHEN "category" IS NOT NULL AND "category" <> '' THEN ARRAY["category"] ELSE ARRAY[]::TEXT[] END,
       "sub_categories" = CASE WHEN "sub_category" IS NOT NULL AND "sub_category" <> '' THEN ARRAY["sub_category"] ELSE ARRAY[]::TEXT[] END;

ALTER TABLE "retail_catalog_items" DROP COLUMN "category";
ALTER TABLE "retail_catalog_items" DROP COLUMN "sub_category";

-- Retail customers (subscriber database with interests)
CREATE TABLE "retail_customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_subscriber" BOOLEAN NOT NULL DEFAULT false,
    "interests" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "wish_note" TEXT,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "last_order_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "retail_customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "retail_customers_phone_key" ON "retail_customers"("phone");
CREATE INDEX "retail_customers_is_subscriber_idx" ON "retail_customers"("is_subscriber");
