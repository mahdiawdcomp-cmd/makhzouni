-- Order double-submit protection. Additive and nullable: existing rows keep
-- NULL, and Postgres allows many NULLs in a unique index.
ALTER TABLE "pending_approvals" ADD COLUMN IF NOT EXISTS "client_request_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "pending_approvals_client_request_id_key"
  ON "pending_approvals"("client_request_id");
