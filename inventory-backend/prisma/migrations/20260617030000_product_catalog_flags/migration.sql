-- Wholesale-catalog merchandising flags on products, mirroring the retail
-- catalog: mark an item as a new arrival or as on-offer (with an optional
-- old price to strike through). Additive + defaulted — safe on prod.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_new_arrival" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_offer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "old_price" DECIMAL(12,2);
