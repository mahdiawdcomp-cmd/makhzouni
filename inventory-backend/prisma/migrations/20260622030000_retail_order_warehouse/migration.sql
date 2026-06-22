-- Add warehouse selection and distribution to retail orders
ALTER TABLE "retail_orders" ADD COLUMN "warehouse_id" UUID;
ALTER TABLE "retail_orders" ADD COLUMN "warehouse_distribution" JSONB;
