import { Prisma } from "@prisma/client";
import prisma from "../config/database";

export interface AppSettings {
  debtReminderDays: number;
  inactiveCustomerDays: number;
  autoSendDebtReminder: boolean;
  autoSendInactiveMessage: boolean;
  storeName: string;
  storeLogo: string;
  storePhone: string;
  storeAddress: string;
  currency: string;
  // WhatsApp message templates. {{placeholder}} syntax.
  invoiceTemplate: string;
  voucherTemplate: string;
  statementTemplate: string;
  // UI preferences
  themePreset: "classic" | "iraqi" | "exclusive" | "bold" | "designer";
  // Backup
  backupWhatsappNumber?: string;
  // Daily summary
  autoSendDailySummary: boolean;
  dailySummaryWhatsappNumber?: string;
  dailySummaryHour: number;
}

export const defaultSettings: AppSettings = {
  debtReminderDays: 14,
  inactiveCustomerDays: 30,
  autoSendDebtReminder: false,
  autoSendInactiveMessage: false,
  storeName: "Inventory Store",
  storeLogo: "",
  storePhone: "",
  storeAddress: "",
  currency: "IQD",
  invoiceTemplate:
    "مرحباً {{customerName}}،\nفاتورتك رقم {{invoiceNumber}} بتاريخ {{date}}\nالمجموع: {{total}} {{currency}}\nالمدفوع: {{paid}} {{currency}}\nالباقي: {{remaining}} {{currency}}\nالحساب النهائي: {{finalBalance}} {{currency}}\nشكراً لتعاملكم مع {{storeName}}.",
  voucherTemplate:
    "مرحباً {{customerName}}،\nاستلمنا منكم {{amount}} {{currency}} بسند رقم {{voucherNumber}} بتاريخ {{date}}.\nالحساب الحالي: {{currentBalance}} {{currency}}.\nشكراً، {{storeName}}.",
  statementTemplate:
    "كشف حساب {{customerName}} حتى {{date}}\nالرصيد الافتتاحي: {{openingBalance}} {{currency}}\nالرصيد الحالي: {{currentBalance}} {{currency}}\nمن {{storeName}}.",
  themePreset: "classic",
  autoSendDailySummary: false,
  dailySummaryWhatsappNumber: "",
  dailySummaryHour: 21,
};

export async function getSettings(): Promise<AppSettings> {
  const rows = await prisma.setting.findMany();
  const values = { ...defaultSettings } as Record<string, unknown>;

  for (const row of rows) {
    values[row.key] = row.value;
  }

  return values as unknown as AppSettings;
}

export async function updateSettings(input: Partial<AppSettings>) {
  for (const [key, value] of Object.entries(input)) {
    await prisma.setting.upsert({
      where: { key },
      create: {
        key,
        value: value as Prisma.InputJsonValue,
      },
      update: {
        value: value as Prisma.InputJsonValue,
      },
    });
  }

  return getSettings();
}
