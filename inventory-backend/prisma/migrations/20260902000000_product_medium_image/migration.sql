-- Gallery-sized image copy. Additive and nullable: every existing product keeps
-- working on its thumbnail until the gallery asks for a medium and one is made.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "medium_url" TEXT;
