-- A visitor can now be explicitly shut out of prices, not only explicitly let
-- in — so a shop that opens prices to everyone can still close one person.
ALTER TABLE "catalog_visitors"
  ADD COLUMN IF NOT EXISTS "prices_hidden" BOOLEAN NOT NULL DEFAULT false;
