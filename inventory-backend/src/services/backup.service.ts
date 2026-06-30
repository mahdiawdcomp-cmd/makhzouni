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
    return value.map((v) => stripBase64Images(v));
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
}

/** AuditLog is history-only and can grow huge; cap it but record the cap in meta. */
const AUDIT_LOG_LIMIT = 2000;

/**
 * Exports every table for a complete, restorable backup.
 * - passwordHash excluded (security).
 * - products/customers: ALL rows including soft-deleted (old invoices reference them).
 * - stockMovements: FULL (no cap) so stock ledger can be reconstructed.
 * - auditLogs: capped to the most recent AUDIT_LOG_LIMIT (history only; not needed
 *   to restore state) — the cap and totals are reported in meta.
 */
export async function generateFullBackup(lean = false): Promise<BackupData> {
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
    auditLogsTotal,
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
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: AUDIT_LOG_LIMIT }),
    prisma.auditLog.count(),
  ]);

  return {
    version: "2.1",
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
    },
    meta: {
      stockMovementsComplete: true,
      includesSoftDeleted: true,
      auditLogsLimited: auditLogsTotal > auditLogs.length,
      auditLogsLimit: AUDIT_LOG_LIMIT,
      auditLogsExported: auditLogs.length,
      auditLogsTotal,
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
    auditLogs: lean ? leanAuditLogs(auditLogs as Array<Record<string, unknown>>) : auditLogs,
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
export async function generateChangesSince(since: Date, lean = false): Promise<ChangesData> {
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
    prisma.invoice.findMany({
      where: { createdAt: { gt: since } },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.paymentVoucher.findMany({
      where: { createdAt: { gt: since } },
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
    auditLogs: lean ? leanAuditLogs(auditLogs as Array<Record<string, unknown>>) : auditLogs,
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
