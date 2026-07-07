-- Adds a worker counting link to CycleCountSession (nullable, additive) —
-- independent of stocktake_sessions.public_token. Existing rows (if any) get
-- NULL, which is fine: Postgres unique indexes allow multiple NULLs.

ALTER TABLE "cycle_count_sessions" ADD COLUMN IF NOT EXISTS "public_token" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "cycle_count_sessions_public_token_key" ON "cycle_count_sessions"("public_token");
