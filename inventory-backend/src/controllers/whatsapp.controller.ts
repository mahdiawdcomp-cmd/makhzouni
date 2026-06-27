import { asyncHandler } from "../utils/async-handler";
import { getInvoiceById } from "../services/invoice.service";
import { generateInvoicePdf } from "../services/invoice-export.service";
import { renderTemplateByType } from "../services/message-template.service";
import { getSettings } from "../services/settings.service";
import { routeIncomingMessage } from "../services/whatsapp-bot.service";
import {
  getWhatsAppStatus,
  restartWhatsApp,
  sendWhatsAppPdf,
  sendWhatsAppText,
} from "../services/whatsapp.service";

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
