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

  // Read-only POSTs (a body carries the id list / the draft). Publishing them
  // is not just noise: /api/sales-agent/products/thumbnails fell through to
  // "all", every tab refetched everything, the rep's page refetched its
  // products and asked for thumbnails again — a self-sustaining loop several
  // times a second that burned the per-IP rate limit and locked the whole
  // shop out with 429s (2026-09-15 → 09-17).
  if (/\/(thumbnails|lookup|preview)$/.test(clean)) return null;

  if (clean.startsWith("/api/sales-agent/")) {
    const sub = clean.slice("/api/sales-agent".length);
    if (sub.startsWith("/customers")) return "customers";
    // A rep asking to change or cancel a receipt only QUEUES an approval; the
    // receipt itself is untouched until the owner decides. Checked before the
    // plain «/receipts» rule below, which would call it a voucher change.
    if (/^\/receipts\/[^/]+\/(edit|cancel)-request$/.test(sub)) return "approvals";
    if (sub.startsWith("/receipts")) return "vouchers";
    // A rep's own invoice edit or cancel. Applied directly it moves stock and a
    // balance; queued it lands in approvals — the frontend maps «invoices» to
    // both, so either outcome refreshes the screens that show it.
    if (sub.startsWith("/invoices")) return "invoices";
    if (sub.startsWith("/visits")) return null;
    // orders, issues, price requests all land as approvals.
    return "approvals";
  }

  // The owner's rep screen. It had no rule at all, so every handover, settlement
  // and visit-plan edit fell to "all" at the bottom — an unfiltered refetch of
  // every query on every open tab, the same pattern that locked the shop out
  // with 429s before.
  if (clean.startsWith("/api/sales-agent-admin/")) {
    const sub = clean.slice("/api/sales-agent-admin".length);
    if (sub.startsWith("/handovers") || sub.startsWith("/settlements")) return "vouchers";
    if (sub.startsWith("/visit-plan") || sub.startsWith("/customers")) return "customers";
    if (sub.startsWith("/activity")) return "notifications";
    if (sub.startsWith("/edit-modes")) return "users";
    return null;
  }

  // Auction pages poll on their own; a bid or a new auction must never fan out
  // to every open tab (the /public branch above already covers bids).
  if (clean.startsWith("/api/auctions")) return null;
  if (clean.startsWith("/api/products")) return "products";
  if (clean.startsWith("/api/customers")) return "customers";
  // Areas are neighbourhoods customers are filed under, and renaming one
  // rewrites every customer row that carries it — so an area edit IS a
  // customer change as far as any open screen is concerned. Listing it here
  // also keeps it off the "all" fallback, which refetches every query on
  // every tab.
  if (clean.startsWith("/api/areas")) return "customers";
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
