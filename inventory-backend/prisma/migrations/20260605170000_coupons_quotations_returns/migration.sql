ALTER TYPE "InvoiceType" ADD VALUE IF NOT EXISTS 'SALES_RETURN';

CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'AMOUNT');
CREATE TYPE "QuotationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED');

CREATE TABLE "coupons" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "discount_type" "DiscountType" NOT NULL,
  "discount_value" DECIMAL(12,2) NOT NULL,
  "starts_at" TIMESTAMP(3),
  "ends_at" TIMESTAMP(3),
  "max_uses" INTEGER,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "coupon_redemptions" (
  "id" UUID NOT NULL,
  "coupon_id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quotations" (
  "id" UUID NOT NULL,
  "quotation_number" TEXT NOT NULL,
  "customer_id" UUID NOT NULL,
  "status" "QuotationStatus" NOT NULL DEFAULT 'PENDING',
  "subtotal" DECIMAL(12,2) NOT NULL,
  "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(12,2) NOT NULL,
  "expires_at" TIMESTAMP(3),
  "notes" TEXT,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quotation_items" (
  "id" UUID NOT NULL,
  "quotation_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "product_name" TEXT NOT NULL,
  "unit" "Unit" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_price" DECIMAL(12,2) NOT NULL,
  "total_price" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "invoices"
  ADD COLUMN "coupon_id" UUID,
  ADD COLUMN "original_invoice_id" UUID,
  ADD COLUMN "source_quotation_id" UUID;

CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");
CREATE INDEX "coupons_is_active_idx" ON "coupons"("is_active");
CREATE INDEX "coupons_starts_at_ends_at_idx" ON "coupons"("starts_at", "ends_at");

CREATE UNIQUE INDEX "coupon_redemptions_coupon_id_invoice_id_key" ON "coupon_redemptions"("coupon_id", "invoice_id");
CREATE INDEX "coupon_redemptions_customer_id_idx" ON "coupon_redemptions"("customer_id");

CREATE UNIQUE INDEX "quotations_quotation_number_key" ON "quotations"("quotation_number");
CREATE INDEX "quotations_customer_id_idx" ON "quotations"("customer_id");
CREATE INDEX "quotations_status_idx" ON "quotations"("status");
CREATE INDEX "quotations_created_by_idx" ON "quotations"("created_by");

CREATE INDEX "quotation_items_quotation_id_idx" ON "quotation_items"("quotation_id");
CREATE INDEX "quotation_items_product_id_idx" ON "quotation_items"("product_id");

CREATE INDEX "invoices_coupon_id_idx" ON "invoices"("coupon_id");
CREATE INDEX "invoices_original_invoice_id_idx" ON "invoices"("original_invoice_id");
CREATE UNIQUE INDEX "invoices_source_quotation_id_key" ON "invoices"("source_quotation_id");

ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_original_invoice_id_fkey" FOREIGN KEY ("original_invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_source_quotation_id_fkey" FOREIGN KEY ("source_quotation_id") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
