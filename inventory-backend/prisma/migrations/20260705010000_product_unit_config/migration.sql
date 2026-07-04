-- Product unit configuration (additive, safe):
-- box_pieces NULL = automatic (half the carton, rounded up)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "box_pieces" INTEGER;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_box_pieces_manual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "hidden_units" "Unit"[] NOT NULL DEFAULT ARRAY[]::"Unit"[];
