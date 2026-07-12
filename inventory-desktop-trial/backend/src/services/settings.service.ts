import { Prisma } from "@prisma/client";
import prisma from "../config/database";
import { syncWhatsAppSettings, generateVerifyToken } from "./whatsapp.service";

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
  // Meta-approved Cloud API template names (WhatsApp Manager → your business
  // account). Empty = not submitted/approved yet, sends fall back to the free
  // text templates above (silently rejected by Meta once the customer's 24h
  // reply window has closed). Cloud API only; ignored for other providers.
  invoiceTemplateName?: string;
  voucherTemplateName?: string;
  statementTemplateName?: string;
  portalLinkTemplateName?: string;
  statementPdfTemplateName?: string;
  // Cold-send template names — every one of these is a business-initiated
  // WhatsApp send the customer did not just message about, so it is almost
  // always outside Meta's 24h free-text window.
  otpTemplateName?: string;
  catalogAccessRequestedTemplateName?: string;
  catalogAccessApprovedTemplateName?: string;
  orderSubmittedTemplateName?: string;
  productArrivalTemplateName?: string;
  // Debt/inactive reminders are never auto-sent (see runDebtReminderJob /
  // runInactiveCustomerJob) — these only fire on a manual "send from shop
  // number" action, via POST /whatsapp/send-templated.
  debtReminderTemplateName?: string;
  inactiveCustomerTemplateName?: string;
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
  // WhatsApp provider + credentials (DB-configurable; env vars are the fallback).
  whatsappProvider?: "manual" | "greenapi" | "cloud" | "web" | "disabled";
  whatsappCloudToken?: string;
  whatsappCloudPhoneNumberId?: string;
  whatsappCloudBusinessAccountId?: string;
  whatsappCloudVerifyToken?: string;
  whatsappCloudAppSecret?: string;
  greenApiInstanceId?: string;
  greenApiToken?: string;
  greenApiBaseUrl?: string;
  // Preparation workers ("عمال التجهيز") — structured list for selective invoice
  // PDF sending. Stored as JSON in settings (no migration needed).
  preparationWorkers?: Array<{ id: string; name: string; phone: string; active: boolean; notes?: string }>;
  // Telegram backup delivery
  telegramBotToken?: string;
  telegramChatId?: string;
  // Barcode label settings
  labelPieceWidthMm?: number;
  labelPieceHeightMm?: number;
  labelCartonWidthMm?: number;
  labelCartonHeightMm?: number;
  pieceLabelLayout?: "side-by-side" | "stacked" | "qr-only";
  pieceLabelQrPosition?: "left" | "right";
  pieceLabelShowName?: boolean;
  pieceLabelShowItemNumber?: boolean;
  pieceLabelShowCartonCount?: boolean;
  pieceLabelNameFontSize?: number;
  pieceLabelMetaFontSize?: number;
  pieceLabelPaddingMm?: number;
  cartonLabelLayout?: "side-by-side" | "stacked" | "qr-only";
  cartonLabelQrPosition?: "left" | "right";
  cartonLabelShowName?: boolean;
  cartonLabelShowItemNumber?: boolean;
  cartonLabelShowPcsPerCarton?: boolean;
  cartonLabelNameFontSize?: number;
  cartonLabelMetaFontSize?: number;
  cartonLabelPaddingMm?: number;
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
  invoiceTemplateName: "",
  voucherTemplateName: "",
  statementTemplateName: "",
  portalLinkTemplateName: "",
  statementPdfTemplateName: "",
  otpTemplateName: "",
  catalogAccessRequestedTemplateName: "",
  catalogAccessApprovedTemplateName: "",
  orderSubmittedTemplateName: "",
  productArrivalTemplateName: "",
  debtReminderTemplateName: "",
  inactiveCustomerTemplateName: "",
  themePreset: "classic",
  shopWarehouseId: "",
  catalogPublicUrl: "https://inventory-web-six-kohl.vercel.app/catalog",
  catalogAdminWhatsappNumber: "",
  orderPreparationWhatsappNumbers: "",
  adminApprovalWhatsappNumber: "",
  autoSendDailySummary: false,
  dailySummaryWhatsappNumber: "",
  dailySummaryHour: 21,
  whatsappProvider: "web",
  whatsappCloudToken: "",
  whatsappCloudPhoneNumberId: "",
  whatsappCloudBusinessAccountId: "",
  whatsappCloudVerifyToken: "",
  whatsappCloudAppSecret: "",
  greenApiInstanceId: "",
  greenApiToken: "",
  greenApiBaseUrl: "",
  preparationWorkers: [],
  labelPieceWidthMm: 50,
  labelPieceHeightMm: 25,
  labelCartonWidthMm: 100,
  labelCartonHeightMm: 100,
  pieceLabelLayout: "side-by-side",
  pieceLabelQrPosition: "left",
  pieceLabelShowName: true,
  pieceLabelShowItemNumber: true,
  pieceLabelShowCartonCount: true,
  pieceLabelNameFontSize: 14,
  pieceLabelMetaFontSize: 10,
  pieceLabelPaddingMm: 2,
  cartonLabelLayout: "stacked",
  cartonLabelQrPosition: "left",
  cartonLabelShowName: true,
  cartonLabelShowItemNumber: true,
  cartonLabelShowPcsPerCarton: true,
  cartonLabelNameFontSize: 20,
  cartonLabelMetaFontSize: 14,
  cartonLabelPaddingMm: 5,
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

  // Sync all WhatsApp provider + credentials into the WA service module
  syncWhatsAppSettings(settings);

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

  const saved = await getSettings();

  if (saved.whatsappProvider === "cloud" && !saved.whatsappCloudVerifyToken?.trim()) {
    const token = generateVerifyToken();
    await prisma.setting.upsert({
      where: { key: "whatsappCloudVerifyToken" },
      create: { key: "whatsappCloudVerifyToken", value: token },
      update: { value: token },
    });
    return getSettings();
  }

  return saved;
}
