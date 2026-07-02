-- New delivery-aware campaign recipient statuses (SENT kept as legacy).
ALTER TYPE "CampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'SENDING';
ALTER TYPE "CampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'API_ACCEPTED';
ALTER TYPE "CampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "CampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'UNCONFIRMED';

-- Campaign recipient: provider tracking + retry bookkeeping.
ALTER TABLE "campaign_recipients"
  ADD COLUMN IF NOT EXISTS "message_id" TEXT,
  ADD COLUMN IF NOT EXISTS "provider_response" JSONB,
  ADD COLUMN IF NOT EXISTS "failure_code" TEXT,
  ADD COLUMN IF NOT EXISTS "retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "retry_last_attempt_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "processed_at" TIMESTAMP(3);

-- System error log.
DO $$ BEGIN
  CREATE TYPE "ErrorLogSource" AS ENUM ('CAMPAIGN','WHATSAPP','CRON','BACKUP','DATABASE','API','OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ErrorLogLevel" AS ENUM ('INFO','WARN','ERROR','CRITICAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "error_logs" (
  "id" UUID NOT NULL,
  "source" "ErrorLogSource" NOT NULL,
  "level" "ErrorLogLevel" NOT NULL DEFAULT 'ERROR',
  "code" TEXT,
  "message" TEXT NOT NULL,
  "context" JSONB,
  "count" INTEGER NOT NULL DEFAULT 1,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "error_logs_source_resolved_at_idx" ON "error_logs"("source","resolved_at");
CREATE INDEX IF NOT EXISTS "error_logs_last_seen_at_idx" ON "error_logs"("last_seen_at");
CREATE INDEX IF NOT EXISTS "error_logs_created_at_idx" ON "error_logs"("created_at");
