ALTER TABLE "catalog_access_links" ADD COLUMN IF NOT EXISTS "show_stock" BOOLEAN NOT NULL DEFAULT true;
