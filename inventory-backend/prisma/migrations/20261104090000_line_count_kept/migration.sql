-- «خلّيها» on uncounted products — additive only.
ALTER TABLE "line_count_sessions" ADD COLUMN IF NOT EXISTS "kept_product_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
