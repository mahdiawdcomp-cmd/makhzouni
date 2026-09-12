ALTER TABLE "products" ADD COLUMN "carton_piece_price" DECIMAL(12,2);
ALTER TABLE "products" ADD CONSTRAINT "products_carton_price_valid" CHECK ("carton_piece_price" IS NULL OR ("carton_piece_price" >= 0 AND "carton_piece_price" <= "sale_price"));
ALTER TABLE "invoices" ADD COLUMN "price_mode" TEXT NOT NULL DEFAULT 'WHOLESALE';
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_price_mode_valid" CHECK ("price_mode" IN ('WHOLESALE', 'RETAIL', 'CARTON'));
