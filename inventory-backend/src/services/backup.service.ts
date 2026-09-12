import prisma from "../config/database";
import { getSettings } from "./settings.service";

/** Image-bearing field names whose long values are base64 payloads. */
const AUDIT_IMAGE_FIELDS = new Set(["imageUrl", "thumbnailUrl"]);

/**
 * Recursively replaces base64 image payloads inside an AuditLog before/after/
 * metadata snapshot with a tiny marker, ONLY for the export (DB is never
 * touched). A value is stripped if it is a `data:image/...` data-URI, or it is
 * a known image field whose string is long (>256 chars). Everything else —
 * including all non-image text — is preserved verbatim.
 */
function stripBase64Images(value: unknown, fieldName?: string): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    const isDataUri = value.startsWith("data:image/");
    const isLongImageField = fieldName !== undefined && AUDIT_IMAGE_FIELDS.has(fieldName) && value.length > 256;
    if (isDataUri || isLongImageField) {
      return { $omitted: "base64-image", len: value.length };
    }
    return value;
  }
  if (Array.isArray(value)) {
    // Propagate fieldName through arrays so e.g. `images: [<base64>, ...]` is
    // still recognized as an image field per-element (map() previously lost it).
    return value.map((v) => stripBase64Images(v, fieldName));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripBase64Images(v, k);
    }
    return out;
  }
  return value;
}

/** Strips base64 images from each audit log's before/after/metadata (export only). */
function leanAuditLogs(auditLogs: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return auditLogs.map((log) => ({
    ...log,
    before: stripBase64Images(log.before),
    after: stripBase64Images(log.after),
    metadata: stripBase64Images(log.metadata),
  }));
}

export interface BackupData {
  version: string;
  exportedAt: string;
  storeName: string;
  counts: Record<string, number>;
  /** Notes about completeness so a restore tool knows what is/ isn't full. */
  meta: {
    /** StockMovement is exported in full (no cap) so stock can be reconstructed. */
    stockMovementsComplete: boolean;
    /** Soft-deleted products/customers ARE included (referenced by old invoices). */
    includesSoftDeleted: boolean;
    /** AuditLog is capped (history only, not needed for restore). */
    auditLogsLimited: boolean;
    auditLogsLimit: number;
    auditLogsExported: number;
    auditLogsTotal: number;
    /** Named so a reader never assumes this file is the whole database. */
    excludes?: string[];
    /** Present only when an optional (non-restore-critical) section was skipped. */
    warnings?: string[];
  };
  users: unknown[];
  products: unknown[];
  customers: unknown[];
  invoices: unknown[];
  vouchers: unknown[];
  quotations: unknown[];
  branches: unknown[];
  coupons: unknown[];
  messageTemplates: unknown[];
  settings: unknown[];
  stockMovements: unknown[];
  transfers: unknown[];
  auditLogs: unknown[];
  // ── State that cannot be recomputed from the tables above ────────────────
  /** THE stock. Since the legacy product-field fallback was removed, a restore
   *  without these rows gives every product zero pieces. */
  warehouseStocks: unknown[];
  /** Document numbering. Without it, invoice/voucher numbers restart and collide. */
  counters: unknown[];
  stockLosses: unknown[];
  couponRedemptions: unknown[];
  customerTags: unknown[];
  personalDebts: unknown[];
  pendingApprovals: unknown[];
  stocktakeSessions: unknown[];
  cycleCountSessions: unknown[];
  salesAgentIssues: unknown[];
  salesAgentPriceRequests: unknown[];
  salesAgentSettlements: unknown[];
  salesAgentHandovers: unknown[];
  orderPreparations: unknown[];
}

/** AuditLog is history-only and can grow huge; cap it but record the cap in meta.
 *  Kept low: individual snapshots can embed near-full record copies (e.g. a
 *  product's before/after with its image fields), so even a few hundred rows
 *  can be tens of MB. 2000 rows was observed to decode to ~390MB and OOM-crash
 *  the backup export (JSON.parse of the DB result, before any lean stripping
 *  even runs) — see backup-status "download" outage 2026-07-08..07-12. */
const AUDIT_LOG_LIMIT = 200;

/** Recorded in every backup so the gap is documented, not discovered later. */
const EXCLUDED_FROM_BACKUP = [
  "catalog (visitors, sessions, reviews, images, funnel)",
  "messaging (WhatsApp, Telegram, campaigns, notifications)",
  "instagram",
  "media assets",
  "user password hashes",
];

/**
 * Exports the tables needed to rebuild the shop's books and stock.
 *
 * This is NOT a copy of the whole database — the schema has far more tables and
 * the catalog/marketing/messaging/AI side is deliberately out. What IS covered
 * is everything a restore needs to put back the money and the goods: products,
 * customers, invoices, vouchers, the stock ledger, per-warehouse stock, losses,
 * counters, approvals, stocktakes and the sales-rep records. `meta.excludes`
 * names what is knowingly left out so nobody mistakes this for a disk image.
 * - passwordHash excluded (security).
 * - products/customers: ALL rows including soft-deleted (old invoices reference them).
 * - stockMovements: FULL (no cap) so stock ledger can be reconstructed.
 * - auditLogs: capped to the most recent AUDIT_LOG_LIMIT (history only; not needed
 *   to restore state) — the cap and totals are reported in meta.
 */
export async function generateFullBackup(_lean = false): Promise<BackupData> {
  const settings = await getSettings();

  const [
    users,
    products,
    customers,
    invoices,
    vouchers,
    quotations,
    branches,
    coupons,
    messageTemplates,
    settingsRows,
    stockMovements,
    transfers,
  ] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true, name: true, username: true, role: true,
        permissions: true, isActive: true, createdAt: true,
        // passwordHash intentionally excluded
      },
    }),
    prisma.product.findMany(),   // include soft-deleted for restore integrity
    prisma.customer.findMany(),  // include soft-deleted for restore integrity
    prisma.invoice.findMany({
      include: { items: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.paymentVoucher.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.quotation.findMany({
      include: { items: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.branch.findMany(),
    prisma.coupon.findMany(),
    prisma.messageTemplate.findMany(),
    prisma.setting.findMany(),
    prisma.stockMovement.findMany({ orderBy: { createdAt: "desc" } }), // FULL
    prisma.inventoryTransfer.findMany({
      include: { items: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Small, restore-critical tables. Separate round-trip keeps the big
  // Promise.all above readable and its memory profile unchanged.
  const [
    warehouseStocks,
    counters,
    stockLosses,
    couponRedemptions,
    customerTags,
    personalDebts,
    pendingApprovals,
    stocktakeSessions,
    cycleCountSessions,
    salesAgentIssues,
    salesAgentPriceRequests,
    salesAgentSettlements,
    salesAgentHandovers,
    orderPreparations,
  ] = await Promise.all([
    prisma.productWarehouseStock.findMany(),
    prisma.counter.findMany(),
    prisma.stockLoss.findMany({ include: { items: true } }),
    prisma.couponRedemption.findMany(),
    prisma.customerTag.findMany(),
    prisma.personalDebt.findMany(),
    prisma.pendingApproval.findMany(),
    prisma.stocktakeSession.findMany({ include: { items: true } }),
    prisma.cycleCountSession.findMany({ include: { items: true } }),
    prisma.salesAgentIssue.findMany(),
    prisma.salesAgentPriceRequest.findMany(),
    prisma.salesAgentSettlement.findMany(),
    prisma.salesAgentHandover.findMany(),
    prisma.orderPreparation.findMany(),
  ]);

  // AuditLog is history-only (not needed to restore state) — kept OUT of the
  // Promise.all above and isolated in its own try/catch so a single corrupt
  // row (e.g. an unreadable string the Prisma engine can't convert) skips
  // just this section instead of failing the entire backup with a 500.
  let auditLogs: unknown[] = [];
  let auditLogsTotal = 0;
  let auditLogWarning: string | null = null;
  try {
    [auditLogs, auditLogsTotal] = await Promise.all([
      prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: AUDIT_LOG_LIMIT }),
      prisma.auditLog.count(),
    ]);
  } catch (error) {
    auditLogWarning = "AUDIT_LOG_SKIPPED";
    console.warn("[backup] AuditLog skipped during full backup — table read failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      code: (error as { code?: string } | undefined)?.code,
    });
  }

  return {
    // 2.2 added the restore-critical tables (per-warehouse stock, counters,
    // losses, approvals, stocktakes, sales-rep records). A 2.1 file restores the
    // books but leaves every product at zero stock — see scripts/restore-from-backup.
    version: "2.2",
    exportedAt: new Date().toISOString(),
    storeName: settings.storeName,
    counts: {
      users: users.length,
      products: products.length,
      customers: customers.length,
      invoices: invoices.length,
      vouchers: vouchers.length,
      quotations: quotations.length,
      branches: branches.length,
      coupons: coupons.length,
      stockMovements: stockMovements.length,
      transfers: transfers.length,
      auditLogs: auditLogs.length,
      warehouseStocks: warehouseStocks.length,
      counters: counters.length,
      stockLosses: stockLosses.length,
      couponRedemptions: couponRedemptions.length,
      customerTags: customerTags.length,
      personalDebts: personalDebts.length,
      pendingApprovals: pendingApprovals.length,
      stocktakeSessions: stocktakeSessions.length,
      cycleCountSessions: cycleCountSessions.length,
      salesAgentIssues: salesAgentIssues.length,
      salesAgentPriceRequests: salesAgentPriceRequests.length,
      salesAgentSettlements: salesAgentSettlements.length,
      salesAgentHandovers: salesAgentHandovers.length,
      orderPreparations: orderPreparations.length,
    },
    meta: {
      stockMovementsComplete: true,
      includesSoftDeleted: true,
      auditLogsLimited: auditLogsTotal > auditLogs.length,
      auditLogsLimit: AUDIT_LOG_LIMIT,
      auditLogsExported: auditLogs.length,
      auditLogsTotal,
      excludes: EXCLUDED_FROM_BACKUP,
      ...(auditLogWarning ? { warnings: [auditLogWarning] } : {}),
    },
    users,
    products,
    customers,
    invoices,
    vouchers,
    quotations,
    branches,
    coupons,
    messageTemplates,
    settings: settingsRows,
    stockMovements,
    transfers,
    // Always stripped (not gated behind `lean`): audit snapshots can embed
    // near-full record copies incl. image fields, and callers weren't passing
    // ?lean=1 anyway. AuditLog is history-only — never needed to restore state.
    auditLogs: leanAuditLogs(auditLogs as Array<Record<string, unknown>>),
    warehouseStocks,
    counters,
    stockLosses,
    couponRedemptions,
    customerTags,
    personalDebts,
    pendingApprovals,
    stocktakeSessions,
    cycleCountSessions,
    salesAgentIssues,
    salesAgentPriceRequests,
    salesAgentSettlements,
    salesAgentHandovers,
    orderPreparations,
  };
}

export interface ChangesData {
  version: string;
  type: "changes";
  since: string;
  generatedAt: string;
  storeName: string;
  counts: Record<string, number>;
  /** IDs soft-deleted after `since`, per table, so a restore knows to remove them. */
  deletedIds: Record<string, string[]>;
  users: unknown[];
  products: unknown[];
  customers: unknown[];
  invoices: unknown[];
  vouchers: unknown[];
  quotations: unknown[];
  branches: unknown[];
  coupons: unknown[];
  messageTemplates: unknown[];
  settings: unknown[];
  stockMovements: unknown[];
  transfers: unknown[];
  auditLogs: unknown[];
}

/**
 * Exports ONLY records changed/created/deleted after `since` — for the
 * experimental incremental backup system. Read-only; does NOT touch the
 * full-backup path. Filter strategy per table:
 *  - has updatedAt + deletedAt (Product, Customer): updatedAt > since OR deletedAt > since
 *  - has updatedAt only (User, Branch, Setting, Transfer, Quotation, StockLoss,
 *    Coupon, MessageTemplate): updatedAt > since
 *  - append-only / createdAt only (Invoice, PaymentVoucher, StockMovement,
 *    AuditLog): createdAt > since
 *  - child tables: included via parent's `include` (no independent filter).
 */
export async function generateChangesSince(since: Date, _lean = false): Promise<ChangesData> {
  const settings = await getSettings();

  const [
    users,
    products,
    customers,
    invoices,
    vouchers,
    quotations,
    branches,
    coupons,
    messageTemplates,
    settingsRows,
    stockMovements,
    transfers,
    auditLogs,
    deletedProducts,
    deletedCustomers,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { updatedAt: { gt: since } },
      select: {
        id: true, name: true, username: true, role: true,
        permissions: true, isActive: true, createdAt: true,
        // passwordHash intentionally excluded
      },
    }),
    prisma.product.findMany({
      where: { OR: [{ updatedAt: { gt: since } }, { deletedAt: { gt: since } }] },
    }),
    prisma.customer.findMany({
      where: { OR: [{ updatedAt: { gt: since } }, { deletedAt: { gt: since } }] },
    }),
    // updatedAt (not createdAt): edits, cancellations and archives of OLD
    // invoices/vouchers must reach the incremental chain — with createdAt the
    // backup silently missed every edit to a pre-existing invoice.
    prisma.invoice.findMany({
      where: { updatedAt: { gt: since } },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.paymentVoucher.findMany({
      where: { updatedAt: { gt: since } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.quotation.findMany({
      where: { updatedAt: { gt: since } },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.branch.findMany({ where: { updatedAt: { gt: since } } }),
    prisma.coupon.findMany({ where: { updatedAt: { gt: since } } }),
    prisma.messageTemplate.findMany({ where: { updatedAt: { gt: since } } }),
    prisma.setting.findMany({ where: { updatedAt: { gt: since } } }),
    prisma.stockMovement.findMany({
      where: { createdAt: { gt: since } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.inventoryTransfer.findMany({
      where: { updatedAt: { gt: since } },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.auditLog.findMany({
      where: { createdAt: { gt: since } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.product.findMany({
      where: { deletedAt: { gt: since } },
      select: { id: true },
    }),
    prisma.customer.findMany({
      where: { deletedAt: { gt: since } },
      select: { id: true },
    }),
  ]);

  return {
    version: "2.1",
    type: "changes",
    since: since.toISOString(),
    generatedAt: new Date().toISOString(),
    storeName: settings.storeName,
    counts: {
      users: users.length,
      products: products.length,
      customers: customers.length,
      invoices: invoices.length,
      vouchers: vouchers.length,
      quotations: quotations.length,
      branches: branches.length,
      coupons: coupons.length,
      stockMovements: stockMovements.length,
      transfers: transfers.length,
      auditLogs: auditLogs.length,
    },
    deletedIds: {
      products: deletedProducts.map((p) => p.id),
      customers: deletedCustomers.map((c) => c.id),
    },
    users,
    products,
    customers,
    invoices,
    vouchers,
    quotations,
    branches,
    coupons,
    messageTemplates,
    settings: settingsRows,
    stockMovements,
    transfers,
    // Always stripped — see comment in generateFullBackup.
    auditLogs: leanAuditLogs(auditLogs as Array<Record<string, unknown>>),
  };
}

/** Sends a backup JSON file to a Telegram chat via Bot API. */
export async function sendBackupToTelegram(
  botToken: string,
  chatId: string,
  backupJson: string,
  filename: string,
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendDocument`;

  const blob = new Blob([backupJson], { type: "application/json" });
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("document", blob, filename);
  formData.append(
    "caption",
    `📦 نسخة احتياطية — ${filename}\n⏰ ${new Date().toLocaleString("ar-IQ")}`,
  );

  const res = await fetch(url, { method: "POST", body: formData });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error ${res.status}: ${body}`);
  }
}
