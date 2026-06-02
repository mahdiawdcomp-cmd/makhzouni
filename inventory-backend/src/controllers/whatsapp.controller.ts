import { asyncHandler } from "../utils/async-handler";
import { getInvoiceById } from "../services/invoice.service";
import { generateInvoicePdf } from "../services/invoice-export.service";
import { renderTemplateByType } from "../services/message-template.service";
import { getSettings } from "../services/settings.service";
import {
  getWhatsAppStatus,
  sendWhatsAppPdf,
  sendWhatsAppText,
} from "../services/whatsapp.service";

export const whatsappStatus = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: getWhatsAppStatus(),
  });
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
