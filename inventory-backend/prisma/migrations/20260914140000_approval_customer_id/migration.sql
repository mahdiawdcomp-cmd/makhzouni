-- «يحتاجون متابعة» needs to ask "which of my customers has a pending or
-- refused order?" INSIDE the customers query, before pagination. The id has
-- always been in `request_data`, but a JSON path cannot be used in a relation
-- filter, so the question could only be answered after paging — which hid
-- customers who happened to be on a later page.
--
-- Additive: a nullable column, an index, and a backfill limited to rows that
-- already carry a real customer id. Nothing is deleted or rewritten.

ALTER TABLE "pending_approvals" ADD COLUMN IF NOT EXISTS "customer_id" UUID;

-- Backfill ONLY catalog/rep orders whose stored id points at a customer that
-- really exists. A guest catalog order has no customer and stays NULL; a
-- dangling id would break the foreign key added below, so it is skipped rather
-- than forced.
UPDATE "pending_approvals" pa
SET "customer_id" = ((pa."request_data" ->> 'customerId'))::uuid
WHERE pa."customer_id" IS NULL
  AND pa."request_type" = 'CATALOG_ORDER'
  AND (pa."request_data" ->> 'customerId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND EXISTS (
    SELECT 1 FROM "customers" c
    WHERE c."id" = ((pa."request_data" ->> 'customerId'))::uuid
  );

CREATE INDEX IF NOT EXISTS "pending_approvals_customer_id_request_type_status_idx"
  ON "pending_approvals" ("customer_id", "request_type", "status");

ALTER TABLE "pending_approvals"
  ADD CONSTRAINT "pending_approvals_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
