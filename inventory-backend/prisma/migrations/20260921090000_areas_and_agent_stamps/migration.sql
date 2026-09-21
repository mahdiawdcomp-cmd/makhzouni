-- «المنطقة» becomes a row instead of a string in settings.salesAgentAreas.
-- Additive only: customers.area (the text column) is untouched, so every screen
-- that reads it keeps working while areaId fills in behind it.
CREATE TABLE IF NOT EXISTS "areas" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "center_lat" DECIMAL(10,7),
    "center_lng" DECIMAL(10,7),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "areas_name_key" ON "areas"("name");
CREATE INDEX IF NOT EXISTS "areas_is_active_sort_order_idx" ON "areas"("is_active", "sort_order");

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "area_id" UUID;

DO $$ BEGIN
    ALTER TABLE "customers" ADD CONSTRAINT "customers_area_id_fkey"
        FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Where the rep stood when they filed one action. NOT a movement trace: a row
-- exists only because the rep did something, never because time passed.
CREATE TABLE IF NOT EXISTS "sales_agent_stamps" (
    "id" UUID NOT NULL,
    "sales_agent_id" UUID NOT NULL,
    "customer_id" UUID,
    "action" TEXT NOT NULL,
    "reference_id" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "accuracy_m" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "distance_m" INTEGER,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_agent_stamps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sales_agent_stamps_sales_agent_id_created_at_idx" ON "sales_agent_stamps"("sales_agent_id", "created_at");
CREATE INDEX IF NOT EXISTS "sales_agent_stamps_customer_id_idx" ON "sales_agent_stamps"("customer_id");

DO $$ BEGIN
    ALTER TABLE "sales_agent_stamps" ADD CONSTRAINT "sales_agent_stamps_sales_agent_id_fkey"
        FOREIGN KEY ("sales_agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
