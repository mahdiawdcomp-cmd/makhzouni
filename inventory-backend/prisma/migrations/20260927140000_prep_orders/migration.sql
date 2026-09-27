-- «شاشة التجهيز»: persisted open prep orders. Additive only.
CREATE TABLE IF NOT EXISTS "prep_orders" (
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "prep_orders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "prep_orders_updated_at_idx" ON "prep_orders"("updated_at");
