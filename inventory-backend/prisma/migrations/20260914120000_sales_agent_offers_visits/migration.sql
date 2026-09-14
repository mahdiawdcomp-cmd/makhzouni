-- «المندوب»: عروض خاصة بالزبون + سجل الزيارات + إحداثيات الزبون.
-- Additive only: new nullable columns and new tables. Nothing is dropped or
-- rewritten, so existing rows, prices and invoices are untouched.

-- Shop coordinates for the rep's visit map. Nullable: almost every existing
-- customer has none, and the map has to work without them.
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "latitude" DECIMAL(10,7);
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "longitude" DECIMAL(10,7);

-- «عرض خاص للزبون» — one standing, time-boxed price per (customer, product, unit).
CREATE TABLE IF NOT EXISTS "sales_agent_customer_offers" (
  "id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "unit" "Unit" NOT NULL,
  "price_mode" TEXT NOT NULL DEFAULT 'WHOLESALE',
  "discount_type" "DiscountType" NOT NULL,
  "fixed_price" DECIMAL(12,2),
  "discount_percent" DECIMAL(5,2),
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT,
  "created_by" UUID NOT NULL,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_agent_customer_offers_pkey" PRIMARY KEY ("id")
);

-- The no-overlap rule, enforced by the DATABASE rather than by a read-then-write
-- check that two concurrent requests would both pass.
--
-- What is forbidden is two ACTIVE offers whose windows overlap for the same
-- customer, product, unit and price basis. What is allowed — and needed — is a
-- history of finished offers, a scheduled future offer, and paused rows. The
-- window is half-open `[starts_at, ends_at)`, so an offer that ends at the
-- instant the next one starts does not collide with it.
--
-- The partial `WHERE (is_active)` is what makes pausing work: a paused row is
-- out of the way, and re-activating one whose window overlaps a live offer
-- fails here (SQLSTATE 23P01) instead of silently producing two prices.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "sales_agent_customer_offers"
  ADD CONSTRAINT "sales_agent_offers_no_overlap"
  EXCLUDE USING gist (
    "customer_id" WITH =,
    "product_id" WITH =,
    "unit" WITH =,
    "price_mode" WITH =,
    tsrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("is_active");

-- Reading "the offer live right now for this customer" and "offers ending soon".
CREATE INDEX IF NOT EXISTS "sales_agent_customer_offers_customer_id_is_active_ends_at_idx"
  ON "sales_agent_customer_offers" ("customer_id", "is_active", "ends_at");
-- Reading one product/unit/basis timeline for a customer, newest window first.
CREATE INDEX IF NOT EXISTS "sales_agent_offers_customer_product_unit_mode_idx"
  ON "sales_agent_customer_offers" ("customer_id", "product_id", "unit", "price_mode", "starts_at");
CREATE INDEX IF NOT EXISTS "sales_agent_customer_offers_product_id_idx"
  ON "sales_agent_customer_offers" ("product_id");

ALTER TABLE "sales_agent_customer_offers"
  ADD CONSTRAINT "sales_agent_customer_offers_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_agent_customer_offers"
  ADD CONSTRAINT "sales_agent_customer_offers_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_agent_customer_offers"
  ADD CONSTRAINT "sales_agent_customer_offers_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_agent_customer_offers"
  ADD CONSTRAINT "sales_agent_customer_offers_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- «زيارة» — visits the rep chose to record. Never a location trail.
CREATE TABLE IF NOT EXISTS "sales_agent_visits" (
  "id" UUID NOT NULL,
  "client_request_id" TEXT,
  "sales_agent_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMP(3),
  "outcome" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_agent_visits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sales_agent_visits_client_request_id_key"
  ON "sales_agent_visits" ("client_request_id");
CREATE INDEX IF NOT EXISTS "sales_agent_visits_sales_agent_id_started_at_idx"
  ON "sales_agent_visits" ("sales_agent_id", "started_at");
CREATE INDEX IF NOT EXISTS "sales_agent_visits_customer_id_idx"
  ON "sales_agent_visits" ("customer_id");

ALTER TABLE "sales_agent_visits"
  ADD CONSTRAINT "sales_agent_visits_sales_agent_id_fkey"
  FOREIGN KEY ("sales_agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_agent_visits"
  ADD CONSTRAINT "sales_agent_visits_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
