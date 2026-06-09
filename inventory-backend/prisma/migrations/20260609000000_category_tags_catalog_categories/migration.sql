-- AddColumn: categoryTags TEXT[] on products
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "category_tags" TEXT[] NOT NULL DEFAULT '{}';

-- AddColumn: typeTags TEXT[] on products
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "type_tags" TEXT[] NOT NULL DEFAULT '{}';

-- CreateTable: catalog_categories
CREATE TABLE IF NOT EXISTS "catalog_categories" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "name"       TEXT         NOT NULL,
    "types"      TEXT[]       NOT NULL DEFAULT '{}',
    "sort_order" INTEGER      NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "catalog_categories_name_key" ON "catalog_categories"("name");
