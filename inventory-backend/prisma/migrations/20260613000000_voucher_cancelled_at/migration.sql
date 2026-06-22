-- Add soft-cancel support to payment_vouchers
ALTER TABLE "payment_vouchers" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3);
