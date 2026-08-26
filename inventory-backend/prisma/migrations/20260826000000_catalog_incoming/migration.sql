-- «البضاعة القادمة الجديدة»: goods bought but not yet received, and the
-- customers who reserved them. Entirely new tables — nothing existing is
-- touched, so this is safe to apply to a live database.
CREATE TABLE IF NOT EXISTS "catalog_incoming_items" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "image_url"   TEXT,
  "expected_at" TIMESTAMP(3),
  "price"       DECIMAL(12,2),
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "sort_order"  INTEGER NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "catalog_incoming_reservations" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_id"    UUID NOT NULL,
  "phone"      TEXT NOT NULL,
  "name"       TEXT,
  "quantity"   INTEGER NOT NULL DEFAULT 1,
  "note"       TEXT,
  "status"     TEXT NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalog_incoming_reservations_item_fk"
    FOREIGN KEY ("item_id") REFERENCES "catalog_incoming_items"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "catalog_incoming_items_active_sort_idx"
  ON "catalog_incoming_items"("active", "sort_order");
-- One reservation per person per item: pressing «احجز» twice must update the
-- quantity, never queue a second promise for the same goods.
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_incoming_reservations_item_phone_key"
  ON "catalog_incoming_reservations"("item_id", "phone");
CREATE INDEX IF NOT EXISTS "catalog_incoming_reservations_status_idx"
  ON "catalog_incoming_reservations"("status");
