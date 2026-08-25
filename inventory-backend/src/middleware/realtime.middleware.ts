import { NextFunction, Request, Response } from "express";
import { publishRealtimeChange, RealtimeResource } from "../services/realtime.service";

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function resourceForPath(path: string): RealtimeResource | null {
  const clean = path.split("?")[0];

  // Shopper traffic is not a staff mutation. /api/public carries POSTs that
  // fire constantly while someone browses — thumbnails on every page of the
  // grid, visit heartbeats, OTP, price requests — and each one used to fall
  // through to "all", which the frontend treats as an unfiltered
  // queryClient.invalidateQueries(): every open admin tab refetches its whole
  // cache, the ~4.75 MB products query included. So the owner's screen froze
  // for seconds at a time whenever a customer opened the catalog, which is
  // exactly after a WhatsApp message goes out. Only the two public actions
  // that genuinely change something staff-facing are published.
  if (clean.startsWith("/api/public")) {
    // "guest-orders" carries a hyphen, not a slash — matching on "/orders"
    // silently skipped every guest order.
    if (clean.endsWith("/orders") || clean.endsWith("/guest-orders")) return "order-preparations";
    if (clean.includes("/access/request")) return "approvals";
    return null;
  }

  if (clean.startsWith("/api/products")) return "products";
  if (clean.startsWith("/api/customers")) return "customers";
  if (clean.startsWith("/api/invoices")) return "invoices";
  if (clean.startsWith("/api/vouchers")) return "vouchers";
  if (clean.startsWith("/api/transfers")) return "transfers";
  if (clean.startsWith("/api/stock-losses")) return "stock-losses";
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
  // Matches both /api/whatsapp/* (send-invoice, send, send-invoice-image...)
  // and /api/whatsapp-chat/* — neither was listed here, so every WhatsApp
  // send fell through to "all" below, which the frontend treats as
  // queryClient.invalidateQueries() with NO filter: every active query on
  // the page — including the ~4.75 MB products catalogue — refetched at
  // once. That's the multi-second freeze reported after every WhatsApp send.
  if (clean.startsWith("/api/whatsapp")) return "whatsapp-chat";

  return "all";
}

export function realtimeMutationMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!mutationMethods.has(req.method) || req.originalUrl.startsWith("/api/realtime")) {
    next();
    return;
  }

  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      const resource = resourceForPath(req.originalUrl);
      // null = nothing a staff screen is showing changed; staying quiet is the
      // point, not an oversight.
      if (!resource) return;
      publishRealtimeChange({
        resource,
        action: req.method,
        path: req.originalUrl.split("?")[0],
      });
    }
  });

  next();
}


/** Exported for tests only — the routing table is worth pinning down. */
export const __resourceForPathForTests = resourceForPath;
