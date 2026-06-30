import "dotenv/config";

// ── Startup environment validation ─────────────────────────────────────────
const WEAK_JWT = "change-this-secret-before-production";
if (!process.env.DATABASE_URL) {
  console.error("[FATAL] DATABASE_URL is not set. Server cannot start.");
  process.exit(1);
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === WEAK_JWT) {
  if (process.env.NODE_ENV === "production") {
    console.error("[FATAL] JWT_SECRET must be set to a strong random value in production.");
    process.exit(1);
  } else {
    console.warn("[WARN] JWT_SECRET is weak or missing. Set a strong secret before deploying.");
  }
}

import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import apiRoutes from "./routes";
import { verifyLicense } from "./services/license.service";
import { errorHandler } from "./middleware/error-handler.middleware";
import { requestLogger } from "./middleware/request-logger.middleware";
import { auditLogMiddleware } from "./middleware/audit-log.middleware";
import { realtimeMutationMiddleware } from "./middleware/realtime.middleware";
import { AppError } from "./utils/app-error";
import { startNotificationJobs } from "./services/notification-jobs.service";
import { initializeWhatsApp } from "./services/whatsapp.service";
import { getSettings } from "./services/settings.service";
import { backfillThumbnails } from "./services/product.service";
import { apiLimiter } from "./middleware/rate-limit.middleware";
import { logger } from "./utils/logger";
import { realtimeHeartbeat } from "./services/realtime.service";
import { requireActiveSubscription } from "./middleware/tenant.middleware";
import { ensureInitialAdmin } from "./services/initial-admin.service";
import prisma from "./config/database";

const app = express();
const port = Number(process.env.PORT ?? 5000);
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ??
  process.env.ALLOWED_ORIGIN ??
  "https://mahdi.mazbwoni.com,https://inventory-web-six-kohl.vercel.app,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:5175,http://127.0.0.1:5175,http://localhost:4173,http://127.0.0.1:4173,http://localhost:8080,http://localhost:1421,http://127.0.0.1:1421"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isCorsAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  // Allow all *.mazbwoni.com subdomains automatically
  if (/^https:\/\/[a-z0-9-]+\.mazbwoni\.com$/.test(origin)) return true;
  // Allow Tauri desktop app (tauri.localhost or tauri://localhost)
  if (origin === "https://tauri.localhost" || origin === "http://tauri.localhost" || origin === "tauri://localhost") return true;
  return false;
}

app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: false,       // API only — no HTML served
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 60 * 60 * 24 * 365,      // 1 year HSTS
    includeSubDomains: true,
    preload: true,
  },
}));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(compression());
app.use(cors({
  origin: (origin, callback) => {
    if (isCorsAllowed(origin)) callback(null, true);
    else callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(express.json({ limit: "8mb" }));   // صور base64 تحتاج حد أكبر
app.use(requestLogger);
app.use(auditLogMiddleware);
app.use(realtimeMutationMiddleware);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "inventory-backend" });
});

// When TENANT_ID is set, block all API calls if subscription is suspended/expired.
// /api/tenant-info and /api/public are exempt (needed to show the expired page).
if (process.env.TENANT_ID) {
  app.use("/api", (req, res, next) => {
    const exempt = req.path.startsWith("/tenant-info") || req.path.startsWith("/public");
    if (exempt) return next();
    requireActiveSubscription(req, res, next);
  });
}
app.use("/api", apiLimiter, apiRoutes);
app.use((_req, _res, next) => {
  next(new AppError("Route not found", 404, "ROUTE_NOT_FOUND"));
});
app.use(errorHandler);

// Prevent WhatsApp/Puppeteer crashes from killing the whole server
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException] Server kept alive:", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection] Server kept alive:", reason);
});

async function runStartupMigrations() {
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
}

void runStartupMigrations();

app.listen(port, "0.0.0.0", () => {
  logger.info(`Inventory backend is running on port ${port}`);
  ensureInitialAdmin().catch((error) => {
    logger.error("Failed to create initial administrator:", error);
  });
  setInterval(realtimeHeartbeat, 25_000).unref();
  // Verify license on startup (non-fatal — system runs even without license)
  verifyLicense();
  startNotificationJobs();

  // Load DB settings to sync WhatsApp Cloud API credentials into the WA service
  getSettings().catch((e) => logger.warn("Failed to preload settings:", e));

  // One-time (self-healing) thumbnail backfill: generate small thumbnails for
  // existing products that have a full image but no thumbnail yet. Runs in the
  // background and is a no-op once every product has a thumbnail.
  void backfillThumbnails()
    .then((r) => { if (r.updated > 0) logger.info(`[thumbnails] backfilled ${r.updated}/${r.scanned} products`); })
    .catch((e) => logger.warn("[thumbnails] backfill skipped:", e));

  // WhatsApp only runs when explicitly enabled (requires local Chrome for web provider)
  if (process.env.ENABLE_WHATSAPP === "true") {
    try { initializeWhatsApp(); } catch (e) { console.warn("WhatsApp init skipped:", e); }
  }
});
