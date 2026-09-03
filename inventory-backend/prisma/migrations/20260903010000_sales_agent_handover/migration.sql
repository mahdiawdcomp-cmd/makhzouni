-- «تسليم المندوب» — the rep handing collected cash to the owner.
-- A ledger of handovers only. The rep's outstanding cash is derived from
-- receipt vouchers minus these rows, never stored as a balance, so nothing
-- here can drift out of agreement with the vouchers it is computed from.
CREATE TABLE IF NOT EXISTS "sales_agent_handovers" (
  "id"             UUID NOT NULL,
  "sales_agent_id" UUID NOT NULL,
  "amount"         DECIMAL(12,2) NOT NULL,
  "date"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes"          TEXT,
  "received_by"    UUID NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_agent_handovers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sales_agent_handovers_sales_agent_id_idx" ON "sales_agent_handovers"("sales_agent_id");
CREATE INDEX IF NOT EXISTS "sales_agent_handovers_date_idx" ON "sales_agent_handovers"("date");

DO $$ BEGIN
  ALTER TABLE "sales_agent_handovers" ADD CONSTRAINT "sales_agent_handovers_sales_agent_id_fkey"
    FOREIGN KEY ("sales_agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "sales_agent_handovers" ADD CONSTRAINT "sales_agent_handovers_received_by_fkey"
    FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
