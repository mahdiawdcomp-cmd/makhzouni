import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
import { getInvoiceById } from "../services/invoice.service";
import { generateInvoicePdf } from "../services/invoice-export.service";
import { renderTemplateByType } from "../services/message-template.service";
import { getSettings, updateSettings } from "../services/settings.service";
import { sendInvoiceToWorkers } from "../services/worker-notify.service";
import {
  getCloudWebhookConfig,
  generateVerifyToken,
  getWhatsAppStatus,
  restartWhatsApp,
  sendWhatsAppImage,
  sendWhatsAppPdf,
  sendWhatsAppText,
  sendWhatsAppTemplate,
  sendPdfWithTemplateFallback,
  invoiceTemplateBodyParams,
} from "../services/whatsapp.service";

// Meta template language for every template-or-fallback send below.
const CLOUD_TEMPLATE_LANG = "ar";

// Cloud API: try the Meta-approved template first (works regardless of 24h
// session state), and only fall back to the free-text send if the template
// call fails (not configured, not yet approved, wrong param count, etc.) —
// never worse than the pre-template behavior.
async function withTemplateFallback<T>(
  templateName: string | undefined,
  tryTemplate: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  const status = getWhatsAppStatus();
  if (status.activeProvider !== "cloud" || !templateName?.trim()) {
    return fallback();
  }
  try {
    return await tryTemplate();
  } catch (err) {
    logger.warn(`[WhatsApp] template "${templateName}" send failed, falling back to free text: ${err instanceof Error ? err.message : String(err)}`);
    return fallback();
  }
}

function sendInvoiceViaCloudSafe(phone: string, templateName: string | undefined, message: string, pdf: Buffer, filename: string, bodyParams: string[]) {
  return sendPdfWithTemplateFallback(phone, templateName, CLOUD_TEMPLATE_LANG, message, pdf, filename, bodyParams);
}

function sendTextViaCloudSafe(phone: string, templateName: string | undefined, message: string, bodyParams: string[]) {
  return withTemplateFallback(
    templateName,
    () => sendWhatsAppTemplate(phone, templateName as string, CLOUD_TEMPLATE_LANG, { bodyParams }),
    () => sendWhatsAppText(phone, message),
  );
}

// Shared by screens that already build their own free-text message
// client-side (voucher receipt, customer statement, debt/inactive reminders)
// — the client sends the exact fallback text plus the raw values as
// bodyParams; the server picks the matching Meta template name from Settings
// (never a client-supplied template name) and tries it first.
const TEMPLATE_KIND_SETTING = {
  voucher: "voucherTemplateName",
  statement: "statementTemplateName",
  portal: "portalLinkTemplateName",
  debtReminder: "debtReminderTemplateName",
  inactiveCustomer: "inactiveCustomerTemplateName",
} as const;
type TemplateKind = keyof typeof TEMPLATE_KIND_SETTING;

export const whatsappStatus = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: getWhatsAppStatus(),
  });
});

export const whatsappRestart = asyncHandler(async (_req, res) => {
  await restartWhatsApp();
  res.json({ success: true, message: "جاري إعادة تشغيل الواتساب..." });
});

export const sendMessage = asyncHandler(async (req, res) => {
  const { phone, message } = req.body as { phone: string; message: string };
  const result = await sendWhatsAppText(phone, message);

  res.json({
    success: true,
    message: "WhatsApp message sent successfully",
    data: result,
  });
});

// Shared template-or-fallback send for screens that already build their own
// free-text message client-side (voucher receipt, customer statement, debt/
// inactive reminders) — the client sends the exact fallback text plus the raw
// values as bodyParams; the server picks the matching Meta template name from
// Settings (never a client-supplied template name) and tries it first.
export const sendTemplatedMessage = asyncHandler(async (req, res) => {
  const phone = String(req.body?.phone ?? "");
  const message = String(req.body?.message ?? "");
  const kind = String(req.body?.templateKind ?? "") as TemplateKind;
  const bodyParams = Array.isArray(req.body?.bodyParams) ? (req.body.bodyParams as unknown[]).map(String) : [];
  if (!phone || !message) throw new AppError("رقم الهاتف والنص مطلوبان", 400, "SEND_TEMPLATED_INVALID");
  if (!(kind in TEMPLATE_KIND_SETTING)) throw new AppError("نوع القالب غير معروف", 400, "SEND_TEMPLATED_UNKNOWN_KIND");

  const settings = await getSettings();
  const templateName = settings[TEMPLATE_KIND_SETTING[kind]];
  const result = await sendTextViaCloudSafe(phone, templateName, message, bodyParams);

  res.json({
    success: true,
    message: "WhatsApp message sent successfully",
    data: result,
  });
});

export const sendInvoice = asyncHandler(async (req, res) => {
  const invoiceId = String(req.params.invoiceId);
  const [invoice, pdf, settings] = await Promise.all([
    getInvoiceById(invoiceId),
    generateInvoicePdf(invoiceId),
    getSettings(),
  ]);

  const message = await renderTemplateByType("NEW_INVOICE", {
    customerName: invoice.customer.name,
    amount: invoice.remainingAmount,
    invoiceNumber: invoice.invoiceNumber,
    daysLate: "",
    storeName: settings.storeName,
    date: new Date(invoice.date).toLocaleDateString(),
  });

  // Order matches the {{1}}..{{10}} placeholders in the Meta template body —
  // keep in sync with the template text configured in WhatsApp Manager.
  const bodyParams = invoiceTemplateBodyParams(invoice, settings.storeName);
  const result = await sendInvoiceViaCloudSafe(
    invoice.customer.phone,
    settings.invoiceTemplateName,
    message,
    pdf,
    `${invoice.invoiceNumber}.pdf`,
    bodyParams,
  );

  res.json({
    success: true,
    message: "Invoice sent by WhatsApp successfully",
    data: result,
  });
});

// Send the invoice PDF to selected preparation workers ("عمال التجهيز").
export const sendInvoiceToWorkersCtrl = asyncHandler(async (req, res) => {
  const invoiceId = String(req.params.invoiceId);
  const phones = Array.isArray((req.body as { phones?: unknown })?.phones)
    ? ((req.body as { phones: unknown[] }).phones.map((p) => String(p)))
    : [];
  if (phones.length === 0) {
    throw new AppError("اختر عاملاً واحداً على الأقل", 400, "NO_WORKERS_SELECTED");
  }
  const result = await sendInvoiceToWorkers(invoiceId, phones);
  res.json({
    success: true,
    message: `تم الإرسال إلى ${result.sent.length} عامل` + (result.failed.length ? `، وفشل ${result.failed.length}` : ""),
    data: result,
  });
});

// ── Admin test / diagnostics ───────────────────────────────────────────────
const TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TEST_PDF = Buffer.from(
  "JVBERi0xLjEKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAzMDAgMTQ0XS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgNCAwIFI+Pj4+L0NvbnRlbnRzIDUgMCBSPj4KZW5kb2JqCjQgMCBvYmoKPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvQmFzZUZvbnQvSGVsdmV0aWNhPj4KZW5kb2JqCjUgMCBvYmoKPDwvTGVuZ3RoIDQ0Pj4Kc3RyZWFtCkJUIC9GMSAxOCBUZiAyMCA2MCBUZCAoTWFraHpvdW5pIHRlc3QpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKdHJhaWxlcgo8PC9Sb290IDEgMCBSPj4KJSVFT0YK",
  "base64",
);

function testPhone(req: import("express").Request): string {
  const phone = String((req.body as { phone?: string })?.phone ?? "").trim();
  if (!phone) throw new AppError("رقم الهاتف مطلوب للاختبار", 400, "PHONE_REQUIRED");
  return phone;
}

export const testWhatsAppText = asyncHandler(async (req, res) => {
  const phone = testPhone(req);
  const message = String((req.body as { message?: string })?.message ?? "").trim()
    || "✅ رسالة اختبار من مخزوني — إعدادات واتساب تعمل بنجاح.";
  const result = await sendWhatsAppText(phone, message);
  res.json({ success: true, message: "تم إرسال رسالة الاختبار النصية", data: result });
});

export const testWhatsAppImage = asyncHandler(async (req, res) => {
  const phone = testPhone(req);
  const result = await sendWhatsAppImage(phone, "🖼️ صورة اختبار من مخزوني", TEST_PNG, "image/png");
  res.json({ success: true, message: "تم إرسال صورة الاختبار", data: result });
});

export const testWhatsAppPdf = asyncHandler(async (req, res) => {
  const phone = testPhone(req);
  const result = await sendWhatsAppPdf(phone, "📄 ملف PDF اختبار من مخزوني", TEST_PDF, "makhzouni-test.pdf");
  res.json({ success: true, message: "تم إرسال ملف PDF الاختبار", data: result });
});

function buildWebhookUrl(req: import("express").Request): string {
  const proto = (req.header("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  const host = req.header("x-forwarded-host") || req.get("host") || "";
  return `${proto}://${host}/api/public/whatsapp/meta-webhook`;
}

export const checkWhatsAppWebhook = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const { verifyToken, appSecret } = getCloudWebhookConfig();
  const webhookUrl = buildWebhookUrl(req);

  const issues: string[] = [];
  if (settings.whatsappProvider !== "cloud") issues.push("المزود الحالي ليس Meta Cloud API.");
  if (!settings.whatsappCloudPhoneNumberId?.trim()) issues.push("Phone Number ID غير مضبوط.");
  if (!settings.whatsappCloudToken?.trim()) issues.push("Access Token غير مضبوط.");
  if (!verifyToken) issues.push("Verify Token غير موجود.");

  res.json({
    success: true,
    data: {
      ready: issues.length === 0,
      webhookUrl,
      verifyTokenSet: Boolean(verifyToken),
      appSecretConfigured: Boolean(appSecret),
      appSecretWarning: appSecret ? null : "App Secret غير مضبوط — التحقق من التوقيع معطّل (اختياري).",
      issues,
    },
  });
});

export const regenerateVerifyToken = asyncHandler(async (_req, res) => {
  const token = generateVerifyToken();
  await updateSettings({ whatsappCloudVerifyToken: token });
  res.json({ success: true, message: "تم توليد Verify Token جديد", data: { verifyToken: token } });
});
