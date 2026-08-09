-- Additive: freeze the customer balance immediately before/after each voucher,
-- matching the main Postgres backend's PaymentVoucher.previousBalance/finalBalance.
-- NULL on vouchers created before this migration ran.
ALTER TABLE "payment_vouchers" ADD COLUMN "previous_balance" DECIMAL;
ALTER TABLE "payment_vouchers" ADD COLUMN "final_balance" DECIMAL;
