-- «أكو مشكلة» + «اطلب سعراً خاصاً» — phase 3 of the sales-rep feature.
-- Both tables are new and additive; nothing existing is touched.

-- Why a shopkeeper refused. Collected all day, never notified over WhatsApp:
-- none of it is urgent, and a message per refusal would train the owner to
-- ignore the channel that also carries orders.
CREATE TABLE IF NOT EXISTS "sales_agent_issues" (
  "id"              UUID NOT NULL,
  "sales_agent_id"  UUID NOT NULL,
  "customer_id"     UUID NOT NULL,
  "product_id"      UUID,
  "reason"          TEXT NOT NULL,
  "note"            TEXT,
  "competitor_info" TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_agent_issues_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sales_agent_issues_sales_agent_id_idx" ON "sales_agent_issues"("sales_agent_id");
CREATE INDEX IF NOT EXISTS "sales_agent_issues_customer_id_idx" ON "sales_agent_issues"("customer_id");
CREATE INDEX IF NOT EXISTS "sales_agent_issues_product_id_idx" ON "sales_agent_issues"("product_id");
CREATE INDEX IF NOT EXISTS "sales_agent_issues_reason_idx" ON "sales_agent_issues"("reason");
CREATE INDEX IF NOT EXISTS "sales_agent_issues_created_at_idx" ON "sales_agent_issues"("created_at");

DO $$ BEGIN
  ALTER TABLE "sales_agent_issues" ADD CONSTRAINT "sales_agent_issues_sales_agent_id_fkey"
    FOREIGN KEY ("sales_agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sales_agent_issues" ADD CONSTRAINT "sales_agent_issues_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sales_agent_issues" ADD CONSTRAINT "sales_agent_issues_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A one-shot approved price. Spent on the order it is used for, so it can never
-- quietly become the customer's standing price.
CREATE TABLE IF NOT EXISTS "sales_agent_price_requests" (
  "id"              UUID NOT NULL,
  "sales_agent_id"  UUID NOT NULL,
  "customer_id"     UUID NOT NULL,
  "product_id"      UUID NOT NULL,
  "unit"            "Unit" NOT NULL,
  "current_price"   DECIMAL(12,2) NOT NULL,
  "requested_price" DECIMAL(12,2) NOT NULL,
  "reason"          TEXT,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "approval_id"     UUID,
  "reviewed_at"     TIMESTAMP(3),
  "consumed_at"     TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_agent_price_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sales_agent_price_requests_sales_agent_id_idx" ON "sales_agent_price_requests"("sales_agent_id");
CREATE INDEX IF NOT EXISTS "sales_agent_price_requests_lookup_idx" ON "sales_agent_price_requests"("customer_id","product_id","status");
CREATE INDEX IF NOT EXISTS "sales_agent_price_requests_approval_id_idx" ON "sales_agent_price_requests"("approval_id");

DO $$ BEGIN
  ALTER TABLE "sales_agent_price_requests" ADD CONSTRAINT "sales_agent_price_requests_sales_agent_id_fkey"
    FOREIGN KEY ("sales_agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sales_agent_price_requests" ADD CONSTRAINT "sales_agent_price_requests_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sales_agent_price_requests" ADD CONSTRAINT "sales_agent_price_requests_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
