-- Drop the legacy DB-level balance triggers (added 20260529184000).
-- They predate voucher cancellation / accounting-safe delete and PURCHASE
-- sign handling, so their formula is wrong twice:
--   * cancelled/archived receipts are still subtracted from the balance
--   * PURCHASE invoice remainders are ADDED instead of subtracted
-- Worse, they fire AFTER application-level recalculation on invoice/voucher
-- row updates (e.g. the edit path's display-only previousBalance restore),
-- silently overwriting the correct balance. Every mutation path has had a
-- correct app-level recalculation for a long time — the triggers are pure
-- corruption now.
DROP TRIGGER IF EXISTS "invoices_recalculate_customer_balance" ON "invoices";
DROP TRIGGER IF EXISTS "payment_vouchers_recalculate_customer_balance" ON "payment_vouchers";
DROP TRIGGER IF EXISTS "customers_opening_balance_recalculate" ON "customers";
DROP FUNCTION IF EXISTS trigger_recalculate_customer_balance();
DROP FUNCTION IF EXISTS trigger_recalculate_customer_opening_balance();
DROP FUNCTION IF EXISTS recalculate_customer_balance(UUID);
