-- Admin login hardening: per-username lockout + login audit trail.
-- ADDITIVE ONLY — new nullable/default columns on admin_users, new table. No drops, no data changes.

ALTER TABLE "admin_users"
  ADD COLUMN IF NOT EXISTS "failed_login_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "locked_until" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "admin_login_logs" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_login_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "admin_login_logs_username_idx" ON "admin_login_logs"("username");
CREATE INDEX IF NOT EXISTS "admin_login_logs_created_at_idx" ON "admin_login_logs"("created_at");
