-- A line count of chosen products only — additive.
ALTER TABLE "line_count_sessions" ADD COLUMN IF NOT EXISTS "scope_product_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
