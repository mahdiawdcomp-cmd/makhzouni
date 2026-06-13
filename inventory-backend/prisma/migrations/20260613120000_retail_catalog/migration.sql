-- Invoice notes (used by retail orders to store the real buyer's details)
ALTER TABLE "invoices" ADD COLUMN "notes" TEXT;

-- Retail catalog items (كتلوك المفرد)
CREATE TABLE "retail_catalog_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "images" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "retail_catalog_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "retail_catalog_items_is_active_idx" ON "retail_catalog_items"("is_active");
CREATE INDEX "retail_catalog_items_product_id_idx" ON "retail_catalog_items"("product_id");

ALTER TABLE "retail_catalog_items"
    ADD CONSTRAINT "retail_catalog_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Retail coupons (separate from wholesale coupons)
CREATE TABLE "retail_coupons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discount_type" "DiscountType" NOT NULL,
    "discount_value" DECIMAL(12,2) NOT NULL,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "retail_coupons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "retail_coupons_code_key" ON "retail_coupons"("code");
CREATE INDEX "retail_coupons_is_active_idx" ON "retail_coupons"("is_active");

-- Retail orders (public storefront orders)
CREATE TABLE "retail_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_number" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "notes" TEXT,
    "items" JSONB NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "coupon_code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "invoice_id" UUID,
    "prepared_at" TIMESTAMP(3),
    "prepared_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "retail_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "retail_orders_order_number_key" ON "retail_orders"("order_number");
CREATE INDEX "retail_orders_status_idx" ON "retail_orders"("status");
CREATE INDEX "retail_orders_phone_idx" ON "retail_orders"("phone");
