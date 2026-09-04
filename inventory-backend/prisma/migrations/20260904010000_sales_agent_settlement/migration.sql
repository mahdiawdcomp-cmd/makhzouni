-- «تثبيت الشهر» — the frozen commission settlement, plus a rejection reason.
-- Both additive; nothing existing is rewritten.

-- The agreement with a rep for one month, kept as it stood when it was agreed.
-- The calculator reads live rows, which is right until a number is agreed with a
-- person; after that a cancelled invoice or a reassigned customer would rewrite
-- what was already paid on.
CREATE TABLE IF NOT EXISTS "sales_agent_settlements" (
  "id"                  UUID NOT NULL,
  "sales_agent_id"      UUID NOT NULL,
  "month"               TEXT NOT NULL,
  "sold"                DECIMAL(14,2) NOT NULL,
  "collected_in_hand"   DECIMAL(14,2) NOT NULL,
  "collected_from_own"  DECIMAL(14,2) NOT NULL,
  "basis"               TEXT NOT NULL,
  "rate_percent"        DECIMAL(6,3) NOT NULL,
  "amount"              DECIMAL(14,2) NOT NULL,
  "notes"               TEXT,
  "settled_by"          UUID NOT NULL,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_agent_settlements_pkey" PRIMARY KEY ("id")
);

-- One settlement per rep per month: settling twice is impossible, and reopening
-- has to be a deliberate act.
CREATE UNIQUE INDEX IF NOT EXISTS "sales_agent_settlements_agent_month_key"
  ON "sales_agent_settlements"("sales_agent_id","month");
CREATE INDEX IF NOT EXISTS "sales_agent_settlements_month_idx"
  ON "sales_agent_settlements"("month");

DO $$ BEGIN
  ALTER TABLE "sales_agent_settlements" ADD CONSTRAINT "sales_agent_settlements_sales_agent_id_fkey"
    FOREIGN KEY ("sales_agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sales_agent_settlements" ADD CONSTRAINT "sales_agent_settlements_settled_by_fkey"
    FOREIGN KEY ("settled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Why an approval was rejected. A rep whose order comes back as a bare "مرفوض"
-- has to telephone to find out what to fix.
ALTER TABLE "pending_approvals" ADD COLUMN IF NOT EXISTS "review_note" TEXT;
