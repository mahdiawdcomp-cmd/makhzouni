import path from "path";
import fs from "fs";

// ── Prisma native engine path (needed when running as pkg exe) ───────────────
// When bundled with pkg, __dirname is a virtual snapshot path.
// We look for the engine binary next to the actual executable first.
if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY) {
  const exeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(exeDir, "query_engine-windows.dll.node"),
    path.join(__dirname, "query_engine-windows.dll.node"),
    path.join(__dirname, "..", "query_engine-windows.dll.node"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      process.env.PRISMA_QUERY_ENGINE_LIBRARY = candidate;
      break;
    }
  }
}

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
  "https://inventory-web-six-kohl.vercel.app,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:5175,http://127.0.0.1:5175,http://localhost:4173,http://127.0.0.1:4173,http://localhost:8080"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isCorsAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  // Allow all *.mazbwoni.com subdomains automatically
  if (/^https:\/\/[a-z0-9-]+\.mazbwoni\.com$/.test(origin)) return true;
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

// ── Auto-initialize SQLite database on first run ─────────────────────────────
async function initializeDatabase() {
  // Check if DB needs migration by trying to query the users table
  const needsMigration = await prisma.$queryRaw`
    SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='users'
  `.then((rows: any) => Number((rows as any)[0]?.c ?? 0) === 0).catch(() => true);

  if (needsMigration) {
    logger.info("[DB] Running initial migration…");
    // Read migration SQL bundled alongside the exe
    const candidates = [
      path.join(path.dirname(process.execPath), "migration.sql"),
      path.join(__dirname, "..", "..", "prisma", "migrations", "20260623025926_init", "migration.sql"),
      path.join(__dirname, "migration.sql"),
    ];
    let sql = "";
    for (const c of candidates) {
      if (fs.existsSync(c)) { sql = fs.readFileSync(c, "utf8"); break; }
    }
    if (sql) {
      // SQLite: execute each statement separately
      const statements = sql.split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        await prisma.$executeRawUnsafe(stmt).catch(() => {});
      }
      logger.info("[DB] Migration applied.");
    } else {
      logger.warn("[DB] Migration SQL not found — DB may be empty.");
    }
  }
}

app.listen(port, "0.0.0.0", async () => {
  logger.info(`Inventory backend is running on port ${port}`);
  // Initialize DB schema if first run (local SQLite mode)
  await initializeDatabase().catch((e) => logger.warn("[DB] Init error:", e));
  ensureInitialAdmin().catch((error) => {
    logger.error("Failed to create initial administrator:", error);
  });
  setInterval(realtimeHeartbeat, 25_000).unref();
  // Verify license on startup (non-fatal — system runs even without license)
  verifyLicense();
  startNotificationJobs();

  // Load DB settings to sync WhatsApp Cloud API credentials into the WA service
  getSettings().catch((e) => logger.warn("Failed to preload settings:", e));

  // WhatsApp only runs when explicitly enabled (requires local Chrome for web provider)
  if (process.env.ENABLE_WHATSAPP === "true") {
    try { initializeWhatsApp(); } catch (e) { console.warn("WhatsApp init skipped:", e); }
  }
});
