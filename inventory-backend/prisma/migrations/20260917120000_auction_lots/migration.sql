-- «مزاد تصفية الراكد». Additive only: two new tables, nothing existing changes.
CREATE TABLE IF NOT EXISTS "auction_lots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token" TEXT NOT NULL,
    "product_id" UUID NOT NULL,
    "unit" "Unit" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "start_price" DECIMAL(12,2) NOT NULL,
    "increment_type" TEXT NOT NULL,
    "increment_value" DECIMAL(12,2) NOT NULL,
    "current_price" DECIMAL(12,2),
    "bid_count" INTEGER NOT NULL DEFAULT 0,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "winner_bid_id" UUID,
    "notes" TEXT,
    "ended_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "acknowledged_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auction_lots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auction_lots_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "auction_lots_prices_nonnegative" CHECK ("start_price" >= 0 AND "increment_value" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "auction_lots_token_key" ON "auction_lots"("token");
CREATE INDEX IF NOT EXISTS "auction_lots_status_ends_at_idx" ON "auction_lots"("status", "ends_at");
CREATE INDEX IF NOT EXISTS "auction_lots_product_id_idx" ON "auction_lots"("product_id");

DO $$ BEGIN
  ALTER TABLE "auction_lots" ADD CONSTRAINT "auction_lots_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "auction_lots" ADD CONSTRAINT "auction_lots_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "auction_bids" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auction_id" UUID NOT NULL,
    "bidder_name" TEXT NOT NULL,
    "bidder_phone" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "extended_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auction_bids_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "auction_bids_auction_id_created_at_idx" ON "auction_bids"("auction_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "auction_bids" ADD CONSTRAINT "auction_bids_auction_id_fkey"
    FOREIGN KEY ("auction_id") REFERENCES "auction_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
