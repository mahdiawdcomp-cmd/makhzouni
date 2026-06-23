import prisma from "../config/database";
import { getSettings } from "./settings.service";

export interface BackupData {
  version: string;
  exportedAt: string;
  storeName: string;
  counts: Record<string, number>;
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

/** Exports every table (excluding password hashes, last 2000 audit logs). */
export async function generateFullBackup(): Promise<BackupData> {
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
  ] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true, name: true, username: true, role: true,
        permissions: true, isActive: true, createdAt: true,
        // passwordHash intentionally excluded
      },
    }),
    prisma.product.findMany({ where: { deletedAt: null } }),
    prisma.customer.findMany({ where: { deletedAt: null } }),
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
    prisma.stockMovement.findMany({ orderBy: { createdAt: "desc" }, take: 5000 }),
    prisma.inventoryTransfer.findMany({
      include: { items: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 2000 }),
  ]);

  return {
    version: "2.0",
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
    auditLogs,
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
