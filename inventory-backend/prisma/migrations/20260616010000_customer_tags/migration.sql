-- Tags for the regular (wholesale) Customer table, used to group customers
-- for targeted WhatsApp broadcasts. Additive + defaulted — safe on prod.

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT '{}';
