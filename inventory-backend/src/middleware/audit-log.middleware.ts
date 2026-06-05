import { NextFunction, Request, Response } from "express";
import prisma from "../config/database";
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
  if (req.method === "POST" && req.originalUrl.includes("/reactivate")) return "REACTIVATE";
  if (req.method === "POST") return "CREATE";
  if (req.method === "PUT" || req.method === "PATCH") return "UPDATE";
  if (req.method === "DELETE") return "DELETE";
  return req.method;
}

async function loadBeforeSnapshot(req: Request) {
  const { entity, recordId } = auditTarget(req);
  if (!recordId || req.method === "POST") return undefined;

  if (entity === "invoices") {
    return prisma.invoice.findUnique({
      where: { id: recordId },
      include: {
        customer: true,
        items: true,
        creator: { select: { id: true, name: true, username: true, role: true } },
      },
    });
  }

  if (entity === "vouchers") {
    return prisma.paymentVoucher.findUnique({
      where: { id: recordId },
      include: {
        customer: true,
        creator: { select: { id: true, name: true, username: true, role: true } },
      },
    });
  }

  return undefined;
}

function summarizeChanges(before: unknown, after: unknown, requestBody: unknown) {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") {
    return undefined;
  }

  const requestedKeys =
    requestBody && typeof requestBody === "object"
      ? new Set(Object.keys(requestBody as Record<string, unknown>))
      : undefined;
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const ignored = new Set(["updatedAt", "stockMovements"]);
  const keys = requestedKeys?.size
    ? [...requestedKeys]
    : [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])];

  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of keys) {
    if (ignored.has(key)) continue;
    const oldValue = beforeRecord[key];
    const newValue = afterRecord[key];
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes[key] = { before: oldValue, after: newValue };
    }
  }

  return Object.keys(changes).length ? changes : undefined;
}

export function auditLogMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api") || !auditedMethods.has(req.method)) {
    next();
    return;
  }

  const originalJson = res.json.bind(res);
  let responseBody: unknown;
  const beforePromise = loadBeforeSnapshot(req).catch((error) => {
    console.warn("Failed to load audit before snapshot", error);
    return undefined;
  });

  res.json = (body: unknown) => {
    responseBody = body;
    return originalJson(body);
  };

  res.on("finish", async () => {
    if (!req.user || res.statusCode >= 400) return;

    const { entity, recordId } = auditTarget(req);
    const before = await beforePromise;
    const after =
      responseBody && typeof responseBody === "object" && "data" in responseBody
        ? (responseBody as { data?: unknown }).data
        : responseBody;
    const responseRecordId =
      after && typeof after === "object" && "id" in after
        ? String((after as { id?: unknown }).id ?? "")
        : "";
    const finalRecordId = recordId ?? (responseRecordId || undefined);
    const safeBefore = redact(before);
    const safeAfter = redact(after);
    const safeBody = redact(req.body);

    void createAuditLog({
      userId: req.user.id,
      action: actionFor(req),
      entity,
      recordId: finalRecordId,
      before: safeBefore,
      after: safeAfter,
      metadata: {
        method: req.method,
        path: req.originalUrl,
        requestBody: safeBody,
        changes: summarizeChanges(safeBefore, safeAfter, safeBody),
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
