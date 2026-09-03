-- Idempotency key on the cash handover. A double tap used to book the cash
-- twice; the retry now returns the handover the first press created.
-- Additive and nullable: existing rows keep NULL, and NULL repeats freely
-- under a UNIQUE index in Postgres, so old rows never collide.
ALTER TABLE "sales_agent_handovers" ADD COLUMN IF NOT EXISTS "client_request_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "sales_agent_handovers_client_request_id_key"
  ON "sales_agent_handovers"("client_request_id");
