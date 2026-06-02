-- InvoiceType enum (SALE | PURCHASE)
CREATE TYPE "InvoiceType" AS ENUM ('SALE', 'PURCHASE');

-- Add Invoice.type, default SALE so existing rows stay correct
ALTER TABLE "invoices" ADD COLUMN "type" "InvoiceType" NOT NULL DEFAULT 'SALE';
CREATE INDEX "invoices_type_idx" ON "invoices"("type");

-- Customer.isSupplier flag
ALTER TABLE "customers" ADD COLUMN "is_supplier" BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX "customers_is_supplier_idx" ON "customers"("is_supplier");

-- VoucherType += EXPENSE
ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'EXPENSE';

-- PaymentVoucher: customerId nullable (EXPENSE has no customer) + description
ALTER TABLE "payment_vouchers" ALTER COLUMN "customer_id" DROP NOT NULL;
ALTER TABLE "payment_vouchers" ADD COLUMN "description" TEXT;

-- Update the trigger so EXPENSE vouchers (customer_id IS NULL) are skipped cleanly.
CREATE OR REPLACE FUNCTION trigger_recalculate_customer_balance()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."customer_id" IS NOT NULL THEN
      PERFORM recalculate_customer_balance(NEW."customer_id");
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD."customer_id" IS DISTINCT FROM NEW."customer_id" AND OLD."customer_id" IS NOT NULL THEN
      PERFORM recalculate_customer_balance(OLD."customer_id");
    END IF;
    IF NEW."customer_id" IS NOT NULL THEN
      PERFORM recalculate_customer_balance(NEW."customer_id");
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD."customer_id" IS NOT NULL THEN
      PERFORM recalculate_customer_balance(OLD."customer_id");
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
