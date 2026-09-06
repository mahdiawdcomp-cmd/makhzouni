-- One LIVE price request per customer + product + unit.
--
-- The service already refused a second one, but it read the table and then
-- inserted: two taps that arrived together both read "none" and both inserted,
-- so the owner got two approvals for the same negotiation. The database decides
-- now. Partial, so spent and rejected requests never block a new one.

-- Any duplicate already in the table came from that bug. Keep the first one of
-- each group live and retire the rest: they are marked consumed so they stop
-- appearing as usable prices, and the rows (and their approvals) stay readable.
UPDATE "sales_agent_price_requests" AS dup
SET "consumed_at" = NOW()
WHERE "consumed_at" IS NULL
  AND "status" IN ('PENDING', 'APPROVED')
  AND EXISTS (
    SELECT 1
    FROM "sales_agent_price_requests" AS keep
    WHERE keep."customer_id" = dup."customer_id"
      AND keep."product_id" = dup."product_id"
      AND keep."unit" = dup."unit"
      AND keep."consumed_at" IS NULL
      AND keep."status" IN ('PENDING', 'APPROVED')
      AND (keep."created_at", keep."id") < (dup."created_at", dup."id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "sales_agent_price_requests_live_key"
  ON "sales_agent_price_requests"("customer_id", "product_id", "unit")
  WHERE "consumed_at" IS NULL AND "status" IN ('PENDING', 'APPROVED');
