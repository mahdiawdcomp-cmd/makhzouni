-- Additive only. Vouchers stored no balance, so the WhatsApp receipt message
-- reconstructed "previous balance" by reversing the voucher's amount out of the
-- customer's LIVE balance. That is only correct while the voucher is the most
-- recent transaction — any later invoice or voucher made BOTH printed figures
-- wrong. Invoices have carried these snapshots from the start; vouchers now do
-- too. NULL means "legacy voucher, snapshot unknown".
ALTER TABLE "payment_vouchers" ADD COLUMN "previous_balance" DECIMAL(12,2);
ALTER TABLE "payment_vouchers" ADD COLUMN "final_balance" DECIMAL(12,2);
