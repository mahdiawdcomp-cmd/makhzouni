import "dotenv/config";
import { reportStartupEnvIssues, validateStartupEnv } from "./config/validate-env";

// Validate names and presence only. Never print environment values.
const startupEnvIssues = validateStartupEnv();
reportStartupEnvIssues(startupEnvIssues);
if (startupEnvIssues.some((item) => item.level === "fatal")) process.exit(1);

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
import { logger, setLoggerErrorSink } from "./utils/logger";
import { runStartupMigrations } from "./config/startup-migrations";
import { recordError } from "./services/error-log.service";
import { realtimeHeartbeat } from "./services/realtime.service";
import { reportOnlyEntitlementsMiddleware, enforceReadOnlyMiddleware, enforceFeatureMiddleware, enforcePlatformMiddleware } from "./middleware/tenant.middleware";
import { ensureInitialAdmin } from "./services/initial-admin.service";
import prisma from "./config/database";

const app = express();
const port = Number(process.env.PORT ?? 5000);
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ??
  process.env.ALLOWED_ORIGIN ??
  // No tenant domain is hardcoded — every `*.mazbwoni.com` subdomain is matched by
  // regex below, so this default must never name a single shop. The Vercel alias is
  // the SHARED web app's own origin (all tenants load from it), not a tenant.
  "https://inventory-web-six-kohl.vercel.app,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:5175,http://127.0.0.1:5175,http://localhost:4173,http://127.0.0.1:4173,http://localhost:8080,http://localhost:1421,http://127.0.0.1:1421"
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
app.use(express.json({
  limit: "8mb",   // صور base64 تحتاج حد أكبر
  // Preserve the raw body so the Meta webhook can verify X-Hub-Signature-256.
  // Additive only — does not change how any existing route reads req.body.
  verify: (req, _res, buf) => { (req as unknown as { rawBody?: Buffer }).rawBody = buf; },
}));
app.use(requestLogger);
app.use(auditLogMiddleware);
app.use(realtimeMutationMiddleware);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "inventory-backend" });
});

// Batch 3 — report-only entitlements check. Never blocks; only logs when a
// mapped route is hit without its required feature (see tenant.middleware.ts).
app.use("/api", reportOnlyEntitlementsMiddleware);
// Batch 5 / 5.1 — read-only enforcement for expired/suspended SaaS tenants.
// This is the SINGLE gate for subscription state. It replaces the old
// requireActiveSubscription full-block (which 403'd even GETs): now reads,
// exports, prints and backups pass while business-data writes return 423
// READ_ONLY_MODE. Self-guards — no-op in standalone (mahdi), fails open if
// tenant state can't be resolved (Super Admin down with no cache).
app.use("/api", enforceReadOnlyMiddleware);
// Batch 6 — paid-feature entitlement enforcement. MUST run AFTER
// enforceReadOnlyMiddleware: if a request is both read-only-blocked (expired/
// suspended subscription) AND missing a feature, the response must be
// READ_ONLY_MODE (423), not FEATURE_NOT_ENABLED (403) — subscription expiry is
// the more fundamental reason. Only reaches this middleware if read-only let
// the request through. Self-guards — no-op in standalone (mahdi), fails open if
// tenant state can't be resolved. OPTIONS preflight always passes.
app.use("/api", enforceFeatureMiddleware);
// Platform entitlement. After the two above so subscription state and feature
// entitlements keep their priority in the response. Keyed off the client's
// declared X-Client-Platform header; unknown/absent clients pass through.
app.use("/api", enforcePlatformMiddleware);
app.use("/api", apiLimiter, apiRoutes);
app.use((_req, _res, next) => {
  next(new AppError("Route not found", 404, "ROUTE_NOT_FOUND"));
});
app.use(errorHandler);

// Forward logger.error(...) calls into ErrorLog so they surface on /error-logs.
// recordError never throws and dedups by (source, code, message).
setLoggerErrorSink((message) => {
  void recordError({ source: "OTHER", code: "LOGGER_ERROR", message });
});

// Prevent WhatsApp/Puppeteer crashes from killing the whole server
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException] Server kept alive:", err.message);
  void recordError({ source: "OTHER", code: "UNCAUGHT_EXCEPTION", level: "CRITICAL", message: err.message });
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection] Server kept alive:", reason);
  void recordError({
    source: "OTHER",
    code: "UNHANDLED_REJECTION",
    level: "CRITICAL",
    message: reason instanceof Error ? reason.message : String(reason),
  });
});

// Boot-time schema self-healing lives in `config/startup-migrations.ts` so
// the integration test can shape a throwaway database the same way.
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
