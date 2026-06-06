CREATE TABLE IF NOT EXISTS "order_preparations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoice_id" UUID NOT NULL UNIQUE REFERENCES "invoices"("id"),
  "customer_name" TEXT NOT NULL,
  "customer_phone" TEXT NOT NULL,
  "items" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "prepared_at" TIMESTAMP(3),
  "prepared_by_id" UUID REFERENCES "users"("id"),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "order_preparations_status_idx" ON "order_preparations"("status");
