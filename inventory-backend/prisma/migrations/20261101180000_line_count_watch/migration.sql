CREATE TABLE IF NOT EXISTS "line_count_watches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "counted_at" TIMESTAMP(3) NOT NULL,
  "system_qty" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "line_count_watches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "line_count_watches_session_id_product_id_key" ON "line_count_watches"("session_id", "product_id");
CREATE INDEX IF NOT EXISTS "line_count_watches_warehouse_id_product_id_idx" ON "line_count_watches"("warehouse_id", "product_id");
