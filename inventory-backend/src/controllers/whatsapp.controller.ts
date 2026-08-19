import crypto from "node:crypto";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import { getInvoiceById } from "../services/invoice.service";
import { generateInvoicePdf, generateCustomerImagePdf } from "../services/invoice-export.service";
import { renderTemplateByType } from "../services/message-template.service";
import { getSettings, updateSettings } from "../services/settings.service";
import { routeIncomingMessage } from "../services/whatsapp-bot.service";
import { applyMessageReaction, fillConversationContactName, logChatMessage, updateMessageStatus } from "../services/whatsapp-chat.service";
import { sendInvoiceToWorkers } from "../services/worker-notify.service";
import { logger } from "../utils/logger";
import { recordError } from "../services/error-log.service";
import { handleQualityWebhookEvent, handleAccountRestrictionEvent } from "../services/whatsapp-quality.service";
import { ErrorLogSource } from "@prisma/client";
import {
  getCloudWebhookConfig,
  generateVerifyToken,
  getWhatsAppStatus,
  restartWhatsApp,
  fetchCloudMedia,
  getWabaSubscribedApps,
  subscribeAppToWaba,
  sendWhatsAppImage,
  sendWhatsAppPdf,
  sendWhatsAppTemplate,
  sendWhatsAppTemplatePdf,
  sendWhatsAppText,
  invoiceTemplateBodyParams,
  type WhatsAppSendChannel,
} from "../services/whatsapp.service";

/** Per-send channel from the UI picker. undefined = tenant default provider. */
function parseChannel(v: unknown): WhatsAppSendChannel | undefined {
  return v === "official" || v === "personal" ? v : undefined;
}

// Meta template language for every template-or-fallback send below — all of
// them (invoice, voucher, statement, portal link) are Arabic for this tenant.
const CLOUD_TEMPLATE_LANG = "ar";

// Cloud API: try the Meta-approved template first (works regardless of 24h
// session state), and only fall back to the free-text send if the template
// call fails (not configured, not yet approved, wrong param count, etc.) —
// never worse than the pre-template behavior, and starts working the moment
// a template is approved and its name is saved in Settings, no deploy needed.
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
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn(`[WhatsApp] template "${templateName}" send failed, falling back to free text: ${detail}`);
    await recordError({
      source: ErrorLogSource.WHATSAPP,
      code: "WHATSAPP_TEMPLATE_FAILED",
      message: `فشل قالب "${templateName}" — ${detail}`,
      context: { templateName },
    }).catch(() => {});
    return fallback();
  }
}

function sendInvoiceViaCloudSafe(phone: string, templateName: string | undefined, message: string, pdf: Buffer, filename: string, bodyParams: string[], channel?: WhatsAppSendChannel) {
  // Personal channel (Green API) has no templates — plain PDF through it.
  if (channel === "personal") {
    return sendWhatsAppPdf(phone, message, pdf, filename, { channel });
  }
  return withTemplateFallback(
    templateName,
    () => sendWhatsAppTemplatePdf(phone, templateName as string, CLOUD_TEMPLATE_LANG, pdf, filename, bodyParams),
    () => sendWhatsAppPdf(phone, message, pdf, filename, { channel }),
  );
}

function sendTextViaCloudSafe(phone: string, templateName: string | undefined, message: string, bodyParams: string[], channel?: WhatsAppSendChannel) {
  if (channel === "personal") {
    return sendWhatsAppText(phone, message, { channel });
  }
  return withTemplateFallback(
    templateName,
    () => sendWhatsAppTemplate(phone, templateName as string, CLOUD_TEMPLATE_LANG, { bodyParams }),
    () => sendWhatsAppText(phone, message, { channel }),
  );
}

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

/**
 * Integrity check on the Meta webhook. Fails CLOSED.
 *
 * This used to accept unsigned payloads whenever no App Secret was stored,
 * which meant a tenant that had not filled the field in yet had a fully open,
 * unauthenticated endpoint that drives outbound WhatsApp sends and writes rows
 * into the chat log and prospect pipeline. An unconfigured integration is a
 * disabled integration, not an open one.
 */
function metaSignatureValid(req: import("express").Request): boolean {
  const { appSecret } = getCloudWebhookConfig();
  if (!appSecret) {
    logger.warn(
      "[WhatsAppMeta] rejected webhook: no App Secret configured — set it in الإعدادات to enable inbound messages"
    );
    return false;
  }
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

type CloudInboundMessage = {
  id?: string;
  from?: string;
  type?: string;
  context?: { id?: string };
  reaction?: { message_id?: string; emoji?: string };
  text?: { body?: string };
  // بند ٥ — quick-reply button click. Meta sends the legacy template-button
  // shape ("button") for a QUICK_REPLY button on an approved template, and
  // the interactive shape ("interactive"/button_reply) for a freeform
  // interactive message. The button's payload/id is whatever the admin set
  // up in Meta Business Manager — the campaign template must use "1"/"2" as
  // the payload/id so it lines up with the numeric text fallback.
  button?: { payload?: string; text?: string };
  interactive?: { type?: string; button_reply?: { id?: string; title?: string } };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
  video?: { id?: string; mime_type?: string; caption?: string };
  sticker?: { id?: string; mime_type?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: Array<{ name?: { formatted_name?: string } }>;
};

/**
 * Logs every NON-text inbound message type into the WhatsApp chat log — the
 * bot/inbox pipeline (routeIncomingMessage) is text-command-driven only, so
 * media never goes through it. Every branch always calls logChatMessage with
 * at least a readable placeholder — nothing is ever silently dropped, even if
 * the actual media download fails or the type is one Meta adds later.
 */
async function logInboundMediaMessage(phone: string, msg: CloudInboundMessage) {
  const waMessageId = msg.id;
  const base = { phone, direction: "IN" as const, waMessageId, replyToWaMessageId: msg.context?.id ?? null };

  switch (msg.type) {
    case "image": {
      const media = msg.image?.id ? await fetchCloudMedia(msg.image.id) : null;
      await logChatMessage({
        ...base,
        text: msg.image?.caption ?? "",
        mediaType: "IMAGE",
        mediaDataUrl: media?.dataUrl,
        mediaMimeType: media?.mimeType ?? msg.image?.mime_type,
      });
      return;
    }
    case "document": {
      const media = msg.document?.id ? await fetchCloudMedia(msg.document.id) : null;
      await logChatMessage({
        ...base,
        text: msg.document?.caption ?? "",
        mediaType: "DOCUMENT",
        mediaDataUrl: media?.dataUrl,
        mediaFilename: msg.document?.filename,
        mediaMimeType: media?.mimeType ?? msg.document?.mime_type,
      });
      return;
    }
    case "audio": {
      const media = msg.audio?.id ? await fetchCloudMedia(msg.audio.id) : null;
      await logChatMessage({
        ...base,
        text: "",
        mediaType: "AUDIO",
        mediaDataUrl: media?.dataUrl,
        mediaMimeType: media?.mimeType ?? msg.audio?.mime_type,
      });
      return;
    }
    case "video": {
      const media = msg.video?.id ? await fetchCloudMedia(msg.video.id) : null;
      await logChatMessage({
        ...base,
        text: msg.video?.caption ?? "",
        mediaType: "VIDEO",
        mediaDataUrl: media?.dataUrl,
        mediaMimeType: media?.mimeType ?? msg.video?.mime_type,
      });
      return;
    }
    case "sticker": {
      const media = msg.sticker?.id ? await fetchCloudMedia(msg.sticker.id) : null;
      await logChatMessage({
        ...base,
        text: "",
        mediaType: "STICKER",
        mediaDataUrl: media?.dataUrl,
        mediaMimeType: media?.mimeType ?? msg.sticker?.mime_type,
      });
      return;
    }
    case "location": {
      const loc = msg.location;
      const label = loc?.name || loc?.address || "";
      const link = loc?.latitude != null && loc?.longitude != null ? `https://maps.google.com/?q=${loc.latitude},${loc.longitude}` : "";
      await logChatMessage({ ...base, text: [label, link].filter(Boolean).join("\n"), mediaType: "LOCATION" });
      return;
    }
    case "contacts": {
      const names = (msg.contacts ?? []).map((c) => c.name?.formatted_name).filter(Boolean).join("، ");
      await logChatMessage({ ...base, text: `👤 جهة اتصال مشتركة: ${names || "غير معروف"}` });
      return;
    }
    default:
      // reactions, interactive/button replies, or any future Meta message type.
      await logChatMessage({ ...base, text: `📎 رسالة غير مدعومة (${msg.type ?? "unknown"})` });
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
          // بند ٩ — يميّز نوع التغيير: "messages" (الافتراضي الضمني سابقاً،
          // لا يزال يعمل بدون هذا الحقل) مقابل phone_number_quality_update /
          // account_update، الآن معالَجان صراحة بدل ما يمرّا بصمت بلا أثر.
          field?: string;
          value?: {
            contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
            messages?: CloudInboundMessage[];
            statuses?: Array<{
              id?: string;
              status?: string;
              errors?: Array<{ title?: string; message?: string; error_data?: { details?: string } }>;
            }>;
            // phone_number_quality_update
            event?: string;
            current_limit?: string;
            // account_update
            violation_info?: { violation_type?: string };
          };
        }>;
      }>;
    };

    logger.info(`[WhatsAppMeta] webhook received: object=${body.object ?? "unknown"}`);

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        // بند ٩ — حماية جودة الرقم: هذان النوعان مستقلان كلياً عن معالجة
        // الرسائل أدناه، تُعالجان وتُكمَّل الحلقة الحالية فوراً.
        if (change.field === "phone_number_quality_update") {
          await handleQualityWebhookEvent(change.value?.event, change.value?.current_limit).catch((err) =>
            logger.warn(`[WhatsAppMeta] quality-update handling failed: ${err instanceof Error ? err.message : String(err)}`)
          );
          continue;
        }
        if (change.field === "account_update") {
          await handleAccountRestrictionEvent(change.value?.violation_info?.violation_type).catch((err) =>
            logger.warn(`[WhatsAppMeta] account-restriction handling failed: ${err instanceof Error ? err.message : String(err)}`)
          );
          continue;
        }

        // Customer's WhatsApp profile name — fills the conversation title when
        // the number matches no customer/prospect record.
        const profile = change.value?.contacts?.[0];
        if (profile?.wa_id && profile.profile?.name) {
          await fillConversationContactName(profile.wa_id, profile.profile.name).catch(() => {});
        }

        for (const msg of change.value?.messages ?? []) {
          const phone = (msg.from ?? "").replace(/\D/g, "");
          if (!phone) continue;

          if (msg.type === "reaction") {
            // Emoji on one of OUR messages — attach it to the target, not a new row.
            if (msg.reaction?.message_id) {
              await applyMessageReaction(msg.reaction.message_id, msg.reaction.emoji ?? null).catch(() => {});
            }
          } else if (msg.type === "text") {
            const text = msg.text?.body ?? "";
            if (text) await routeIncomingMessage(phone, text, msg.id, { replyToWaMessageId: msg.context?.id });
          } else if (msg.type === "button" || (msg.type === "interactive" && msg.interactive?.type === "button_reply")) {
            // بند ٥ — a button click converges onto the exact same pipeline as
            // typed text ("1"/"2"), so the numeric fallback and the real
            // buttons can never disagree about what a reply means.
            const buttonText =
              msg.button?.payload?.trim() ||
              msg.interactive?.button_reply?.id?.trim() ||
              msg.button?.text?.trim() ||
              msg.interactive?.button_reply?.title?.trim() ||
              "";
            if (buttonText) {
              await routeIncomingMessage(phone, buttonText, msg.id, { replyToWaMessageId: msg.context?.id });
            } else {
              await logInboundMediaMessage(phone, msg).catch((err) =>
                logger.warn(`[WhatsAppMeta] failed to log inbound ${msg.type} message: ${err instanceof Error ? err.message : String(err)}`)
              );
            }
          } else {
            await logInboundMediaMessage(phone, msg).catch((err) =>
              logger.warn(`[WhatsAppMeta] failed to log inbound ${msg.type} message: ${err instanceof Error ? err.message : String(err)}`)
            );
          }
        }

        // Delivery lifecycle of OUR outbound messages (sent/delivered/read/failed).
        for (const st of change.value?.statuses ?? []) {
          if (!st.id || !st.status) continue;
          const err = st.errors?.[0];
          const reason = err ? [err.title, err.error_data?.details ?? err.message].filter(Boolean).join(": ") : null;
          if (st.status === "failed") logger.warn(`[WhatsAppMeta] outbound message ${st.id} failed: ${reason ?? "unknown"}`);
          await updateMessageStatus(st.id, st.status, reason).catch((e) =>
            logger.warn(`[WhatsAppMeta] failed to apply status ${st.status} for ${st.id}: ${e instanceof Error ? e.message : String(e)}`)
          );
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
  const channel = parseChannel((req.body as { channel?: unknown })?.channel);
  const result = await sendWhatsAppText(phone, message, { channel });

  res.json({
    success: true,
    message: "WhatsApp message sent successfully",
    data: result,
  });
});

// Shared template-or-fallback send for screens that already build their own
// free-text message client-side (voucher receipt, customer statement, portal
// link) — the client sends the exact fallback text plus the raw values as
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

export const sendTemplatedMessage = asyncHandler(async (req, res) => {
  const phone = String(req.body?.phone ?? "");
  const message = String(req.body?.message ?? "");
  const kind = String(req.body?.templateKind ?? "") as TemplateKind;
  const bodyParams = Array.isArray(req.body?.bodyParams) ? (req.body.bodyParams as unknown[]).map(String) : [];
  if (!phone || !message) throw new AppError("رقم الهاتف والنص مطلوبان", 400, "SEND_TEMPLATED_INVALID");
  if (!(kind in TEMPLATE_KIND_SETTING)) throw new AppError("نوع القالب غير معروف", 400, "SEND_TEMPLATED_UNKNOWN_KIND");

  const settings = await getSettings();
  const templateName = settings[TEMPLATE_KIND_SETTING[kind]];
  const channel = parseChannel(req.body?.channel);
  const result = await sendTextViaCloudSafe(phone, templateName, message, bodyParams, channel);

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

  // Order matches the {{1}}..{{9}} placeholders in the Meta template body —
  // keep in sync with the template text configured in WhatsApp Manager.
  const bodyParams = invoiceTemplateBodyParams(invoice, settings.storeName);
  const result = await sendInvoiceViaCloudSafe(
    invoice.customer.phone,
    settings.invoiceTemplateName,
    message,
    pdf,
    `${invoice.invoiceNumber}.pdf`,
    bodyParams,
    parseChannel((req.body as { channel?: unknown })?.channel),
  );

  res.json({
    success: true,
    message: "Invoice sent by WhatsApp successfully",
    data: result,
  });
});

// New, separate option: "إرسال فاتورة بالصور" — sends a customer-safe invoice
// (product thumbnails, no purchase price/cost/profit) instead of the existing
// PDF above. Same visual, wrapped as a PDF (not a raw image) so it can reuse
// the SAME approved Meta template as the regular invoice — one template
// covers both sends, only the attached file's content differs.
export const sendInvoiceImage = asyncHandler(async (req, res) => {
  const invoiceId = String(req.params.invoiceId);
  const [invoice, pdf, settings] = await Promise.all([
    getInvoiceById(invoiceId),
    generateCustomerImagePdf(invoiceId),
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

  const result = await sendInvoiceViaCloudSafe(
    invoice.customer.phone,
    settings.invoiceTemplateName,
    message,
    pdf,
    `${invoice.invoiceNumber}-صور.pdf`,
    invoiceTemplateBodyParams(invoice, settings.storeName),
    parseChannel((req.body as { channel?: unknown })?.channel),
  );

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
  const channel = parseChannel((req.body as { channel?: unknown })?.channel);
  const result = await sendInvoiceToWorkers(invoiceId, phones, channel);
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

/**
 * Lists which Meta Apps are subscribed to this WABA's webhook events. Changing
 * the Callback URL alone does NOT move this — a number set up through another
 * tool (e.g. Chatwoot) will keep sending events to THAT tool's app until ours
 * is explicitly (re-)subscribed via postWhatsappSubscribeApp below.
 */
export const getWhatsappSubscribedApps = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const wabaId = String(req.query.wabaId ?? settings.whatsappCloudBusinessAccountId ?? "").trim();
  if (!wabaId) throw new AppError("Business Account ID (WABA) غير مضبوط", 400, "WABA_ID_MISSING");

  const apps = await getWabaSubscribedApps(wabaId);
  res.json({ success: true, data: { wabaId, apps } });
});

/** Subscribes OUR app (the one behind the stored Cloud access token) to the WABA. */
export const postWhatsappSubscribeApp = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const wabaId = String(req.body?.wabaId ?? settings.whatsappCloudBusinessAccountId ?? "").trim();
  if (!wabaId) throw new AppError("Business Account ID (WABA) غير مضبوط", 400, "WABA_ID_MISSING");

  await subscribeAppToWaba(wabaId);
  const apps = await getWabaSubscribedApps(wabaId);
  res.json({ success: true, message: "تم اشتراك التطبيق بنجاح", data: { wabaId, apps } });
});
