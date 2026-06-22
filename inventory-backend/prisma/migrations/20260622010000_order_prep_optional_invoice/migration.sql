-- Make invoiceId optional (delay invoice creation until preparation is done)
ALTER TABLE "order_preparations" ALTER COLUMN "invoice_id" DROP NOT NULL;

-- Store the original catalog order data needed to create the invoice later
ALTER TABLE "order_preparations" ADD COLUMN "order_data" JSONB;

-- Allow staff to add notes during preparation
ALTER TABLE "order_preparations" ADD COLUMN "notes" TEXT;
