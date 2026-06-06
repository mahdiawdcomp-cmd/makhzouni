CREATE TABLE IF NOT EXISTS "catalog_access_links" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "token" TEXT NOT NULL UNIQUE,
  "token_hash" TEXT NOT NULL UNIQUE,
  "customer_id" UUID NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "allow_prices" BOOLEAN NOT NULL DEFAULT false,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_viewed_at" TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "catalog_access_links_customer_id_idx" ON "catalog_access_links"("customer_id");
