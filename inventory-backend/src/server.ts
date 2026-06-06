import "dotenv/config";
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
app.use(helmet());
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
  // WhatsApp only runs when explicitly enabled (requires local Chrome)
  if (process.env.ENABLE_WHATSAPP === "true") {
    try { initializeWhatsApp(); } catch (e) { console.warn("WhatsApp init skipped:", e); }
  }
});
