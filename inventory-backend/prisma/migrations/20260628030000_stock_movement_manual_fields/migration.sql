-- AlterTable: manual stock-adjustment audit fields
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "user_id" UUID;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "user_name" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "note" TEXT;
