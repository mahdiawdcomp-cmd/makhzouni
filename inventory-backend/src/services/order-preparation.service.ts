import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { sendWhatsAppText } from "./whatsapp.service";
import { getSettings } from "./settings.service";
import { logger } from "../utils/logger";

type PreparationItem = {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
};

function unitAr(unit: string) {
  if (unit === "CARTON") return "كارتون";
  if (unit === "DOZEN") return "درزن";
  return "قطعة";
}

async function safeSendWA(phone: string, message: string) {
  try {
    await sendWhatsAppText(phone, message);
    logger.info(`[WhatsApp] Sent to ${phone}`);
  } catch (firstErr) {
    const msg1 = (firstErr as Error)?.message ?? String(firstErr);
    logger.warn(`[WhatsApp] Send failed (attempt 1) to ${phone}: ${msg1} — retrying in 40s`);
    // Wait 40s for WhatsApp to auto-restart (triggerRestart schedules 10s delay)
    await new Promise((resolve) => setTimeout(resolve, 40_000));
    try {
      await sendWhatsAppText(phone, message);
      logger.info(`[WhatsApp] Sent to ${phone} (retry succeeded)`);
    } catch (secondErr) {
      const msg2 = (secondErr as Error)?.message ?? String(secondErr);
      logger.warn(`[WhatsApp] Send failed (attempt 2) to ${phone}: ${msg2} — giving up`);
    }
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
      items: items as unknown as import("@prisma/client").Prisma.InputJsonValue,
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

  // WhatsApp to customer — step 3 of the flow
  const msg =
    `🚀 *مرحباً ${prep.customerName}!*\n\n` +
    `تم تجهيز طلبك بنجاح وهو في طريقه إليك 📦✨\n\n` +
    `شكراً لثقتك بنا 💚`;

  await safeSendWA(prep.customerPhone, msg);

  return prep;
}

/** Called when a catalog order is submitted by the customer (before approval).
 *  Sends WhatsApp to admin backup number + confirmation to customer. */
export async function notifyCatalogOrderSubmitted(
  customerName: string,
  customerPhone: string,
  items: PreparationItem[],
) {
  const settings = await getSettings().catch(() => null);
  const adminPhone = settings?.backupWhatsappNumber;

  const itemLines = items
    .map((i) => `• ${i.productName}: ${i.quantity} ${unitAr(i.unit)}`)
    .join("\n");

  // To customer
  const customerMsg =
    `🛍️ *تم استلام طلبك!*\n\n` +
    `مرحباً ${customerName}،\n` +
    `وصلنا طلبك وجاري مراجعته من قبل الإدارة.\n\n` +
    `📋 *تفاصيل طلبك:*\n${itemLines}\n\n` +
    `سنتواصل معك بعد الموافقة 🌟`;

  await safeSendWA(customerPhone, customerMsg);

  // To admin
  if (adminPhone) {
    const adminMsg =
      `🔔 *طلب كاتلوك جديد!*\n\n` +
      `الزبون: ${customerName}\n` +
      `الهاتف: ${customerPhone}\n\n` +
      `📦 المواد المطلوبة:\n${itemLines}\n\n` +
      `يرجى الدخول على صفحة الموافقات للمراجعة.`;
    await safeSendWA(adminPhone, adminMsg);
  }

  // Create system notification in DB
  await prisma.notification.create({
    data: {
      type: "CATALOG_ORDER_PENDING",
      message: `طلب كاتلوك جديد من ${customerName} — ${items.length} صنف`,
    },
  });
}

/** Called when admin approves a catalog order (invoice just created).
 *  Sends WhatsApp approval confirmation + invoice summary to customer. */
export async function notifyCatalogOrderApproved(
  customerName: string,
  customerPhone: string,
  invoiceNumber: string,
  totalAmount: number,
  currency: string,
) {
  const msg =
    `✅ *السلام عليكم ${customerName}!*\n\n` +
    `تمت الموافقة على فاتورتك من قبل الإدارة 🎉\n\n` +
    `📄 فاتورة رقم: *${invoiceNumber}*\n` +
    `💰 المجموع: *${Number(totalAmount).toLocaleString("en-US")} ${currency}*\n\n` +
    `⏳ سيتم تجهيز طلبك في أقرب وقت ✨`;

  await safeSendWA(customerPhone, msg);
}
