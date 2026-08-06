-- Admin TOTP two-factor authentication.
-- totp_enabled defaults to false — this migration does NOT force 2FA onto the
-- existing admin account. An admin must explicitly enroll via the new
-- /auth/totp/enroll + /auth/totp/verify-enroll endpoints before login starts
-- requiring a code.
-- ADDITIVE ONLY — new nullable/default columns. No drops, no data changes.

ALTER TABLE "admin_users"
  ADD COLUMN IF NOT EXISTS "totp_secret" TEXT,
  ADD COLUMN IF NOT EXISTS "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "recovery_codes" TEXT[] DEFAULT ARRAY[]::TEXT[];
