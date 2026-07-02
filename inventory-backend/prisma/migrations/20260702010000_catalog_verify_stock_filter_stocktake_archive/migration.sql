-- Per-customer catalog display filter + OTP re-verification window
CREATE TYPE "CatalogStockFilter" AS ENUM ('ALL_PRODUCTS', 'FULL_CARTON_ONLY');

ALTER TABLE "catalog_access_links"
  ADD COLUMN "catalog_stock_filter" "CatalogStockFilter" NOT NULL DEFAULT 'FULL_CARTON_ONLY',
  ADD COLUMN "last_verified_at" TIMESTAMP(3);

-- Stocktake: soft-delete (archive) + who closed the session
ALTER TABLE "stocktake_sessions"
  ADD COLUMN "closed_by" TEXT,
  ADD COLUMN "archived_at" TIMESTAMP(3);
