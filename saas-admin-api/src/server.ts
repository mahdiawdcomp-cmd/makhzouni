import "dotenv/config";

if (!process.env.DATABASE_URL) {
  console.error("[FATAL] DATABASE_URL is not set.");
  process.exit(1);
}
// Known weak/placeholder secrets that must never reach production. The two
// route files fall back to "dev-secret" for local convenience, so we must
// reject it here (and any unset secret) before any token is signed/verified.
const WEAK_JWT_SECRETS = new Set(["change-this-strong-secret", "dev-secret"]);
if (!process.env.JWT_SECRET || WEAK_JWT_SECRETS.has(process.env.JWT_SECRET)) {
  if (process.env.NODE_ENV === "production") {
    console.error("[FATAL] JWT_SECRET must be set to a strong random value in production.");
    process.exit(1);
  } else {
    console.warn("[WARN] JWT_SECRET is unset or weak — using an insecure dev fallback. Do NOT use in production.");
  }
}

import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import routes from "./routes";

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

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "saas-admin-api" });
});

app.use("/api", routes);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[saas-admin-api] unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`[saas-admin-api] running on port ${port}`);
});
