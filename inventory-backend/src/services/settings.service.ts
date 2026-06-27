import { Prisma } from "@prisma/client";
import prisma from "../config/database";
import { setCloudCredentials } from "./whatsapp.service";

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
  invoiceDesign?: string;
  voucherTemplate: string;
  statementTemplate: string;
  // UI preferences
  themePreset: "classic" | "iraqi" | "exclusive" | "bold" | "designer";
  // Backup
  backupWhatsappNumber?: string;
  // The warehouse that acts as المحل — sales deduct from here only. Falls back
  // to the oldest active warehouse when unset.
  shopWarehouseId?: string;
  // Public catalog / WhatsApp workflow
  catalogPublicUrl?: string;
  catalogAdminWhatsappNumber?: string;
  orderPreparationWhatsappNumbers?: string;
  // Dedicated number that receives staff approval requests (delete/cancel).
  // Falls back to storePhone when empty.
  adminApprovalWhatsappNumber?: string;
  // Daily summary
  autoSendDailySummary: boolean;
  dailySummaryWhatsappNumber?: string;
  dailySummaryHour: number;
  // WhatsApp Cloud API credentials (stored in DB so admin can configure from UI)
  whatsappProvider?: "web" | "cloud";
  whatsappCloudToken?: string;
  whatsappCloudPhoneNumberId?: string;
  // Telegram backup delivery
  telegramBotToken?: string;
  telegramChatId?: string;
  // Wholesale catalog design (admin-configurable)
  catalogDesignPrimaryColor?: string;
  catalogDesignBgColor?: string;
  catalogDesignDefaultTheme?: "clean" | "warm" | "dark" | "vibrant";
  catalogDesignLogoUrl?: string;
  catalogDesignWelcomeMessage?: string;
  catalogDesignBannerEnabled?: boolean;
  catalogDesignBannerImages?: Array<{ url: string; title: string; order: number }>;
  // Prospect auto-reply: when a prospect's reply contains ANY of these
  // trigger keywords, the configured message (with {{link}} substituted)
  // is sent back to them automatically.
  prospectGroupInviteLink?: string;
  prospectAutoReplyKeywords?: string[];
  prospectAutoReplyMessage?: string;
  prospectAutoReplyEnabled?: boolean;
  // WhatsApp customer-service bot: known customers asking one of these 4
  // fixed commands (matched by keyword list) get an automatic, real-data
  // reply. Everyone else (prospects, unknown numbers, or a known customer
  // asking something else) gets botUnknownMessage and lands in the
  // الرسائل الواردة inbox for a manual reply.
  whatsappBotEnabled?: boolean;
  botUnknownMessage?: string;
  botKeywordsStatement?: string[];
  botKeywordsBalance?: string[];
  botKeywordsHowToBuy?: string[];
  botKeywordsCatalog?: string[];
  botHowToBuyMessage?: string;
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
    "مرحبا {{customerName}} تم اصدار فاتورة بيع رقم {{invoiceNumber}}\nبتاريخ {{date}}\nمبلغ الفاتورة {{total}} {{currency}}\nالمبلغ الواصل {{paid}} {{currency}}\nالمتبقي من الفاتورة {{remaining}} {{currency}}\nحسابك السابق قبل الفاتورة {{previousBalance}} {{currency}}\nالحساب النهائي {{finalBalance}} {{currency}}\nشكرا لتسوق من {{storeName}}\nنتمنى لك الرزق الوفير والكثير",
  invoiceDesign: "",
  voucherTemplate:
    "مرحباً {{customerName}}،\nاستلمنا منكم {{amount}} {{currency}} بسند رقم {{voucherNumber}} بتاريخ {{date}}.\nالحساب الحالي: {{currentBalance}} {{currency}}.\nشكراً، {{storeName}}.",
  statementTemplate:
    "كشف حساب {{customerName}} حتى {{date}}\nالرصيد الافتتاحي: {{openingBalance}} {{currency}}\nالرصيد الحالي: {{currentBalance}} {{currency}}\nمن {{storeName}}.",
  themePreset: "classic",
  shopWarehouseId: "",
  catalogPublicUrl: "https://mahdi.mazbwoni.com/catalog",
  catalogAdminWhatsappNumber: "",
  orderPreparationWhatsappNumbers: "",
  adminApprovalWhatsappNumber: "",
  autoSendDailySummary: false,
  dailySummaryWhatsappNumber: "",
  dailySummaryHour: 21,
  whatsappProvider: "web",
  whatsappCloudToken: "",
  whatsappCloudPhoneNumberId: "",
  prospectGroupInviteLink: "",
  prospectAutoReplyKeywords: ["تم", "نعم", "اوكي", "ok"],
  prospectAutoReplyMessage: "تمام 👍 هذا رابط كروبنا على الواتساب:\n{{link}}",
  prospectAutoReplyEnabled: false,
  whatsappBotEnabled: false,
  botUnknownMessage: "هلا 👋 استلمنا رسالتك، الإدارة رح ترد عليك قريباً.",
  botKeywordsStatement: ["كشف حساب", "كشف حسابي", "ابعث الكشف", "ارسل الكشف", "كشف"],
  botKeywordsBalance: ["رصيدي", "كم رصيدي", "شكد رصيدي", "كم علي", "شحالي بالحساب"],
  botKeywordsHowToBuy: ["كيف اشتري", "شلون اطلب", "كيف الطلب", "شلون اشتري", "طريقة الشراء"],
  botKeywordsCatalog: ["ارسل لي الكتلوك", "ابعث الكتلوك", "الكاتلوك", "ابعثلي الكتالوج", "رابط الكتلوك"],
  botHowToBuyMessage: "تكدر تطلب بسهولة 🛍️\nشوف منتجاتنا بالكاتلوج وابعثلنا الأصناف اللي تريدها، ونرتب الباقي وياك.",
};

const OLD_INVOICE_TEMPLATE =
  "مرحباً {{customerName}}،\nفاتورتك رقم {{invoiceNumber}} بتاريخ {{date}}\nالمجموع: {{total}} {{currency}}\nالمدفوع: {{paid}} {{currency}}\nالباقي: {{remaining}} {{currency}}\nالحساب النهائي: {{finalBalance}} {{currency}}\nشكراً لتعاملكم مع {{storeName}}.";

export async function getSettings(): Promise<AppSettings> {
  const rows = await prisma.setting.findMany();
  const values = { ...defaultSettings } as Record<string, unknown>;

  for (const row of rows) {
    values[row.key] = row.value;
  }

  // One-time migration: replace old invoice template with the new format
  if (values["invoiceTemplate"] === OLD_INVOICE_TEMPLATE) {
    values["invoiceTemplate"] = defaultSettings.invoiceTemplate;
    await prisma.setting.upsert({
      where: { key: "invoiceTemplate" },
      update: { value: defaultSettings.invoiceTemplate },
      create: { key: "invoiceTemplate", value: defaultSettings.invoiceTemplate },
    });
  }

  const settings = values as unknown as AppSettings;

  // Sync WhatsApp Cloud credentials into the WA service module
  setCloudCredentials(
    settings.whatsappCloudToken ?? "",
    settings.whatsappCloudPhoneNumberId ?? "",
    settings.whatsappProvider,
  );

  return settings;
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

  // getSettings() re-syncs WhatsApp credentials automatically
  return getSettings();
}
