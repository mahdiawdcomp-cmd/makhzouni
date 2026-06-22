import { Prisma } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
import { generateInvoicePdf } from "./invoice-export.service";
import { getSettings } from "./settings.service";
import { sendWhatsAppPdf, sendWhatsAppText } from "./whatsapp.service";
import { createInvoice } from "./invoice.service";
import { resolveWarehouseId } from "./warehouse-stock.service";

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
  invoiceId: string | null,
  customerName: string,
  customerPhone: string,
  items: PreparationItem[],
  orderData?: Prisma.InputJsonValue,
) {
  return prisma.orderPreparation.create({
    data: {
      ...(invoiceId ? { invoiceId } : {}),
      customerName,
      customerPhone,
      items: items as unknown as Prisma.InputJsonValue,
      ...(orderData ? { orderData } : {}),
    },
  });
}

export async function listPendingPreparations() {
  const rows = await prisma.orderPreparation.findMany({
    where: { status: "PENDING" },
    include: {
      invoice: {
        select: { invoiceNumber: true, totalAmount: true, date: true, customerId: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // The OrderPreparation model stores only customerPhone (no customerId FK).
  // Resolve the customerId by phone so the frontend can pre-select the customer
  // when opening the full invoice page. The customer was created when catalog
  // access was approved, so the phone lookup normally succeeds.
  const phones = Array.from(new Set(rows.map((r) => r.customerPhone).filter(Boolean)));
  const matchedCustomers = phones.length
    ? await prisma.customer.findMany({
        where: { phone: { in: phones } },
        select: { id: true, phone: true },
      })
    : [];
  const customerIdByPhone = new Map(matchedCustomers.map((c) => [c.phone, c.id]));

  return rows.map((row) => {
    const od = row.orderData as { items?: PreparationItem[] } | null;
    const subtotal = od?.items?.reduce((s, it) => s + (it.quantity * (it.unitPrice ?? 0)), 0) ?? 0;
    return {
      id: row.id,
      customerId: row.invoice?.customerId ?? customerIdByPhone.get(row.customerPhone) ?? null,
      invoiceId: row.invoiceId ?? null,
      invoiceNumber: row.invoice?.invoiceNumber ?? null,
      totalAmount: row.invoice ? Number(row.invoice.totalAmount) : subtotal,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      items: row.items as PreparationItem[],
      notes: row.notes ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

// Mark a preparation done by linking an ALREADY-created invoice (manual flow:
// staff opened the full invoice page, edited and saved it themselves). Unlike
// markPrepared, this never creates a new invoice and sends no WhatsApp — the
// invoice page handles its own WhatsApp prompt. Idempotent.
export async function completePreparationWithInvoice(
  preparationId: string,
  userId: string,
  invoiceId: string,
) {
  const prep = await prisma.orderPreparation.findUnique({ where: { id: preparationId } });
  if (!prep) throw new AppError("Preparation not found", 404, "PREP_NOT_FOUND");
  if (prep.status === "PREPARED") return { invoiceId: prep.invoiceId ?? invoiceId };

  await prisma.orderPreparation.update({
    where: { id: preparationId },
    data: {
      status: "PREPARED",
      preparedAt: new Date(),
      preparedById: userId,
      // Link the invoice only if this prep isn't already tied to one (invoiceId is @unique)
      ...(prep.invoiceId ? {} : { invoiceId }),
    },
  });

  return { invoiceId: prep.invoiceId ?? invoiceId };
}

// Cancel a pending preparation (customer's catalog order rejected / not prepared).
// Marks it CANCELLED so it leaves the pending list. If an invoice was already
// created and linked, the caller should cancel that invoice separately. Idempotent.
export async function cancelPreparation(preparationId: string) {
  const prep = await prisma.orderPreparation.findUnique({ where: { id: preparationId } });
  if (!prep) throw new AppError("Preparation not found", 404, "PREP_NOT_FOUND");
  if (prep.status === "PREPARED") {
    throw new AppError("Order already prepared — cancel its invoice instead", 400, "ALREADY_PREPARED");
  }
  if (prep.status === "CANCELLED") return { id: prep.id, status: "CANCELLED" };

  await prisma.orderPreparation.update({
    where: { id: preparationId },
    data: { status: "CANCELLED" },
  });
  return { id: prep.id, status: "CANCELLED" };
}

// Split order items across warehouses if quantity insufficient in primary warehouse
async function splitOrderItemsAcrossWarehouses(
  items: Array<{ productId: string; unit: string; quantity: number; unitPrice?: number; warehouseId?: string }>,
  primaryWarehouseId?: string,
): Promise<typeof items> {
  if (!primaryWarehouseId || items.length === 0) return items;

  // Get all warehouses and their stock levels
  const warehouses = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  const splitItems = [];

  for (const item of items) {
    // Get stock in primary warehouse
    const primaryStock = await prisma.productWarehouseStock.findUnique({
      where: { productId_warehouseId: { productId: item.productId, warehouseId: primaryWarehouseId } },
      select: { quantityPieces: true },
    });

    const available = primaryStock?.quantityPieces ?? 0;

    if (available >= item.quantity) {
      // All quantity available in primary warehouse
      splitItems.push({ ...item, warehouseId: primaryWarehouseId });
    } else {
      // Split across warehouses
      let remaining = item.quantity;

      // First, take from primary warehouse
      if (available > 0) {
        splitItems.push({ ...item, quantity: available, warehouseId: primaryWarehouseId });
        remaining -= available;
      }

      // Then, take from other warehouses
      for (const warehouse of warehouses.filter((w) => w.id !== primaryWarehouseId)) {
        if (remaining <= 0) break;

        const stock = await prisma.productWarehouseStock.findUnique({
          where: { productId_warehouseId: { productId: item.productId, warehouseId: warehouse.id } },
          select: { quantityPieces: true },
        });

        const warehouseQty = Math.min(stock?.quantityPieces ?? 0, remaining);
        if (warehouseQty > 0) {
          splitItems.push({ ...item, quantity: warehouseQty, warehouseId: warehouse.id });
          remaining -= warehouseQty;
        }
      }

      // If still not enough, add remaining (will be negative stock)
      if (remaining > 0) {
        splitItems.push({ ...item, quantity: remaining, warehouseId: primaryWarehouseId });
      }
    }
  }

  return splitItems;
}

type OrderData = {
  customerName: string;
  phone: string;
  address?: string;
  warehouseId?: string;
  items: Array<{ productId: string; unit: string; quantity: number; unitPrice?: number; warehouseId?: string }>;
  discount?: number;
  tax?: number;
  paidAmount?: number;
  paymentType?: string;
};

export async function markPrepared(
  preparationId: string,
  userId: string,
  opts?: { warehouseId?: string; notes?: string },
) {
  const prep = await prisma.orderPreparation.findUnique({
    where: { id: preparationId },
    include: { invoice: { select: { invoiceNumber: true, totalAmount: true } } },
  });

  if (!prep) throw new AppError("Preparation not found", 404, "PREP_NOT_FOUND");
  if (prep.status === "PREPARED") throw new AppError("Already marked as prepared", 400, "ALREADY_PREPARED");

  let invoiceId = prep.invoiceId;
  let invoiceNumber = prep.invoice?.invoiceNumber ?? "";
  let totalAmount = Number(prep.invoice?.totalAmount ?? 0);

  // If invoice not yet created (new flow), create it now
  if (!invoiceId && prep.orderData) {
    const od = prep.orderData as unknown as OrderData;
    const phone = od.phone ?? prep.customerPhone;

    // Find or create customer by phone
    let customer = await prisma.customer.findUnique({ where: { phone } });
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          name: od.customerName ?? prep.customerName,
          phone,
          address: od.address,
          openingBalance: 0,
          currentBalance: 0,
        },
      });
    }

    let items = (od.items ?? []).map((it) => ({
      productId: it.productId,
      unit: it.unit as import("@prisma/client").Unit,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      warehouseId: it.warehouseId ?? opts?.warehouseId ?? od.warehouseId,
    }));

    // Split across warehouses if quantity insufficient
    const splitResult = await splitOrderItemsAcrossWarehouses(
      items.map((it) => ({
        productId: it.productId,
        unit: it.unit as string,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        warehouseId: it.warehouseId,
      })),
      od.warehouseId ?? opts?.warehouseId,
    );

    items = splitResult.map((it) => ({
      productId: it.productId,
      unit: it.unit as import("@prisma/client").Unit,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      warehouseId: it.warehouseId,
    }));

    const invoice = await createInvoice(
      {
        customerId: customer.id,
        type: "SALE",
        discount: od.discount ?? 0,
        tax: od.tax ?? 0,
        paidAmount: od.paidAmount ?? 0,
        paymentType: (od.paymentType as import("@prisma/client").PaymentType) ?? "CREDIT",
        notes: opts?.notes,
        items,
      },
      userId,
    );

    invoiceId = invoice.id;
    invoiceNumber = invoice.invoiceNumber;
    totalAmount = Number(invoice.totalAmount);
  }

  await prisma.orderPreparation.update({
    where: { id: preparationId },
    data: {
      status: "PREPARED",
      preparedAt: new Date(),
      preparedById: userId,
      ...(invoiceId && !prep.invoiceId ? { invoiceId } : {}),
      ...(opts?.notes ? { notes: opts.notes } : {}),
    },
  });

  const settings = await getSettings().catch(() => null);
  const currency = settings?.currency ?? "IQD";
  const customerMsg = [
    `مرحبا ${prep.customerName}`,
    "",
    "تم تجهيز طلبك وهو في طريقه إليك.",
    "",
    invoiceNumber ? `رقم الفاتورة: ${invoiceNumber}` : "",
    `المجموع: ${money(totalAmount)} ${currency}`,
  ].filter(Boolean).join("\n");

  if (invoiceId && invoiceNumber) {
    await safeSendInvoicePdf(prep.customerPhone, customerMsg, invoiceId, invoiceNumber);
  } else {
    await safeSendWA(prep.customerPhone, customerMsg);
  }

  return { invoiceId, invoiceNumber, totalAmount };
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

export async function notifyPreparationStaffPending(
  customerName: string,
  customerPhone: string,
  items: PreparationItem[],
) {
  const settings = await getSettings().catch(() => null);
  const phones = preparationPhones(settings);
  if (phones.length === 0) return;

  const msg = [
    `مرحبا، طلب جديد من ${customerName} (${customerPhone})`,
    "",
    `عدد الأصناف: ${items.length}`,
    itemLines(items),
    "",
    "يرجى تجهيزه من الصفحة الرئيسية.",
  ].join("\n");

  await Promise.all(phones.map((phone) => safeSendWA(phone, msg)));
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
