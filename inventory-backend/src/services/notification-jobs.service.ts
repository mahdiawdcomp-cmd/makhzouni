import cron from "node-cron";
import prisma from "../config/database";
import { getSettings } from "./settings.service";
import { renderTemplateByType } from "./message-template.service";
import { sendWhatsAppText } from "./whatsapp.service";

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
}
