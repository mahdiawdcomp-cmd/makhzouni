-- «شاشة التجهيز»: who ticked the line as prepared. Additive and nullable.
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "prepared_by" TEXT;
