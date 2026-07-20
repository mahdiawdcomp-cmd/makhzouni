-- Cumulative catalog-open counter per customer access link.
ALTER TABLE "catalog_access_links" ADD COLUMN "view_count" INTEGER NOT NULL DEFAULT 0;
