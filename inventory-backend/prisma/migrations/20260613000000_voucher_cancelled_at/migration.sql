-- Add soft-cancel support to payment_vouchers
ALTER TABLE "payment_vouchers" ADD COLUMN "cancelled_at" TIMESTAMP(3);
