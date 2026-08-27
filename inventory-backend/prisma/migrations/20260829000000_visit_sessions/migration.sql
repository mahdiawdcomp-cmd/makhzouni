-- Individual browsing visits behind the running total on catalog_visitors.
-- New table only; the existing counters keep working untouched, and history
-- necessarily starts from the moment this ships.
CREATE TABLE IF NOT EXISTS "catalog_visit_sessions" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "phone"        TEXT NOT NULL,
  "started_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_beat_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "seconds"      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "catalog_visit_sessions_phone_started_idx"
  ON "catalog_visit_sessions"("phone", "started_at");
