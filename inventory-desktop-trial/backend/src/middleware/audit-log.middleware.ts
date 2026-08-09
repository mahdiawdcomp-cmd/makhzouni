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
    if (value instanceof Date) return value.toISOString();

    const toJSON = (value as { toJSON?: () => unknown }).toJSON;
    if (typeof toJSON === "function") {
      return redact(toJSON.call(value));
    }

    const entries: Array<[string, unknown]> = [];
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "function" || typeof item === "symbol" || item === undefined) continue;
      entries.push([key, sensitiveKeys.has(key) ? "[REDACTED]" : redact(item)]);
    }
    return Object.fromEntries(entries);
  }

  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return undefined;
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

// `before` is a raw Prisma snapshot (Decimal fields, no computed columns) and
// `after` is the serialized API response (Decimal -> number, extra computed
// fields like item.warehouseName). Those shape differences made every money
// field register as "changed" even when untouched. Numeric-string vs number
// is treated as equal; everything else still needs a real content diff.
function looseEqual(a: unknown, b: unknown): boolean {
  if (JSON.stringify(a) === JSON.stringify(b)) return true;
  const na = typeof a === "number" ? a : typeof a === "string" && a.trim() !== "" ? Number(a) : NaN;
  const nb = typeof b === "number" ? b : typeof b === "string" && b.trim() !== "" ? Number(b) : NaN;
  return !Number.isNaN(na) && !Number.isNaN(nb) && na === nb;
}

type InvoiceItemRow = Record<string, unknown>;

// Edits delete and recreate every invoice_items row, so before/after ids never
// match even for an untouched line — match by product+warehouse instead, and
// report added/removed/changed lines so the UI can show the real old vs new
// product list instead of just an item count.
function diffInvoiceItems(beforeItems: unknown, afterItems: unknown) {
  const toArray = (value: unknown) => (Array.isArray(value) ? (value as InvoiceItemRow[]) : []);
  const keyOf = (item: InvoiceItemRow) => `${item.productId ?? ""}::${item.warehouseId ?? ""}`;

  const beforeMap = new Map(toArray(beforeItems).map((item) => [keyOf(item), item]));
  const afterMap = new Map(toArray(afterItems).map((item) => [keyOf(item), item]));
  // warehouseName is excluded: it's only present on the serialized "after"
  // item (loadBeforeSnapshot's raw `items: true` never includes it), so
  // comparing it would flag every untouched line as changed. A real
  // warehouse change already surfaces as an add+remove via keyOf() above.
  const compareFields = ["quantity", "unit", "unitPrice", "totalPrice"];

  const added: InvoiceItemRow[] = [];
  const changed: Array<{ productName: unknown; before: InvoiceItemRow; after: InvoiceItemRow }> = [];

  for (const [key, afterItem] of afterMap) {
    const beforeItem = beforeMap.get(key);
    if (!beforeItem) {
      added.push(afterItem);
      continue;
    }
    if (compareFields.some((field) => !looseEqual(beforeItem[field], afterItem[field]))) {
      changed.push({ productName: afterItem.productName ?? beforeItem.productName, before: beforeItem, after: afterItem });
    }
  }
  const removed = [...beforeMap.entries()].filter(([key]) => !afterMap.has(key)).map(([, item]) => item);

  if (!added.length && !removed.length && !changed.length) return undefined;
  return { added, removed, changed };
}

type FieldChange = { before: unknown; after: unknown; itemsDiff?: ReturnType<typeof diffInvoiceItems> };

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

  const changes: Record<string, FieldChange> = {};
  for (const key of keys) {
    if (ignored.has(key)) continue;
    const oldValue = beforeRecord[key];
    const newValue = afterRecord[key];

    if (key === "items") {
      const itemsDiff = diffInvoiceItems(oldValue, newValue);
      if (itemsDiff) changes[key] = { before: undefined, after: undefined, itemsDiff };
      continue;
    }

    if (!looseEqual(oldValue, newValue)) {
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
    if (!req.user) return;

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
