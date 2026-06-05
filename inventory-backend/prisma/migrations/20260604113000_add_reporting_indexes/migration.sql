CREATE INDEX IF NOT EXISTS "invoices_date_idx" ON "invoices"("date");
CREATE INDEX IF NOT EXISTS "invoices_created_at_idx" ON "invoices"("created_at");
CREATE INDEX IF NOT EXISTS "invoices_customer_id_date_idx" ON "invoices"("customer_id", "date");
CREATE INDEX IF NOT EXISTS "payment_vouchers_date_idx" ON "payment_vouchers"("date");
CREATE INDEX IF NOT EXISTS "payment_vouchers_created_at_idx" ON "payment_vouchers"("created_at");
CREATE INDEX IF NOT EXISTS "stock_movements_created_at_idx" ON "stock_movements"("created_at");
CREATE INDEX IF NOT EXISTS "stock_movements_product_id_created_at_idx" ON "stock_movements"("product_id", "created_at");
