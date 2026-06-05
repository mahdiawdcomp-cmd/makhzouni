import cron from "node-cron";
import fs from "node:fs";
import path from "node:path";
import prisma from "../config/database";
import { getSettings } from "./settings.service";
import { renderTemplateByType } from "./message-template.service";
import { sendWhatsAppText } from "./whatsapp.service";
import { getDailySummaryData } from "./report.service";

let jobsStarted = false;

function daysBetween(date: Date, now = new Date()) {
  return Math.floor((now.getTime() - date.getTime()) / 86400000);
}

function cutoffDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

export async function runDebtReminderJob() {
  const settings = await getSettings();
  const cutoff = cutoffDate(settings.debtReminderDays);
  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      currentBalance: { gt: 0 },
      OR: [{ lastTransactionAt: null }, { lastTransactionAt: { lte: cutoff } }],
    },
  });

  for (const customer of customers) {
    const daysLate = daysBetween(customer.lastTransactionAt ?? customer.createdAt);
    const message = await renderTemplateByType("DEBT_REMINDER", {
      customerName: customer.name,
      amount: Number(customer.currentBalance),
      daysLate,
      storeName: settings.storeName,
      date: new Date().toLocaleDateString(),
    });

    let sentAt: Date | null = null;

    if (settings.autoSendDebtReminder) {
      await sendWhatsAppText(customer.phone, message);
      sentAt = new Date();
    }

    await prisma.notification.create({
      data: {
        customerId: customer.id,
        type: "DEBT_REMINDER",
        message,
        sentAt,
      },
    });
  }

  return {
    checked: customers.length,
  };
}

export async function runInactiveCustomerJob() {
  const settings = await getSettings();
  const cutoff = cutoffDate(settings.inactiveCustomerDays);
  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      OR: [{ lastTransactionAt: null }, { lastTransactionAt: { lte: cutoff } }],
    },
  });

  for (const customer of customers) {
    const inactiveDays = daysBetween(customer.lastTransactionAt ?? customer.createdAt);
    const message = await renderTemplateByType("INACTIVE_CUSTOMER", {
      customerName: customer.name,
      amount: Number(customer.currentBalance),
      invoiceNumber: "",
      daysLate: inactiveDays,
      storeName: settings.storeName,
      date: new Date().toLocaleDateString(),
    });

    let sentAt: Date | null = null;

    if (settings.autoSendInactiveMessage) {
      await sendWhatsAppText(customer.phone, message);
      sentAt = new Date();
    }

    await prisma.notification.create({
      data: {
        customerId: customer.id,
        type: "INACTIVE_CUSTOMER",
        message,
        sentAt,
      },
    });
  }

  return {
    checked: customers.length,
  };
}

/** ----------------------------------------------------------------
 *  Weekly backup job
 *  - Runs every Sunday at 02:00 AM
 *  - Dumps products, customers, invoices, vouchers to JSON
 *  - Saves to BACKUP_DIR (env var, defaults to ./backups/)
 *  - If ENABLE_WHATSAPP=true AND backupWhatsappNumber is set in settings,
 *    sends a summary message to that number.
 * ----------------------------------------------------------------*/
export async function runWeeklyBackup() {
  const settings = await getSettings();
  const now = new Date();
  const tag = now.toISOString().slice(0, 10);

  const [products, customers, invoices, vouchers] = await Promise.all([
    prisma.product.findMany({ where: { deletedAt: null } }),
    prisma.customer.findMany({ where: { deletedAt: null } }),
    prisma.invoice.findMany({
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    prisma.paymentVoucher.findMany({ orderBy: { createdAt: "desc" }, take: 5000 }),
  ]);

  const backup = {
    exportedAt: now.toISOString(),
    storeName: settings.storeName,
    counts: {
      products: products.length,
      customers: customers.length,
      invoices: invoices.length,
      vouchers: vouchers.length,
    },
    products,
    customers,
    invoices,
    vouchers,
  };

  // ── Save to folder ──────────────────────────────────────────
  const backupDir = process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : path.join(process.cwd(), "backups");

  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const filename = path.join(backupDir, `backup-${tag}.json`);
    fs.writeFileSync(filename, JSON.stringify(backup, null, 2), "utf-8");
    console.log(`[backup] Saved: ${filename}`);

    // Keep only the last 8 weekly backups to avoid disk bloat
    const files = fs.readdirSync(backupDir)
      .filter((f) => f.startsWith("backup-") && f.endsWith(".json"))
      .sort();
    while (files.length > 8) {
      const old = files.shift()!;
      fs.unlinkSync(path.join(backupDir, old));
    }
  } catch (err) {
    console.error("[backup] Failed to write file:", err);
  }

  // ── WhatsApp summary (optional) ─────────────────────────────
  if (process.env.ENABLE_WHATSAPP === "true") {
    const ownerPhone = settings.backupWhatsappNumber;
    if (ownerPhone) {
      const msg =
        `📦 *نسخة احتياطية أسبوعية — ${settings.storeName}*\n` +
        `📅 التاريخ: ${tag}\n` +
        `🗂 منتجات: ${products.length}\n` +
        `👤 زبائن: ${customers.length}\n` +
        `🧾 فواتير: ${invoices.length}\n` +
        `💰 سندات: ${vouchers.length}\n` +
        `✅ تم حفظ النسخة على السيرفر`;
      await sendWhatsAppText(ownerPhone, msg).catch((e) =>
        console.warn("[backup] WhatsApp send failed:", e)
      );
    }
  }

  return backup.counts;
}

export async function runDailySummaryJob(force = false) {
  const settings = await getSettings();
  const data = await getDailySummaryData();
  const currency = settings.currency || "IQD";

  function fmt(n: number) {
    return n.toLocaleString("ar-IQ");
  }

  const changeStr =
    data.salesChangePercent !== null
      ? ` (${data.salesChangePercent >= 0 ? "+" : ""}${data.salesChangePercent}% عن أمس)`
      : "";

  const lines: string[] = [
    `📊 *ملخص اليوم — ${data.date}*\n`,
    `✅ المبيعات: ${fmt(data.todaySales)} ${currency}${changeStr}`,
  ];

  if (data.topProduct) {
    lines.push(`📦 أكثر منتج باع: ${data.topProduct.name} (${data.topProduct.quantity} وحدة)`);
  }

  if (data.lowStockCount > 0) {
    const extra = data.lowStockNames.length > 0 ? `: ${data.lowStockNames.join("، ")}` : "";
    lines.push(`⚠️ ${data.lowStockCount} منتج على وشك النفاد${extra}`);
  }

  lines.push(`💰 تحصيلات اليوم: ${fmt(data.collectionsToday)} ${currency}`);

  if (data.mostOverdueCustomer) {
    lines.push(
      `🔴 ديون متأخرة: ${data.mostOverdueCustomer.name} (${data.mostOverdueCustomer.daysLate} يوم)`
    );
  }

  if (data.smartTip) {
    lines.push(`💡 ${data.smartTip}`);
  }

  const message = lines.join("\n");

  let sentAt: Date | null = null;
  if (
    process.env.ENABLE_WHATSAPP === "true" &&
    (force || settings.autoSendDailySummary) &&
    settings.dailySummaryWhatsappNumber
  ) {
    await sendWhatsAppText(settings.dailySummaryWhatsappNumber, message).catch((e) =>
      console.warn("[daily-summary] WhatsApp send failed:", e)
    );
    sentAt = new Date();
  }

  await prisma.notification.create({
    data: { type: "DAILY_SUMMARY", message, sentAt },
  });

  return { message };
}

export function startNotificationJobs() {
  if (jobsStarted) return;
  jobsStarted = true;

  cron.schedule("0 10 * * *", () => {
    runDebtReminderJob().catch((error) => {
      console.error("Debt reminder job failed", error);
    });
  });

  cron.schedule("0 9 * * *", () => {
    runInactiveCustomerJob().catch((error) => {
      console.error("Inactive customer job failed", error);
    });
  });

  // Weekly backup — every Sunday at 02:00
  cron.schedule("0 2 * * 0", () => {
    runWeeklyBackup().catch((error) => {
      console.error("Weekly backup failed:", error);
    });
  });

  // Daily summary — runs every hour, fires only when current hour matches setting (default 21:00)
  cron.schedule("0 * * * *", async () => {
    const settings = await getSettings().catch(() => null);
    const targetHour = settings?.dailySummaryHour ?? 21;
    if (new Date().getHours() === targetHour) {
      runDailySummaryJob().catch((error) => {
        console.error("Daily summary job failed", error);
      });
    }
  });

  // Keep Neon DB alive — ping every 4 minutes to prevent auto-suspend
  cron.schedule("*/4 * * * *", () => {
    prisma.$queryRaw`SELECT 1`.catch(() => {/* silent */});
  });
}
