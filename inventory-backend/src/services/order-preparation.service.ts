import { OrderPreparationStatus, Prisma } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
import { generateInvoicePdf } from "./invoice-export.service";
import { getSettings } from "./settings.service";
import { commitAccessCode, prepareCustomerCode } from "./customer-login.service";
import { sendWhatsAppPdf, sendWhatsAppText, sendPdfWithTemplateFallback, sendTextWithTemplateFallback, invoiceTemplateBodyParams } from "./whatsapp.service";
import { createInvoice, getInvoiceById } from "./invoice.service";
import { resolveWarehouseId } from "./warehouse-stock.service";
import { notifyAdmin } from "./app-notification.service";
import { sendTelegramDmToPhone } from "./telegram-bot.service";
import { catalogPublicUrl } from "../utils/public-urls";
import { buildDeliveryLine } from "../utils/deliveryRegion";

const CLOUD_TEMPLATE_LANG = "ar";

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
  if (unit === "BOX") return "علبة";
  if (unit === "DOZEN") return "درزن";
  return "قطعة";
}

function money(value: number) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function catalogBaseUrl(settings: Awaited<ReturnType<typeof getSettings>> | null) {
  // No cross-tenant fallback: an unconfigured shop sends no link rather than
  // sending its customers to another tenant's storefront.
  return catalogPublicUrl(
    settings?.catalogPublicUrl?.trim() || process.env.PUBLIC_CATALOG_URL?.trim()
  );
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

// Customer-facing sibling of safeSendInvoicePdf — reuses the same approved
// invoice template as the regular PDF invoice send (settings.invoiceTemplateName),
// so the order-approved and order-prepared notifications survive Meta's 24h
// window too. Staff-facing sends (notifyPreparationStaff) stay on the plain
// safeSendInvoicePdf above — they're internal, not gated by the 24h rule the
// same way, and don't need to match the customer template's body shape.
async function safeSendInvoicePdfTemplated(phone: string, message: string, invoiceId: string, invoiceNumber: string) {
  try {
    const [pdf, settings, invoice] = await Promise.all([
      generateInvoicePdf(invoiceId),
      getSettings().catch(() => null),
      getInvoiceById(invoiceId),
    ]);
    const bodyParams = invoiceTemplateBodyParams(invoice, settings?.storeName || "المتجر");
    await sendPdfWithTemplateFallback(phone, settings?.invoiceTemplateName, CLOUD_TEMPLATE_LANG, message, pdf, `${invoiceNumber}.pdf`, bodyParams);
    logger.info(`[WhatsApp] Invoice PDF sent to ${phone}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[WhatsApp] Invoice PDF send failed to ${phone}: ${msg}`);
    await safeSendWA(phone, message);
    scheduleInvoiceRetry(phone, message, invoiceId, invoiceNumber);
  }
}

// Customer-facing sibling of safeSendWA — tries the matching Meta template
// (from settings) first, falls back to the same free text + retry schedule.
async function safeSendWATemplated(phone: string, message: string, templateName: string | undefined, bodyParams: string[] = []) {
  try {
    await sendTextWithTemplateFallback(phone, templateName, CLOUD_TEMPLATE_LANG, message, bodyParams);
    logger.info(`[WhatsApp] Sent to ${phone}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[WhatsApp] Send failed to ${phone}: ${msg}`);
    scheduleTextRetry(phone, message);
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

/**
 * «زبون جديد — نسويله حساب؟» (Telegram bot orders): creates a Customer from the
 * preparation's name+phone so the invoice lands on a real account. Idempotent —
 * if the phone already belongs to a customer, just returns it.
 */
export async function createCustomerForPreparation(id: string) {
  const { createCustomer } = await import("./customer.service");
  const prep = await prisma.orderPreparation.findUnique({ where: { id } });
  if (!prep) throw new AppError("Preparation not found", 404, "PREPARATION_NOT_FOUND");
  if (!prep.customerPhone) throw new AppError("لا يوجد رقم هاتف بالطلب", 400, "PREPARATION_NO_PHONE");
  const existing = await prisma.customer.findFirst({
    where: { phone: prep.customerPhone, deletedAt: null },
    select: { id: true, name: true },
  });
  if (existing) return { customerId: existing.id, name: existing.name, created: false };
  const customer = await createCustomer({
    name: prep.customerName || "زبون تيليگرام",
    phone: prep.customerPhone,
    notes: "أُنشئ من طلب بوت تيليگرام",
    openingBalance: 0,
  });
  return { customerId: customer.id, name: customer.name, created: true };
}

export async function listPendingPreparations() {
  const rows = await prisma.orderPreparation.findMany({
    where: { status: OrderPreparationStatus.PENDING },
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
  if (prep.status === OrderPreparationStatus.PREPARED) return { invoiceId: prep.invoiceId ?? invoiceId };

  await prisma.orderPreparation.update({
    where: { id: preparationId },
    data: {
      status: OrderPreparationStatus.PREPARED,
      preparedAt: new Date(),
      preparedById: userId,
      // Link the invoice only if this prep isn't already tied to one (invoiceId is @unique)
      ...(prep.invoiceId ? {} : { invoiceId }),
    },
  });

  // prep.invoiceId may already be set (linked before being marked PREPARED,
  // guarded above) — the param `invoiceId` in that case refers to a
  // DIFFERENT invoice than the one actually tied to this prep. Everything
  // below must reference the resolved id, not the raw parameter.
  const finalInvoiceId = prep.invoiceId ?? invoiceId;

  if (prep.source) {
    await prisma.invoice
      .updateMany({ where: { id: finalInvoiceId, source: null }, data: { source: prep.source } })
      .catch(() => undefined);
  }

  // This path (staff built the invoice directly, then linked it here) sends
  // no WhatsApp message today — the Telegram DM is a genuinely new touch
  // point, not a duplicate of anything markPrepared() already sends.
  getInvoiceById(finalInvoiceId)
    .then((invoice) => {
      if (!invoice) return;
      const msg = `طلبك جهز ✔️ وراح يوصلك\n\nرقم الفاتورة: ${invoice.invoiceNumber}\nالمجموع: ${money(Number(invoice.totalAmount))}`;
      return sendTelegramDmToPhone(prep.customerPhone, msg);
    })
    .catch(() => undefined);

  return { invoiceId: finalInvoiceId };
}

// Cancel a pending preparation (customer's catalog order rejected / not prepared).
// Marks it CANCELLED so it leaves the pending list. If an invoice was already
// created and linked, the caller should cancel that invoice separately. Idempotent.
export async function cancelPreparation(preparationId: string) {
  const prep = await prisma.orderPreparation.findUnique({ where: { id: preparationId } });
  if (!prep) throw new AppError("Preparation not found", 404, "PREP_NOT_FOUND");
  if (prep.status === OrderPreparationStatus.PREPARED) {
    throw new AppError("Order already prepared — cancel its invoice instead", 400, "ALREADY_PREPARED");
  }
  if (prep.status === OrderPreparationStatus.CANCELLED) return { id: prep.id, status: OrderPreparationStatus.CANCELLED };

  await prisma.orderPreparation.update({
    where: { id: preparationId },
    data: { status: OrderPreparationStatus.CANCELLED },
  });
  return { id: prep.id, status: OrderPreparationStatus.CANCELLED };
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
  couponCode?: string;
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
  if (prep.status === OrderPreparationStatus.PREPARED) throw new AppError("Already marked as prepared", 400, "ALREADY_PREPARED");

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
        couponCode: od.couponCode,
        items,
      },
      userId,
    );

    invoiceId = invoice.id;
    invoiceNumber = invoice.invoiceNumber;
    totalAmount = Number(invoice.totalAmount);

    if (prep.source) {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { source: prep.source } }).catch(() => undefined);
    }
  }

  await prisma.orderPreparation.update({
    where: { id: preparationId },
    data: {
      status: OrderPreparationStatus.PREPARED,
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
    await safeSendInvoicePdfTemplated(prep.customerPhone, customerMsg, invoiceId, invoiceNumber);
  } else {
    await safeSendWA(prep.customerPhone, customerMsg);
  }
  // Parallel Telegram DM if this customer has a linked bot chat — harmless
  // no-op otherwise. Never blocks/fails the primary WhatsApp flow above.
  sendTelegramDmToPhone(prep.customerPhone, `طلبك جهز ✔️ وراح يوصلك\n\n${customerMsg}`).catch(() => undefined);

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

  await safeSendWATemplated(customerPhone, "لقد تم تقديم طلبك للدخول الى المتجر الالكتروني", settings?.catalogAccessRequestedTemplateName);

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

// The guest catalog phone gate accepts any client-supplied phone with no OTP
// verification, so a burst of incrementing fake numbers could otherwise be
// used to flood the admin's WhatsApp with "new lead" pings. The in-app
// notification below always fires (dedupeKey keeps it one-per-phone and it's
// harmless spam at worst), but the actual WhatsApp send is capped globally.
const NEW_LEAD_WA_MAX_PER_HOUR = 15;
const NEW_LEAD_WA_WINDOW_MS = 60 * 60_000;
let newLeadWaWindowStart = 0;
let newLeadWaCount = 0;

function canSendNewLeadWhatsApp(): boolean {
  const now = Date.now();
  if (now - newLeadWaWindowStart > NEW_LEAD_WA_WINDOW_MS) {
    newLeadWaWindowStart = now;
    newLeadWaCount = 0;
  }
  if (newLeadWaCount >= NEW_LEAD_WA_MAX_PER_HOUR) return false;
  newLeadWaCount++;
  return true;
}

// Fired the first time a brand-new phone number passes the guest catalog phone
// gate. Rings the admin bell and (if configured) pings the admin on WhatsApp so
// they can follow up on the fresh lead.
export async function notifyNewCatalogLead(phone: string) {
  const settings = await getSettings().catch(() => null);
  const admin = adminPhone(settings);

  await notifyAdmin({
    type: "catalog_new_lead",
    category: "catalog",
    severity: "info",
    title: "زائر جديد بالكتلوك",
    message: `رقم جديد دخل كتلوك الجملة: ${phone}`,
    entityType: "catalog_visitor",
    entityId: phone,
    actionUrl: "/catalog-management",
    dedupeKey: `catalog_lead:${phone}`,
  }).catch(() => {});

  if (admin && canSendNewLeadWhatsApp()) {
    await safeSendWA(admin, `زائر جديد دخل كتلوك الجملة\nالرقم: ${phone}\n\nراجع «الزوار الجدد» بصفحة إدارة الكتلوك للتواصل معه.`);
  }
}

export const DEFAULT_ACCESS_APPROVED_TEMPLATE = [
  "أهلاً {{customerName}} 👋",
  "تمت الموافقة على طلبك، وصار عندك حساب في متجر {{storeName}}.",
  "",
  "👤 اسم المستخدم: {{username}}",
  "🔑 الرمز: {{code}}",
  "",
  "🔗 ادخل من هنا:",
  "{{link}}",
  "",
  "احتفظ بهذه الرسالة، ولا تشاركها مع أحد.",
].join("\n");

/**
 * The message a newly approved customer receives.
 *
 * Since signing in is required, an approval that carried only a link left the
 * customer at a login screen with no code — so the credentials are issued and
 * delivered in this same message. The code is committed only after the send
 * succeeds, otherwise a failed WhatsApp would leave them holding a code that
 * was never delivered.
 */
export async function notifyCatalogAccessApproved(
  customerName: string,
  customerPhone: string,
  urlPath: string,
  _allowPrices: boolean,
  customerId?: string,
  // بند ٧ — كوبون أول طلب، لو صدر بنجاح. null يعني ما صدر (فشل أو زبون
  // موجود مسبقاً) — الرسالة تبقى تنرسل بلا سطر الكوبون، ما توقف الإرسال.
  coupon?: { code: string; value: unknown; expiresAt: Date | null } | null,
) {
  const settings = await getSettings().catch(() => null);
  const url = catalogUrl(settings, urlPath);
  // catalogPublicUrl no longer falls back to another tenant's storefront, so it
  // can legitimately be blank. Sending the approval text followed by nothing is
  // worse than sending no link at all — confirm the approval and make the
  // missing configuration visible to the merchant instead.
  if (!url) {
    logger.warn(
      "[catalog] catalogPublicUrl is not configured - approval message sent without a link."
    );
    await safeSendWATemplated(
      customerPhone,
      "لقد تم الموافقة على طلبك. تواصل معنا للحصول على رابط الكتلوك.",
      undefined,
      [],
    );
    return;
  }

  let issued: Awaited<ReturnType<typeof prepareCustomerCode>> | null = null;
  if (customerId) {
    issued = await prepareCustomerCode(customerId).catch((err) => {
      logger.warn(`[catalog] could not prepare a login code: ${String(err)}`);
      return null;
    });
  }

  // بند ٤ — جملة توصيل واحدة حسب محافظة الزبون، لو معروفة. Best-effort: عدم
  // معرفتها لا يمنع إرسال رمز الدخول.
  const province = customerId
    ? await prisma.customer.findUnique({ where: { id: customerId }, select: { province: true } })
        .then((c) => c?.province ?? null)
        .catch(() => null)
    : null;
  const deliveryLine = buildDeliveryLine(province, settings);

  const template = settings?.catalogAccessApprovedTemplate?.trim()
    || (issued ? DEFAULT_ACCESS_APPROVED_TEMPLATE : "لقد تم الموافقه على طلبك يمكنك الدخول عبر الرابط\n{{link}}");

  let message = template
    .replaceAll("{{customerName}}", customerName || "زبوننا العزيز")
    .replaceAll("{{storeName}}", settings?.storeName || "متجرنا")
    .replaceAll("{{username}}", issued?.phone ?? customerPhone)
    .replaceAll("{{code}}", issued?.code ?? "")
    .replaceAll("{{link}}", url);

  if (deliveryLine) {
    message = message.includes("{{delivery}}")
      ? message.replaceAll("{{delivery}}", deliveryLine)
      : `${message}\n\n🚚 ${deliveryLine}`;
  } else {
    message = message.replaceAll("{{delivery}}", "");
  }

  // بند ٧ — نفس الرسالة تحمل الكوبون، ما نزيد رسالة منفصلة.
  const couponLine = coupon
    ? `🎁 كود خصمك أول طلب: ${coupon.code} (${Number(coupon.value)}%)` +
      (coupon.expiresAt ? ` — صالح لحد ${coupon.expiresAt.toLocaleDateString("ar-IQ")}` : "")
    : null;
  if (couponLine) {
    message = message.includes("{{coupon}}")
      ? message.replaceAll("{{coupon}}", couponLine)
      : `${message}\n\n${couponLine}`;
  } else {
    message = message.replaceAll("{{coupon}}", "");
  }

  // When a Meta template name is set, Cloud API sends the TEMPLATE and drops
  // the text we just composed. The original catalogAccessApproved template only
  // carries the link, so using it for a code-bearing approval would land the
  // customer on a login screen with no code. Prefer the v2 template (name,
  // store, username, code, link) whenever a code was issued, and only fall
  // back to the link-only template when there is no code to deliver.
  const approvedTemplateName = issued
    ? settings?.catalogAccessApprovedV2TemplateName
    : settings?.catalogAccessApprovedTemplateName;
  const approvedParams = issued
    ? [
        customerName || "زبوننا العزيز",
        settings?.storeName || "متجرنا",
        issued.phone,
        issued.code,
        url,
      ]
    : [url];

  await safeSendWATemplated(customerPhone, message, approvedTemplateName, approvedParams);

  // Only now is the code real for the customer.
  if (issued) {
    await commitAccessCode(issued).catch((err) =>
      logger.warn(`[catalog] could not store the login code: ${String(err)}`),
    );
  }
}

export async function notifyCatalogOrderSubmitted(
  customerName: string,
  customerPhone: string,
  items: PreparationItem[],
) {
  const settings = await getSettings().catch(() => null);
  const admin = adminPhone(settings);

  await safeSendWATemplated(customerPhone, "تم تثبيت الفاتورة وفي انتضار الموافقه والتجهيز", settings?.orderSubmittedTemplateName);

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
  await safeSendInvoicePdfTemplated(customerPhone, message, invoiceId, invoiceNumber);
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
