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
import { errorHandler } from "./middleware/error-handler.middleware";
import { requestLogger } from "./middleware/request-logger.middleware";
import { auditLogMiddleware } from "./middleware/audit-log.middleware";
import { AppError } from "./utils/app-error";
import { startNotificationJobs } from "./services/notification-jobs.service";
import { initializeWhatsApp } from "./services/whatsapp.service";
import { getSettings } from "./services/settings.service";
import { apiLimiter } from "./middleware/rate-limit.middleware";
import { logger } from "./utils/logger";

const app = express();
const port = Number(process.env.PORT ?? 5000);
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ??
  process.env.ALLOWED_ORIGIN ??
  "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:5175,http://127.0.0.1:5175,http://localhost:4173,http://127.0.0.1:4173,http://localhost:8080"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

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
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json({ limit: "8mb" }));   // صور base64 تحتاج حد أكبر
app.use(requestLogger);
app.use(auditLogMiddleware);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "inventory-backend" });
});

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

app.listen(port, "0.0.0.0", () => {
  logger.info(`Inventory backend is running on port ${port}`);
  startNotificationJobs();

  // Load DB settings to sync WhatsApp Cloud API credentials into the WA service
  getSettings().catch((e) => logger.warn("Failed to preload settings:", e));

  // WhatsApp only runs when explicitly enabled (requires local Chrome for web provider)
  if (process.env.ENABLE_WHATSAPP === "true") {
    try { initializeWhatsApp(); } catch (e) { console.warn("WhatsApp init skipped:", e); }
  }
});
