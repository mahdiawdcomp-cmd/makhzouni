import "dotenv/config";

if (!process.env.DATABASE_URL) {
  console.error("[FATAL] DATABASE_URL is not set.");
  process.exit(1);
}
// Known weak/placeholder secrets that must never reach production. The two
// route files fall back to "dev-secret" for local convenience, so we must
// reject it here (and any unset secret) before any token is signed/verified.
const WEAK_JWT_SECRETS = new Set(["change-this-strong-secret", "dev-secret"]);
const jwtSecret = process.env.JWT_SECRET;
if (jwtSecret && (WEAK_JWT_SECRETS.has(jwtSecret) || jwtSecret.length < 32)) {
  // Reject an explicitly-configured weak/short secret in every environment —
  // not just when NODE_ENV is exactly "production". Relying on that single
  // env var being configured correctly on every deploy target was the actual
  // gap: a misconfigured NODE_ENV would let a placeholder secret slip through
  // production with nothing but a warning.
  console.error("[FATAL] JWT_SECRET is set but weak or too short (must be a random string of at least 32 characters).");
  process.exit(1);
} else if (!jwtSecret) {
  if (process.env.NODE_ENV === "production") {
    console.error("[FATAL] JWT_SECRET must be set to a strong random value in production.");
    process.exit(1);
  } else {
    console.warn("[WARN] JWT_SECRET is unset — using an insecure dev fallback. Do NOT use in production.");
  }
}

import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import routes from "./routes";
import { startFleetWatch } from "./services/fleet-watch.service";

const app = express();
const port = Number(process.env.PORT ?? 4000);

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173,http://localhost:5174")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || /^https:\/\/[a-z0-9-]+\.mazbwoni\.com$/i.test(origin)) {
      callback(null, true);
      return;
    }
    // Reject without throwing: cors responds normally (204 on preflight) but
    // omits the Access-Control-Allow-Origin header, so the browser blocks it.
    // Throwing an Error here used to propagate to Express's default error
    // handler, which returned a raw 500 for every disallowed-origin preflight.
    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "1mb" }));

// This service owns every tenant's subscription state, feature entitlements,
// activation serials and backend URL. It had no rate limiting at all, so the
// single admin password could be brute-forced at network speed, and both
// /api/activate (serial redemption) and /api/tenant-config (tenant enumeration)
// could be swept without cost.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed attempts count toward the cap
  message: {
    success: false,
    message: "محاولات دخول كثيرة. حاول بعد ١٥ دقيقة.",
    code: "LOGIN_RATE_LIMITED",
  },
});

const activationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    message: "طلبات تفعيل كثيرة. حاول لاحقاً.",
    code: "ACTIVATION_RATE_LIMITED",
  },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "طلبات كثيرة.", code: "RATE_LIMITED" },
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "saas-admin-api" });
});

// Order matters: the specific limiters must be mounted before the blanket one.
app.use("/api/auth/login", loginLimiter);
app.use("/api/activate", activationLimiter);
app.use("/api", apiLimiter);

app.use("/api", routes);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[saas-admin-api] unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`[saas-admin-api] running on port ${port}`);
  // Nothing in this service ever ran on its own before: every check happened
  // only when an admin clicked something. That is how a shop sat outside the
  // control plane unnoticed for months.
  startFleetWatch();
});
