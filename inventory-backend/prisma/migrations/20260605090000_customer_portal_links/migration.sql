CREATE TABLE "customer_portal_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "token_hash" TEXT NOT NULL,
  "customer_id" UUID NOT NULL,
  "expires_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_viewed_at" TIMESTAMP(3),

  CONSTRAINT "customer_portal_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_portal_links_token_hash_key" ON "customer_portal_links"("token_hash");
CREATE INDEX "customer_portal_links_customer_id_idx" ON "customer_portal_links"("customer_id");
CREATE INDEX "customer_portal_links_expires_at_idx" ON "customer_portal_links"("expires_at");

ALTER TABLE "customer_portal_links"
ADD CONSTRAINT "customer_portal_links_customer_id_fkey"
FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
