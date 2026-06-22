-- Add public_token to stocktake_sessions for worker access links
ALTER TABLE "stocktake_sessions" ADD COLUMN IF NOT EXISTS "public_token" TEXT;

-- Back-fill existing sessions with a unique token
UPDATE "stocktake_sessions"
  SET "public_token" = 'stk_' || encode(gen_random_bytes(24), 'base64')
  WHERE "public_token" IS NULL;

-- Now make it NOT NULL and UNIQUE
ALTER TABLE "stocktake_sessions"
  ALTER COLUMN "public_token" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "stocktake_sessions_public_token_key"
  ON "stocktake_sessions"("public_token");
