-- «جرد بالسطور»: additive only, three new tables.
CREATE TABLE IF NOT EXISTS "line_count_sessions" (
  "id" UUID NOT NULL,
  "public_token" TEXT NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "notes" TEXT,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_at" TIMESTAMP(3),
  "finalized_at" TIMESTAMP(3),
  "finalized_by" UUID,
  "sale_invoice_id" UUID,
  "purchase_invoice_id" UUID,
  CONSTRAINT "line_count_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "line_count_sessions_public_token_key" ON "line_count_sessions"("public_token");
CREATE INDEX IF NOT EXISTS "line_count_sessions_warehouse_id_idx" ON "line_count_sessions"("warehouse_id");
CREATE INDEX IF NOT EXISTS "line_count_sessions_status_idx" ON "line_count_sessions"("status");

CREATE TABLE IF NOT EXISTS "line_count_lines" (
  "id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "product_id" UUID NOT NULL,
  "qty" INTEGER NOT NULL,
  "unit" TEXT NOT NULL,
  "qty_pieces" INTEGER NOT NULL,
  "written_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "line_count_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "line_count_lines_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "line_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "line_count_lines_session_id_idx" ON "line_count_lines"("session_id");

CREATE TABLE IF NOT EXISTS "line_count_results" (
  "id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "system_qty" INTEGER NOT NULL,
  "counted_qty" INTEGER NOT NULL,
  "first_written_at" TIMESTAMP(3) NOT NULL,
  "decision" TEXT NOT NULL DEFAULT 'PENDING',
  CONSTRAINT "line_count_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "line_count_results_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "line_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "line_count_results_session_id_product_id_key" ON "line_count_results"("session_id", "product_id");
CREATE INDEX IF NOT EXISTS "line_count_results_session_id_idx" ON "line_count_results"("session_id");
