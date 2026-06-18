import "dotenv/config";

if (!process.env.DATABASE_URL) {
  console.error("[FATAL] DATABASE_URL is not set.");
  process.exit(1);
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "change-this-strong-secret") {
  if (process.env.NODE_ENV === "production") {
    console.error("[FATAL] JWT_SECRET must be set to a strong random value in production.");
    process.exit(1);
  }
}

import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import routes from "./routes";

const app = express();
const port = Number(process.env.PORT ?? 4000);

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5174")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "saas-admin-api" });
});

app.use("/api", routes);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.listen(port, "0.0.0.0", () => {
  console.log(`[saas-admin-api] running on port ${port}`);
});
