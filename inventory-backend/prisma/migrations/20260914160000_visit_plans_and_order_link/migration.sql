-- «خطة زيارات اليوم» plus the link from a visit to the order it produced.
--
-- Additive: one new table and two nullable columns. Existing visits keep
-- working with both columns NULL, which reads exactly as it should — an
-- unplanned visit whose outcome was typed by hand.

-- The plan is the INTENTION; `sales_agent_visits` stays the record of what
-- actually happened. `plan_date` is the SHOP's local day as text, not an
-- instant: "today's plan" must not move because the server runs in UTC.
CREATE TABLE IF NOT EXISTS "sales_agent_visit_plans" (
  "id" UUID NOT NULL,
  "sales_agent_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "plan_date" TEXT NOT NULL,
  "sort_order" INTEGER,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_agent_visit_plans_pkey" PRIMARY KEY ("id")
);

-- The same shop cannot be planned twice for one rep on one day.
CREATE UNIQUE INDEX IF NOT EXISTS "sales_agent_visit_plan_agent_customer_date_key"
  ON "sales_agent_visit_plans" ("sales_agent_id", "customer_id", "plan_date");
CREATE INDEX IF NOT EXISTS "sales_agent_visit_plans_sales_agent_id_plan_date_sort_order_idx"
  ON "sales_agent_visit_plans" ("sales_agent_id", "plan_date", "sort_order");
CREATE INDEX IF NOT EXISTS "sales_agent_visit_plans_customer_id_idx"
  ON "sales_agent_visit_plans" ("customer_id");

ALTER TABLE "sales_agent_visit_plans"
  ADD CONSTRAINT "sales_agent_visit_plans_sales_agent_id_fkey"
  FOREIGN KEY ("sales_agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_agent_visit_plans"
  ADD CONSTRAINT "sales_agent_visit_plans_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_agent_visit_plans"
  ADD CONSTRAINT "sales_agent_visit_plans_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A visit can now say which plan entry it came from, and which order it
-- produced. Both nullable: a visit is valid without either.
ALTER TABLE "sales_agent_visits" ADD COLUMN IF NOT EXISTS "plan_id" UUID;
ALTER TABLE "sales_agent_visits" ADD COLUMN IF NOT EXISTS "order_approval_id" UUID;

CREATE INDEX IF NOT EXISTS "sales_agent_visits_plan_id_idx"
  ON "sales_agent_visits" ("plan_id");
CREATE INDEX IF NOT EXISTS "sales_agent_visits_order_approval_id_idx"
  ON "sales_agent_visits" ("order_approval_id");

ALTER TABLE "sales_agent_visits"
  ADD CONSTRAINT "sales_agent_visits_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "sales_agent_visit_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_agent_visits"
  ADD CONSTRAINT "sales_agent_visits_order_approval_id_fkey"
  FOREIGN KEY ("order_approval_id") REFERENCES "pending_approvals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
