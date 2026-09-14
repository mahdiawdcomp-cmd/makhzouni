/**
 * Columns and indexes this codebase expects that no migration file creates.
 *
 * The project has carried a handful of idempotent `ADD COLUMN IF NOT EXISTS`
 * statements at boot for a long time — deliberately, so a shop's database
 * self-heals on deploy instead of needing a hand-run migration. They used to
 * live inside `server.ts`, which meant the ONLY way to get a database shaped
 * like production was to start an HTTP server.
 *
 * Extracted here unchanged so two callers can share one copy:
 *  - `server.ts`, exactly as before, at boot;
 *  - the integration test, which provisions a throwaway database and needs it
 *    to look like a real one (`customers.is_both` and friends are missing from
 *    the migration history, and every write to `customers` fails without them).
 *
 * Every statement is idempotent and additive, and each one is wrapped so a
 * single failure cannot stop the server from starting.
 */
import prisma from "./database";
import { logger } from "../utils/logger";

/**
 * Guards against two callers running the DDL at the same time.
 *
 * The server fires this at boot and the integration test calls it while
 * shaping its throwaway database. Both are legitimate; both running the same
 * `ALTER TABLE` concurrently is not — Postgres takes an ACCESS EXCLUSIVE lock
 * per statement, so the second run would either block or deadlock against the
 * first. Whoever calls second simply awaits the first run's result.
 */
let inFlight: Promise<void> | null = null;

export function runStartupMigrations(): Promise<void> {
  if (!inFlight) inFlight = applyStartupMigrations();
  return inFlight;
}

/** For tests that need a second, deliberate run against a fresh database. */
export function resetStartupMigrationsForTests(): void {
  inFlight = null;
}

async function applyStartupMigrations() {
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "is_both" BOOLEAN NOT NULL DEFAULT false`
    );
    logger.info("[migration] customers.is_both column ensured");
  } catch (err) {
    logger.warn("[migration] startup migration warning:", err);
  }

  // Safety net for the campaigns feature — ensures tables exist even if
  // `prisma migrate deploy` wasn't run on this deploy. No-op once created.
  try {
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT','RUNNING','PAUSED','DONE');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`);
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      CREATE TYPE "CampaignRecipientStatus" AS ENUM ('PENDING','SENT','FAILED','SKIPPED');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "campaigns" (
      "id" UUID NOT NULL,
      "name" TEXT NOT NULL,
      "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
      "messages" TEXT[] DEFAULT ARRAY[]::TEXT[],
      "product_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
      "include_catalog_link" BOOLEAN NOT NULL DEFAULT true,
      "min_delay_sec" INTEGER NOT NULL DEFAULT 90,
      "max_delay_sec" INTEGER NOT NULL DEFAULT 240,
      "daily_min" INTEGER NOT NULL DEFAULT 20,
      "daily_max" INTEGER NOT NULL DEFAULT 50,
      "active_start_hour" INTEGER NOT NULL DEFAULT 9,
      "active_end_hour" INTEGER NOT NULL DEFAULT 21,
      "daily_cap_today" INTEGER NOT NULL DEFAULT 0,
      "sent_today" INTEGER NOT NULL DEFAULT 0,
      "day_anchor" TIMESTAMP(3),
      "last_sent_at" TIMESTAMP(3),
      "next_send_at" TIMESTAMP(3),
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
    );`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "campaign_recipients" (
      "id" UUID NOT NULL,
      "campaign_id" UUID NOT NULL,
      "phone" TEXT NOT NULL,
      "name" TEXT,
      "status" "CampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
      "sent_at" TIMESTAMP(3),
      "error" TEXT,
      "variant_used" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
    );`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "campaign_recipients_campaign_id_status_idx" ON "campaign_recipients"("campaign_id","status");`);
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_fkey"
      FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN null; END $$;`);
    logger.info("[migration] campaigns tables ensured");
  } catch (err) {
    logger.warn("[migration] campaigns startup migration warning:", err);
  }

  // Safety net for prospects (زبائن محتملين). No-op once created.
  try {
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      CREATE TYPE "ProspectStatus" AS ENUM ('NEW','CONVERTED');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "prospects" (
      "id" UUID NOT NULL,
      "name" TEXT NOT NULL,
      "phone" TEXT NOT NULL,
      "address" TEXT,
      "source" TEXT,
      "status" "ProspectStatus" NOT NULL DEFAULT 'NEW',
      "converted_customer_id" UUID,
      "last_sent_at" TIMESTAMP(3),
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "prospects_pkey" PRIMARY KEY ("id")
    );`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "prospects_phone_key" ON "prospects"("phone");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "prospects_status_idx" ON "prospects"("status");`);
    logger.info("[migration] prospects table ensured");
  } catch (err) {
    logger.warn("[migration] prospects startup migration warning:", err);
  }

  // Safety net for prospect group-link auto-reply tracking column.
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "group_link_sent_at" TIMESTAMP(3)`
    );
    logger.info("[migration] prospects.group_link_sent_at column ensured");
  } catch (err) {
    logger.warn("[migration] prospects.group_link_sent_at migration warning:", err);
  }

  // Safety net for manual stock-adjustment audit fields. No-op once added.
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "user_id" UUID`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "user_name" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "note" TEXT`);
    logger.info("[migration] stock_movements manual fields ensured");
  } catch (err) {
    logger.warn("[migration] stock_movements manual fields warning:", err);
  }

  // Drop the legacy DB balance triggers (mirrors migration 20260718110000).
  // Their formula predates voucher cancellation + PURCHASE sign handling and
  // they fire AFTER the app-level recalculation on row updates, overwriting
  // correct balances (root cause of the جولة-تدقيق 2026-07-18 corruption).
  try {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "invoices_recalculate_customer_balance" ON "invoices"`);
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "payment_vouchers_recalculate_customer_balance" ON "payment_vouchers"`);
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "customers_opening_balance_recalculate" ON "customers"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS trigger_recalculate_customer_balance()`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS trigger_recalculate_customer_opening_balance()`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS recalculate_customer_balance(UUID)`);
    logger.info("[migration] legacy customer-balance triggers dropped");
  } catch (err) {
    logger.warn("[migration] legacy balance-trigger drop warning:", err);
  }

  // Safety net for invoices/payment_vouchers updated_at — the incremental
  // backup (/backup/changes) selects on it to catch EDITS, not just new rows.
  // Mirrors migration 20260718090000. No-op once added.
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "payment_vouchers" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "invoices_updated_at_idx" ON "invoices"("updated_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "payment_vouchers_updated_at_idx" ON "payment_vouchers"("updated_at")`);
    logger.info("[migration] invoices/payment_vouchers.updated_at ensured");
  } catch (err) {
    logger.warn("[migration] invoices/payment_vouchers.updated_at warning:", err);
  }

  // Safety net for the invoice-item itemNumber snapshot. Adds the column and
  // backfills it from the linked product so OLD invoices keep showing the item
  // number even after the product is soft-deleted. No-op once added/backfilled.
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "item_number" TEXT`);
    await prisma.$executeRawUnsafe(`
      UPDATE "invoice_items" ii
      SET "item_number" = p."item_number"
      FROM "products" p
      WHERE ii."product_id" = p."id" AND ii."item_number" IS NULL`);
    logger.info("[migration] invoice_items.item_number ensured + backfilled");
  } catch (err) {
    logger.warn("[migration] invoice_items.item_number warning:", err);
  }

  // Safety net for campaign delivery-tracking + retry columns and error_logs.
  // No-op once applied. Mirrors migration 20260702020000.
  try {
    await prisma.$executeRawUnsafe(`ALTER TYPE "CampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'SENDING'`);
    await prisma.$executeRawUnsafe(`ALTER TYPE "CampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'API_ACCEPTED'`);
    await prisma.$executeRawUnsafe(`ALTER TYPE "CampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'DELIVERED'`);
    await prisma.$executeRawUnsafe(`ALTER TYPE "CampaignRecipientStatus" ADD VALUE IF NOT EXISTS 'UNCONFIRMED'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "campaign_recipients"
      ADD COLUMN IF NOT EXISTS "message_id" TEXT,
      ADD COLUMN IF NOT EXISTS "provider_response" JSONB,
      ADD COLUMN IF NOT EXISTS "failure_code" TEXT,
      ADD COLUMN IF NOT EXISTS "retry_count" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "retry_last_attempt_at" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "processed_at" TIMESTAMP(3)`);
    logger.info("[migration] campaign_recipients tracking columns ensured");
  } catch (err) {
    logger.warn("[migration] campaign_recipients tracking columns warning:", err);
  }

  try {
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      CREATE TYPE "ErrorLogSource" AS ENUM ('CAMPAIGN','WHATSAPP','CRON','BACKUP','DATABASE','API','OTHER');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`);
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      CREATE TYPE "ErrorLogLevel" AS ENUM ('INFO','WARN','ERROR','CRITICAL');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "error_logs" (
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
    );`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "error_logs_source_resolved_at_idx" ON "error_logs"("source","resolved_at");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "error_logs_last_seen_at_idx" ON "error_logs"("last_seen_at");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "error_logs_created_at_idx" ON "error_logs"("created_at");`);
    logger.info("[migration] error_logs table ensured");
  } catch (err) {
    logger.warn("[migration] error_logs startup migration warning:", err);
  }

  // Safety net for the inbound-messages inbox. No-op once created.
  try {
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      CREATE TYPE "InboundMessageSource" AS ENUM ('CUSTOMER_UNMATCHED','PROSPECT','UNKNOWN');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`);
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      CREATE TYPE "InboundMessageStatus" AS ENUM ('UNREAD','READ','REPLIED');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "inbound_messages" (
      "id" UUID NOT NULL,
      "phone" TEXT NOT NULL,
      "name" TEXT,
      "source" "InboundMessageSource" NOT NULL,
      "message_text" TEXT NOT NULL,
      "status" "InboundMessageStatus" NOT NULL DEFAULT 'UNREAD',
      "reply_text" TEXT,
      "replied_at" TIMESTAMP(3),
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("id")
    );`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "inbound_messages_status_idx" ON "inbound_messages"("status");`);
    logger.info("[migration] inbound_messages table ensured");
  } catch (err) {
    logger.warn("[migration] inbound_messages startup migration warning:", err);
  }

  // Safety net for stock-adjustment financial traceability: lets a manual
  // stock adjustment, stocktake approval, or cycle-count approval record its
  // reason and (if the quantity actually changed) link to a stock_losses row
  // so the variance gets a cost value and enters net-profit reporting instead
  // of being a silent quantity change. No-op once applied.
  try {
    await prisma.$executeRawUnsafe(`ALTER TYPE "LossReason" ADD VALUE IF NOT EXISTS 'COUNT_ERROR'`);
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      CREATE TYPE "StockLossDirection" AS ENUM ('LOSS','GAIN');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`);
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      CREATE TYPE "StockLossSource" AS ENUM ('MANUAL','ADJUST_STOCK','CYCLE_COUNT','STOCKTAKE');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "stock_losses" ADD COLUMN IF NOT EXISTS "direction" "StockLossDirection" NOT NULL DEFAULT 'LOSS'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "stock_losses" ADD COLUMN IF NOT EXISTS "source" "StockLossSource" NOT NULL DEFAULT 'MANUAL'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "stocktake_items" ADD COLUMN IF NOT EXISTS "reason" "LossReason"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "stocktake_items" ADD COLUMN IF NOT EXISTS "loss_id" UUID`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "cycle_count_items" ADD COLUMN IF NOT EXISTS "reason" "LossReason"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "cycle_count_items" ADD COLUMN IF NOT EXISTS "loss_id" UUID`);
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      ALTER TABLE "stocktake_items" ADD CONSTRAINT "stocktake_items_loss_id_fkey"
      FOREIGN KEY ("loss_id") REFERENCES "stock_losses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN null; END $$;`);
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      ALTER TABLE "cycle_count_items" ADD CONSTRAINT "cycle_count_items_loss_id_fkey"
      FOREIGN KEY ("loss_id") REFERENCES "stock_losses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN null; END $$;`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "stocktake_items_loss_id_idx" ON "stocktake_items"("loss_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "cycle_count_items_loss_id_idx" ON "cycle_count_items"("loss_id")`);
    logger.info("[migration] stock-adjustment reason/direction fields ensured");
  } catch (err) {
    logger.warn("[migration] stock-adjustment reason/direction migration warning:", err);
  }
}
