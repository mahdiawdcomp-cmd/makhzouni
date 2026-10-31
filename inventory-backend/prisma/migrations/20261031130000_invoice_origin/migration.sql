-- Marks invoices created by count settlements (STOCK_COUNT) so cash and
-- sales KPIs can exclude them. Additive, nullable.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "origin" TEXT;
