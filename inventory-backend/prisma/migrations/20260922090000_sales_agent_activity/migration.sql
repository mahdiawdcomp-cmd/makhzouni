-- «إشعارات المندوبين»: one row per thing a rep does, with a server-side read
-- state. Additive only.
CREATE TABLE IF NOT EXISTS "sales_agent_activities" (
    "id" UUID NOT NULL,
    "sales_agent_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "customer_id" UUID,
    "reference_id" TEXT,
    "approval_id" UUID,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "important" BOOLEAN NOT NULL DEFAULT false,
    "amount" DECIMAL(14,2),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_agent_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sales_agent_activities_created_at_idx" ON "sales_agent_activities"("created_at");
CREATE INDEX IF NOT EXISTS "sales_agent_activities_sales_agent_id_created_at_idx" ON "sales_agent_activities"("sales_agent_id", "created_at");
CREATE INDEX IF NOT EXISTS "sales_agent_activities_read_at_idx" ON "sales_agent_activities"("read_at");

DO $$ BEGIN
    ALTER TABLE "sales_agent_activities" ADD CONSTRAINT "sales_agent_activities_sales_agent_id_fkey"
        FOREIGN KEY ("sales_agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
