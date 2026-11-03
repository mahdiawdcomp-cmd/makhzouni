-- «جرد بالسطور» hardening — additive only.
ALTER TABLE "line_count_sessions" ADD COLUMN "recount_requested_at" TIMESTAMP(3);
ALTER TABLE "line_count_sessions" ADD COLUMN "submit_id" TEXT;
ALTER TABLE "line_count_sessions" ADD COLUMN "draft" JSONB;

ALTER TABLE "line_count_results" ADD COLUMN "last_written_at" TIMESTAMP(3);
ALTER TABLE "line_count_results" ADD COLUMN "system_qty_first" INTEGER;
ALTER TABLE "line_count_results" ADD COLUMN "system_qty_last" INTEGER;
ALTER TABLE "line_count_results" ADD COLUMN "decided_by" UUID;
ALTER TABLE "line_count_results" ADD COLUMN "decided_at" TIMESTAMP(3);

CREATE TABLE "line_count_events" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID,
    "user_name" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "line_count_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "line_count_events_session_id_created_at_idx" ON "line_count_events"("session_id", "created_at");
ALTER TABLE "line_count_events" ADD CONSTRAINT "line_count_events_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "line_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One live count per warehouse, enforced by the database (a double click used
-- to be able to open two). Not in schema.prisma: Prisma can't express a
-- partial index; createLineCount maps the violation to LINE_COUNT_EXISTS.
CREATE UNIQUE INDEX "line_count_sessions_one_live_per_warehouse"
    ON "line_count_sessions"("warehouse_id") WHERE "status" IN ('OPEN', 'SUBMITTED');
