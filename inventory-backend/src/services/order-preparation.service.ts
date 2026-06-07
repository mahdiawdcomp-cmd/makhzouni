import { Prisma } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
import { generateInvoicePdf } from "./invoice-export.service";
import { getSettings } from "./settings.service";
import { sendWhatsAppPdf, sendWhatsAppText } from "./whatsapp.service";

type PreparationItem = {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
};

const retryDelays = [3000, 8000, 15000, 30000];

function unitAr(unit: string) {
  if (unit === "CARTON") return "كارتون";
  if (unit === "DOZEN") return "درزن";
  return "قطعة";
}

function money(value: number) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function catalogBaseUrl(settings: Awaited<ReturnType<typeof getSettings>> | null) {
  const configured = settings?.catalogPublicUrl?.trim() || process.env.PUBLIC_CATALOG_URL?.trim();
  return (configured || "https://inventory-web-six-kohl.vercel.app/catalog").replace(/\/$/, "");
}

function catalogUrl(settings: Awaited<ReturnType<typeof getSettings>> | null, urlPath?: string) {
  const base = catalogBaseUrl(settings);
  if (!urlPath) return base;
  if (urlPath.startsWith("http://") || urlPath.startsWith("https://")) return urlPath;
  const query = urlPath.includes("?") ? urlPath.slice(urlPath.indexOf("?")) : "";
  return `${base}${query}`;
}

function adminPhone(settings: Awaited<ReturnType<typeof getSettings>> | null) {
  return settings?.catalogAdminWhatsappNumber?.trim() || settings?.backupWhatsappNumber?.trim() || "";
}

function preparationPhones(settings: Awaited<ReturnType<typeof getSettings>> | null) {
  const raw = settings?.orderPreparationWhatsappNumbers ?? "";
  return raw
    .split(/[\n,،;]+/)
    .map((phone) => phone.trim())
    .filter(Boolean);
}

function itemLines(items: PreparationItem[]) {
  return items.map((item) => `- ${item.productName}: ${item.quantity} ${unitAr(item.unit)}`).join("\n");
}

function scheduleTextRetry(phone: string, message: string, attempt = 0) {
  const delay = retryDelays[attempt];
  if (!delay) return;
  setTimeout(async () => {
    try {
      await sendWhatsAppText(phone, message);
      logger.info(`[WhatsApp] Retry sent to ${phone} (attempt ${attempt + 1})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[WhatsApp] Retry failed to ${phone} (attempt ${attempt + 1}): ${msg}`);
      scheduleTextRetry(phone, message, attempt + 1);
    }
  }, delay);
}

function scheduleInvoiceRetry(phone: string, message: string, invoiceId: string, invoiceNumber: string, attempt = 0) {
  const delay = retryDelays[attempt];
  if (!delay) return;
  setTimeout(async () => {
    try {
      const pdf = await generateInvoicePdf(invoiceId);
      await sendWhatsAppPdf(phone, message, pdf, `${invoiceNumber}.pdf`);
      logger.info(`[WhatsApp] Invoice PDF retry sent to ${phone} (attempt ${attempt + 1})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[WhatsApp] Invoice PDF retry failed to ${phone} (attempt ${attempt + 1}): ${msg}`);
      scheduleInvoiceRetry(phone, message, invoiceId, invoiceNumber, attempt + 1);
    }
  }, delay);
}

async function safeSendWA(phone: string, message: string) {
  try {
    await sendWhatsAppText(phone, message);
    logger.info(`[WhatsApp] Sent to ${phone}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[WhatsApp] Send failed to ${phone}: ${msg}`);
    scheduleTextRetry(phone, message);
  }
}

async function safeSendInvoicePdf(phone: string, message: string, invoiceId: string, invoiceNumber: string) {
  try {
    const pdf = await generateInvoicePdf(invoiceId);
    await sendWhatsAppPdf(phone, message, pdf, `${invoiceNumber}.pdf`);
    logger.info(`[WhatsApp] Invoice PDF sent to ${phone}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[WhatsApp] Invoice PDF send failed to ${phone}: ${msg}`);
    await safeSendWA(phone, message);
    scheduleInvoiceRetry(phone, message, invoiceId, invoiceNumber);
  }
}

export async function createOrderPreparation(
  invoiceId: string,
  customerName: string,
  customerPhone: string,
  items: PreparationItem[],
) {
  return prisma.orderPreparation.create({
    data: {
      invoiceId,
      customerName,
      customerPhone,
      items: items as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function listPendingPreparations() {
  const rows = await prisma.orderPreparation.findMany({
    where: { status: "PENDING" },
    include: {
      invoice: {
        select: {
          invoiceNumber: true,
          totalAmount: true,
          date: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoice.invoiceNumber,
    totalAmount: Number(row.invoice.totalAmount),
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    items: row.items as PreparationItem[],
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function markPrepared(preparationId: string, userId: string) {
  const prep = await prisma.orderPreparation.findUnique({
    where: { id: preparationId },
    include: {
      invoice: { select: { invoiceNumber: true, totalAmount: true } },
    },
  });

  if (!prep) throw new AppError("Preparation not found", 404, "PREP_NOT_FOUND");
  if (prep.status === "PREPARED") throw new AppError("Already marked as prepared", 400, "ALREADY_PREPARED");

  await prisma.orderPreparation.update({
    where: { id: preparationId },
    data: {
      status: "PREPARED",
      preparedAt: new Date(),
      preparedById: userId,
    },
  });

  // Text only — customer already received the PDF when the order was approved
  await safeSendWA(prep.customerPhone, "طلبك تجهز وكامل وهو بطريقه اليك 🎉");

  return prep;
}

export async function notifyCatalogAccessRequested(
  customerName: string,
  customerPhone: string,
  address?: string,
  notes?: string,
) {
  const settings = await getSettings().catch(() => null);
  const admin = adminPhone(settings);

  await safeSendWA(customerPhone, "لقد تم تقديم طلبك للدخول الى المتجر الالكتروني");

  if (admin) {
    const parts = [
      "طلب دخول كتلوك معلق",
      "",
      `الزبون: ${customerName}`,
      `الهاتف: ${customerPhone}`,
      address ? `العنوان: ${address}` : "",
      notes ? `ملاحظات: ${notes}` : "",
      "",
      "راجع صفحة الموافقات حتى تسمح له بالدخول وتحدد هل يشوف الأسعار أو لا.",
    ].filter(Boolean);
    await safeSendWA(admin, parts.join("\n"));
  }
}

export async function notifyCatalogAccessApproved(
  customerName: string,
  customerPhone: string,
  urlPath: string,
  _allowPrices: boolean,
) {
  const settings = await getSettings().catch(() => null);
  const url = catalogUrl(settings, urlPath);
  await safeSendWA(
    customerPhone,
    `لقد تم الموافقه على طلبك يمكنك الدخول عبر الرابط\n${url}`,
  );
}

export async function notifyCatalogOrderSubmitted(
  customerName: string,
  customerPhone: string,
  items: PreparationItem[],
) {
  const settings = await getSettings().catch(() => null);
  const admin = adminPhone(settings);

  await safeSendWA(customerPhone, "تم تثبيت الفاتورة وفي انتضار الموافقه والتجهيز");

  if (admin) {
    await safeSendWA(
      admin,
      [
        "طلب فاتورة من الكتلوك",
        "",
        `الزبون: ${customerName}`,
        `الهاتف: ${customerPhone}`,
        "",
        "المواد المطلوبة:",
        itemLines(items),
        "",
        "روح لصفحة الموافقات، اقرأ الطلب، وإذا مضبوط وافق عليه.",
      ].join("\n"),
    );
  }

  await prisma.notification.create({
    data: {
      type: "CATALOG_ORDER_PENDING",
      message: `طلب كتلوك جديد من ${customerName} - ${items.length} صنف`,
    },
  });
}

export async function notifyCatalogOrderApproved(
  customerName: string,
  customerPhone: string,
  invoiceId: string,
  invoiceNumber: string,
  totalAmount: number,
  currency: string,
) {
  const message = [
    `مرحبا ${customerName}`,
    "",
    "تمت الموافقة على طلبك وسيتم تجهيزه باسرع وقت.",
    "",
    `رقم الفاتورة: ${invoiceNumber}`,
    `المجموع: ${money(totalAmount)} ${currency}`,
  ].join("\n");

  // Send the invoice PDF to the customer
  await safeSendInvoicePdf(customerPhone, message, invoiceId, invoiceNumber);
}

export async function notifyPreparationStaff(
  customerName: string,
  _customerPhone: string,
  invoiceId: string,
  invoiceNumber: string,
  _totalAmount: number,
  _currency: string,
  items: PreparationItem[],
) {
  const settings = await getSettings().catch(() => null);
  const phones = preparationPhones(settings);
  if (phones.length === 0) return;

  const msg = [
    `مرحبا لديك فاتورة باسم ${customerName} بيها ${items.length} صنف`,
    "",
    itemLines(items),
    "",
    "يرجى تجهيزها بأسرع وقت.",
  ].join("\n");

  // Send invoice PDF to each preparation staff member
  await Promise.all(phones.map((phone) => safeSendInvoicePdf(phone, msg, invoiceId, invoiceNumber)));
}
