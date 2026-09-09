-- «تنبيهات الموظف الذكي» — escalations get their own list instead of sharing
-- the inbound-message inbox, where a real order was one row away from being
-- buried under "شكرا" and "وك". Additive only.

CREATE TABLE IF NOT EXISTS "ai_escalations" (
  "id"            UUID NOT NULL,
  "phone"         TEXT NOT NULL,
  "customer_id"   UUID,
  "customer_name" TEXT,
  "summary"       TEXT NOT NULL,
  "customer_text" TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'OPEN',
  "handled_at"    TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_escalations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_escalations_status_created_at_idx" ON "ai_escalations"("status", "created_at");

-- Carry over escalations already written to the inbox by the previous version,
-- so the shop's first real one (a tuktuk carton order) isn't left behind in a
-- list it is being moved out of. The inbox rows stay where they are — this
-- copies, it does not delete.
INSERT INTO "ai_escalations" ("id", "phone", "customer_name", "summary", "customer_text", "status", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  m."phone",
  m."name",
  -- Text shape written by the old code:
  --   [الموظف الذكي] <summary>\n— رسالة الزبون: <customer text>
  COALESCE(NULLIF(TRIM(SPLIT_PART(REPLACE(m."message_text", '[الموظف الذكي] ', ''), E'\n— رسالة الزبون: ', 1)), ''), m."message_text"),
  COALESCE(NULLIF(TRIM(SPLIT_PART(m."message_text", E'\n— رسالة الزبون: ', 2)), ''), ''),
  CASE WHEN m."status" = 'UNREAD' THEN 'OPEN' ELSE 'HANDLED' END,
  m."created_at",
  m."created_at"
FROM "inbound_messages" m
WHERE m."message_text" LIKE '[الموظف الذكي]%';
