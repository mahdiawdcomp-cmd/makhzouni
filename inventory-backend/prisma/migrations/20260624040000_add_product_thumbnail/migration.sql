-- Add thumbnail_url column for fast product-list image loading
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "thumbnail_url" TEXT;
