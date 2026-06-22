-- Phase 5: Product arrival subscriptions for customer portal
CREATE TABLE IF NOT EXISTS "product_arrival_subscriptions" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "customer_id"      UUID NOT NULL,
  "product_id"       UUID,
  "product_name"     TEXT NOT NULL,
  "phone"            TEXT NOT NULL,
  "push_subscription" JSONB,
  "notified_at"      TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_arrival_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_arrival_subscriptions_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_arrival_subscriptions_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "product_arrival_subscriptions_customer_id_idx"
  ON "product_arrival_subscriptions"("customer_id");

CREATE INDEX IF NOT EXISTS "product_arrival_subscriptions_product_id_idx"
  ON "product_arrival_subscriptions"("product_id");
