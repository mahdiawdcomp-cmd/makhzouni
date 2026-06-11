-- AddColumn: retail_price (سعر المفرد) to products
ALTER TABLE "products" ADD COLUMN "retail_price" DECIMAL(12,2) NOT NULL DEFAULT 0;
