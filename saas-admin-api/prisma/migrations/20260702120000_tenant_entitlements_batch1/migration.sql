-- Batch 1: tenant license / entitlements model.
-- ADDITIVE ONLY — new enum + new nullable/default columns. No drops, no data changes.

-- New license type enum
DO $$ BEGIN
  CREATE TYPE "LicenseType" AS ENUM ('SAAS', 'DESKTOP_OFFLINE_LIFETIME', 'TRIAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- New columns on tenants (all nullable or with defaults → safe for existing rows)
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "license_type" "LicenseType" NOT NULL DEFAULT 'SAAS',
  ADD COLUMN IF NOT EXISTS "activated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "trial_ends_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "limits" JSONB,
  ADD COLUMN IF NOT EXISTS "platforms" JSONB,
  ADD COLUMN IF NOT EXISTS "branding" JSONB,
  ADD COLUMN IF NOT EXISTS "internal_notes" TEXT,
  ADD COLUMN IF NOT EXISTS "installer_artifacts" JSONB;
