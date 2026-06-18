import { NextFunction, Request, Response } from "express";
import { publishRealtimeChange, RealtimeResource } from "../services/realtime.service";

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function resourceForPath(path: string): RealtimeResource {
  const clean = path.split("?")[0];

  if (clean.startsWith("/api/products")) return "products";
  if (clean.startsWith("/api/customers")) return "customers";
  if (clean.startsWith("/api/invoices")) return "invoices";
  if (clean.startsWith("/api/vouchers")) return "vouchers";
  if (clean.startsWith("/api/transfers")) return "transfers";
  if (clean.startsWith("/api/branches")) return "branches";
  if (clean.startsWith("/api/quotations")) return "quotations";
  if (clean.startsWith("/api/coupons")) return "coupons";
  if (clean.startsWith("/api/users")) return "users";
  if (clean.startsWith("/api/approvals")) return "approvals";
  if (clean.startsWith("/api/audit-logs")) return "audit-logs";
  if (clean.startsWith("/api/settings")) return "settings";
  if (clean.startsWith("/api/notifications")) return "notifications";
  if (clean.startsWith("/api/catalog-management")) return "catalog";
  if (clean.startsWith("/api/catalog-categories")) return "catalog";
  if (clean.startsWith("/api/retail-catalog")) return "catalog";
  if (clean.startsWith("/api/order-preparations")) return "order-preparations";
  if (clean.startsWith("/api/stocktake")) return "stocktake";
  if (clean.startsWith("/api/reports")) return "reports";

  return "all";
}

export function realtimeMutationMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!mutationMethods.has(req.method) || req.originalUrl.startsWith("/api/realtime")) {
    next();
    return;
  }

  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      publishRealtimeChange({
        resource: resourceForPath(req.originalUrl),
        action: req.method,
        path: req.originalUrl.split("?")[0],
      });
    }
  });

  next();
}

