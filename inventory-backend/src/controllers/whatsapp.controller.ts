import crypto from "node:crypto";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import { getInvoiceById } from "../services/invoice.service";
import { generateInvoicePdf, generateCustomerImageInvoiceWithProducts } from "../services/invoice-export.service";
import { renderTemplateByType } from "../services/message-template.service";
import { getSettings, updateSettings } from "../services/settings.service";
import { routeIncomingMessage } from "../services/whatsapp-bot.service";
import { sendInvoiceToWorkers } from "../services/worker-notify.service";
import { logger } from "../utils/logger";
import {
  getCloudWebhookConfig,
  generateVerifyToken,
  getWhatsAppStatus,
  restartWhatsApp,
  sendWhatsAppImage,
  sendWhatsAppPdf,
  sendWhatsAppText,
} from "../services/whatsapp.service";

// ── Meta WhatsApp Cloud API webhook ────────────────────────────────────────
// Meta uses ONE URL for both the GET verification handshake and POST delivery.
// Configure it as the webhook in the Meta App dashboard. Runs in parallel with
// the Green API webhook above — each provider keeps its own URL.

/** GET — Meta subscription handshake: echo hub.challenge when the token matches. */
export const whatsappMetaWebhookVerify = asyncHandler(async (req, res) => {
  const mode = String(req.query["hub.mode"] ?? "");
  const token = String(req.query["hub.verify_token"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");
  const { verifyToken } = getCloudWebhookConfig();

  if (mode === "subscribe" && verifyToken && token === verifyToken) {
    logger.info("[WhatsAppMeta] webhook verified ✓");
    res.status(200).type("text/plain").send(challenge);
    return;
  }
  logger.warn("[WhatsAppMeta] webhook verification failed (token mismatch or unset)");
  res.sendStatus(403);
});

/** Optional integrity check when an App Secret is configured. */
function metaSignatureValid(req: import("express").Request): boolean {
  const { appSecret } = getCloudWebhookConfig();
  if (!appSecret) return true; // not configured — accept (UI warns to add it)
  const signature = String(req.header("x-hub-signature-256") ?? "");
  const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!signature || !raw) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(raw).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** POST — inbound Meta messages → the shared bot/inbox pipeline. Always 200. */
export const whatsappMetaWebhookReceive = asyncHandler(async (req, res) => {
  try {
    if (!metaSignatureValid(req)) {
      logger.warn("[WhatsAppMeta] rejected payload: bad X-Hub-Signature-256");
      res.sendStatus(200); // ack anyway so Meta doesn't disable the webhook
      return;
    }

    const body = req.body as {
      object?: string;
      entry?: Array<{
        changes?: Array<{
          value?: {
            messages?: Array<{ from?: string; type?: string; text?: { body?: string } }>;
          };
        }>;
      }>;
    };

    logger.info(`[WhatsAppMeta] webhook received: object=${body.object ?? "unknown"}`);

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const msg of change.value?.messages ?? []) {
          const phone = (msg.from ?? "").replace(/\D/g, "");
          const text = msg.type === "text" ? msg.text?.body ?? "" : "";
          if (phone && text) {
            await routeIncomingMessage(phone, text);
          }
        }
      }
    }
  } catch {
    // swallow — webhook must always ack 200
  }
  res.json({ success: true });
});

// ── Incoming WhatsApp webhook (Green API) ──────────────────────────────────
// Configure this URL as the instance's "Incoming webhook" in the Green API
// console. Single entry point for every inbound message — routes by sender
// (known customer command bot, prospect group-link auto-reply, or the
// generic "wait for admin" message + الرسائل الواردة inbox). See
// whatsapp-bot.service.ts for the routing logic.
// Always responds 200 — a missed/failed auto-reply must never make the
// provider think the webhook endpoint is broken and retry/disable it.
export const whatsappIncomingWebhook = asyncHandler(async (req, res) => {
  try {
    const body = req.body as {
      typeWebhook?: string;
      senderData?: { chatId?: string; sender?: string };
      messageData?: {
        textMessageData?: { textMessage?: string };
        extendedTextMessageData?: { text?: string };
      };
    };

    // Confirm Green API actually reaches us — logs the event type of every hit.
    logger.info(`[WhatsAppWebhook] received: ${body.typeWebhook ?? "unknown"}`);

    if (body.typeWebhook === "incomingMessageReceived") {
      const chatId = body.senderData?.chatId ?? body.senderData?.sender ?? "";
      const phone = chatId.replace(/@c\.us$|@g\.us$/i, "");
      const text =
        body.messageData?.textMessageData?.textMessage ??
        body.messageData?.extendedTextMessageData?.text ??
        "";
      if (phone && text) {
        await routeIncomingMessage(phone, text);
      }
    }
  } catch {
    // swallow — webhook must always ack 200
  }
  res.json({ success: true });
});

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

  const result = await sendWhatsAppPdf(
    invoice.customer.phone,
    message,
    pdf,
    `${invoice.invoiceNumber}.pdf`
  );

  res.json({
    success: true,
    message: "Invoice sent by WhatsApp successfully",
    data: result,
  });
});

// New, separate option: "إرسال فاتورة بالصور" — sends a customer-safe image
// invoice (product thumbnails, no purchase price/cost/profit) instead of the
// existing PDF above. Does not replace or change the sendInvoice flow.
export const sendInvoiceImage = asyncHandler(async (req, res) => {
  const invoiceId = String(req.params.invoiceId);
  const [invoice, png, settings] = await Promise.all([
    getInvoiceById(invoiceId),
    generateCustomerImageInvoiceWithProducts(invoiceId),
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

  const result = await sendWhatsAppImage(invoice.customer.phone, message, png, "image/png");

  res.json({
    success: true,
    message: "Invoice image sent by WhatsApp successfully",
    data: result,
  });
});

// Send the invoice PDF to selected preparation workers ("عمال التجهيز").
// Body: { phones: string[] }. Only active workers stored in settings are sent to;
// a WhatsApp failure never fails the request (per-worker results returned).
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
// Small self-contained samples so an admin can verify their provider works
// without needing a real invoice or a live Meta account.

// 1×1 transparent PNG.
const TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
// Minimal valid one-page PDF containing "Makhzouni test".
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

/** Builds the public Meta webhook URL from the incoming request host. */
function buildWebhookUrl(req: import("express").Request): string {
  const proto = (req.header("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  const host = req.header("x-forwarded-host") || req.get("host") || "";
  return `${proto}://${host}/api/public/whatsapp/meta-webhook`;
}

/**
 * Validates local Meta webhook config and returns copy-paste setup info.
 * Does NOT contact Meta — purely a configuration readiness check.
 */
export const checkWhatsAppWebhook = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const { verifyToken, appSecret } = getCloudWebhookConfig();
  const webhookUrl = buildWebhookUrl(req);

  const issues: string[] = [];
  if (settings.whatsappProvider !== "cloud") {
    issues.push("المزود الحالي ليس Meta Cloud API — الويب هوك يخص Cloud API فقط.");
  }
  if (!settings.whatsappCloudPhoneNumberId?.trim()) issues.push("Phone Number ID غير مضبوط.");
  if (!settings.whatsappCloudToken?.trim()) issues.push("Access Token غير مضبوط.");
  if (!verifyToken) issues.push("Verify Token غير موجود — اضغط «توليد» أو احفظ الإعدادات.");

  res.json({
    success: true,
    data: {
      ready: issues.length === 0,
      webhookUrl,
      verifyTokenSet: Boolean(verifyToken),
      appSecretConfigured: Boolean(appSecret),
      appSecretWarning: appSecret ? null : "App Secret غير مضبوط — التحقق من توقيع الرسائل الواردة معطّل (اختياري لكنه أكثر أماناً).",
      issues,
      instructions: [
        "افتح Meta for Developers → تطبيقك → WhatsApp → Configuration.",
        "الصق Callback URL أدناه في حقل Callback URL.",
        "الصق Verify Token في حقل Verify token.",
        "اضغط Verify and save، ثم اشترك في حقل messages.",
      ],
    },
  });
});

/** Generates and persists a new Meta webhook verify token, returns it once. */
export const regenerateVerifyToken = asyncHandler(async (_req, res) => {
  const token = generateVerifyToken();
  await updateSettings({ whatsappCloudVerifyToken: token });
  res.json({ success: true, message: "تم توليد Verify Token جديد", data: { verifyToken: token } });
});
