-- In-app notification center foundation (batch 23B, additive & safe).
-- SEPARATE from the legacy "notifications" table (customer WhatsApp/marketing log),
-- which is left completely untouched. This table is not written to yet.
CREATE TABLE IF NOT EXISTS "app_notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "type" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "role_target" TEXT,
  "recipient_user_id" UUID,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "action_url" TEXT,
  "metadata" JSONB,
  "dedupe_key" TEXT,
  "count" INTEGER NOT NULL DEFAULT 1,
  "read_at" TIMESTAMP(3),
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "app_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "app_notifications_role_target_created_at_idx" ON "app_notifications" ("role_target", "created_at");
CREATE INDEX IF NOT EXISTS "app_notifications_recipient_user_id_created_at_idx" ON "app_notifications" ("recipient_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "app_notifications_category_created_at_idx" ON "app_notifications" ("category", "created_at");
CREATE INDEX IF NOT EXISTS "app_notifications_severity_created_at_idx" ON "app_notifications" ("severity", "created_at");
CREATE INDEX IF NOT EXISTS "app_notifications_entity_type_entity_id_idx" ON "app_notifications" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "app_notifications_dedupe_key_idx" ON "app_notifications" ("dedupe_key");
