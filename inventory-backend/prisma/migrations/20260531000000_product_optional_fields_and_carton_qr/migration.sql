-- Make category nullable and prices default to 0
ALTER TABLE "products" ALTER COLUMN "category" DROP NOT NULL;
ALTER TABLE "products" ALTER COLUMN "purchase_price" SET DEFAULT 0;
ALTER TABLE "products" ALTER COLUMN "sale_price" SET DEFAULT 0;

-- Add carton QR column (nullable, unique)
ALTER TABLE "products" ADD COLUMN "carton_qr_code" TEXT;
CREATE UNIQUE INDEX "products_carton_qr_code_key" ON "products"("carton_qr_code");

-- Generic counters table
CREATE TABLE "counters" (
  "key" TEXT PRIMARY KEY,
  "value" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed the item-number counter from the largest existing numeric suffix on item_number
-- so that auto-generated codes continue past any pre-existing ones.
INSERT INTO "counters" ("key", "value", "updated_at")
SELECT
  'product_item_number',
  COALESCE(MAX(
    CASE
      WHEN "item_number" ~ '^[A-Z]{2}[0-9]{4}$'
        THEN (SUBSTRING("item_number" FROM 3))::int
      ELSE 0
    END
  ), 0),
  CURRENT_TIMESTAMP
FROM "products";
