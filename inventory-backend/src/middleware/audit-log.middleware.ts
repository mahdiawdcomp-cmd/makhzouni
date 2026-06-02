import { NextFunction, Request, Response } from "express";
import { createAuditLog } from "../services/audit-log.service";

const auditedMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const sensitiveKeys = new Set([
  "password",
  "passwordHash",
  "currentPassword",
  "newPassword",
  "token",
  "authorization",
]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sensitiveKeys.has(key) ? "[REDACTED]" : redact(item),
      ])
    );
  }

  return value;
}

function auditTarget(req: Request) {
  // Use originalUrl: it isn't mutated by Express when sub-routers match,
  // so the segments we read on "finish" still reflect the request line.
  // Strip query string before splitting.
  const pathOnly = (req.originalUrl || req.url).split("?")[0];
  const segments = pathOnly.split("/").filter(Boolean);
  // "/api/invoices/<id>" → segments = ["api","invoices","<id>"]
  const entity = segments[1] ?? segments[0] ?? "unknown";
  const recordId = segments[2];

  return { entity, recordId };
}

function actionFor(req: Request) {
  if (req.method === "POST") return "CREATE";
  if (req.method === "PUT" || req.method === "PATCH") return "UPDATE";
  if (req.method === "DELETE") return "DELETE";
  return req.method;
}

export function auditLogMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api") || !auditedMethods.has(req.method)) {
    next();
    return;
  }

  const originalJson = res.json.bind(res);
  let responseBody: unknown;

  res.json = (body: unknown) => {
    responseBody = body;
    return originalJson(body);
  };

  res.on("finish", () => {
    if (!req.user || res.statusCode >= 400) return;

    const { entity, recordId } = auditTarget(req);
    const after =
      responseBody && typeof responseBody === "object" && "data" in responseBody
        ? (responseBody as { data?: unknown }).data
        : responseBody;

    void createAuditLog({
      userId: req.user.id,
      action: actionFor(req),
      entity,
      recordId,
      after: redact(after),
      metadata: {
        method: req.method,
        path: req.originalUrl,
        requestBody: redact(req.body),
        statusCode: res.statusCode,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    }).catch((error) => {
      console.error("Failed to write audit log", error);
    });
  });

  next();
}
