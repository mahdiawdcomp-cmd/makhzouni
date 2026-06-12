-- Remove deleted_at column (using isActive instead for soft-delete)
ALTER TABLE "users" DROP COLUMN IF EXISTS "deleted_at";
