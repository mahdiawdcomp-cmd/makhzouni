-- Additive only. Lets a customer sign in to the storefront with their phone
-- number plus a 6-digit code, instead of only through an unguessable link.
--
-- Only the bcrypt hash of the code is stored, the same way staff passwords
-- are: a lost code is replaced by generating a new one, never recovered.
--
-- A 6-digit code is a small keyspace, so the throttling columns are what
-- actually make it safe — 5 failures locks the account for 15 minutes.

ALTER TABLE "customers" ADD COLUMN "access_code_hash" TEXT;
ALTER TABLE "customers" ADD COLUMN "access_code_set_at" TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN "last_login_at" TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "customers" ADD COLUMN "locked_until" TIMESTAMP(3);

-- Per-customer override of the shop-wide "show prices to signed-in customers"
-- default. FALSE for every existing row, i.e. nobody is newly hidden.
ALTER TABLE "customers" ADD COLUMN "catalog_prices_hidden" BOOLEAN NOT NULL DEFAULT false;

-- The same credentials for a phone number that has browsed the catalog but is
-- not a customer yet, so the shop can send logins to every number it knows.
-- Their details go through the approvals queue before a Customer row exists.
ALTER TABLE "catalog_visitors" ADD COLUMN "access_code_hash" TEXT;
ALTER TABLE "catalog_visitors" ADD COLUMN "access_code_set_at" TIMESTAMP(3);
ALTER TABLE "catalog_visitors" ADD COLUMN "last_login_at" TIMESTAMP(3);
ALTER TABLE "catalog_visitors" ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "catalog_visitors" ADD COLUMN "locked_until" TIMESTAMP(3);
ALTER TABLE "catalog_visitors" ADD COLUMN "details_submitted_at" TIMESTAMP(3);
