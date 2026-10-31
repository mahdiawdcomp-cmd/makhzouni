-- «جرد بالسطور»: manager corrections + partial recount (additive only).
ALTER TABLE "line_count_sessions" ADD COLUMN IF NOT EXISTS "recount_product_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "line_count_sessions" ADD COLUMN IF NOT EXISTS "recount_round" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "line_count_lines" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'WORKER';
ALTER TABLE "line_count_lines" ADD COLUMN IF NOT EXISTS "original_qty" INTEGER;
ALTER TABLE "line_count_lines" ADD COLUMN IF NOT EXISTS "original_unit" TEXT;
ALTER TABLE "line_count_lines" ADD COLUMN IF NOT EXISTS "edited_by" UUID;
ALTER TABLE "line_count_lines" ADD COLUMN IF NOT EXISTS "edited_at" TIMESTAMP(3);
ALTER TABLE "line_count_lines" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
ALTER TABLE "line_count_results" ADD COLUMN IF NOT EXISTS "worker_counted_qty" INTEGER;
