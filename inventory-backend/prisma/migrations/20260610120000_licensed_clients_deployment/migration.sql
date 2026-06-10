-- AlterTable: add deployment tracking fields to licensed_clients
ALTER TABLE "licensed_clients"
  ADD COLUMN IF NOT EXISTS "contact_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "contact_email" TEXT,
  ADD COLUMN IF NOT EXISTS "backend_url"   TEXT,
  ADD COLUMN IF NOT EXISTS "frontend_url"  TEXT;
