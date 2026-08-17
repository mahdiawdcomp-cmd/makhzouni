-- Additive only. Optional deadline for a product's offer, so the storefront
-- can show a countdown. NULL (every existing row) means the offer has no end
-- date — never that it has already expired.
ALTER TABLE "products" ADD COLUMN "offer_ends_at" TIMESTAMP(3);
