-- Canonical customer tag list, so tags can be created/renamed/deleted
-- independently of customer assignment. Additive + idempotent — safe on prod.
CREATE TABLE IF NOT EXISTS "customer_tags" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_tags_name_key" ON "customer_tags"("name");

-- Backfill the canonical list from tags already attached to customers.
INSERT INTO "customer_tags" ("id", "name")
SELECT gen_random_uuid(), t.tag
FROM (SELECT DISTINCT unnest("tags") AS tag FROM "customers" WHERE "tags" IS NOT NULL) t
WHERE t.tag IS NOT NULL AND t.tag <> ''
ON CONFLICT ("name") DO NOTHING;
