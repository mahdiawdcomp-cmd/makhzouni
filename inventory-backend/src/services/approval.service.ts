import { ApprovalStatus, Prisma } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { amountInPieces } from "../utils/financial";
import {
  applyCustomerAutoTags,
  createCustomer,
  softDeleteCustomer,
  updateCustomer,
} from "./customer.service";
import {
  cancelInvoice,
  createInvoice,
  updateInvoice,
} from "./invoice.service";
import { createUser, deactivateUser, updateUser } from "./user.service";
import { executeTransferWithin } from "./transfer.service";
import { cancelVoucher, createVoucher, deleteVoucher, restoreVoucher, updateVoucher } from "./voucher.service";
import { hardDeleteInvoice } from "./invoice.service";
import { sendWhatsAppText } from "./whatsapp.service";
import {
  createProduct,
  deleteProduct,
  updateProduct,
} from "./product.service";
import {
  createOrderPreparation,
  notifyCatalogAccessApproved,
  notifyPreparationStaffPending,
} from "./order-preparation.service";
import { getSettings } from "./settings.service";
import { issueFirstOrderCoupon } from "./first-order-coupon.service";
import { notifyAdmin, buildDedupeKey } from "./app-notification.service";
import {
  NotificationType,
  NotificationCategory,
  NotificationSeverity,
} from "../constants/notifications";

type Db = Prisma.TransactionClient;

function hashCatalogToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function makeCatalogToken() {
  return `cat_${randomBytes(32).toString("base64url")}`;
}

async function createCatalogAccessLink(tx: Db, customerId: string, allowPrices: boolean, showStock = true) {
  await tx.$executeRaw`
    UPDATE "catalog_access_links"
    SET "revoked_at" = NOW()
    WHERE "customer_id" = ${customerId}::uuid AND "revoked_at" IS NULL
  `;

  const token = makeCatalogToken();
  const tokenHash = hashCatalogToken(token);

  await tx.$executeRaw`
    INSERT INTO "catalog_access_links" ("token", "token_hash", "customer_id", "allow_prices", "show_stock")
    VALUES (${token}, ${tokenHash}, ${customerId}::uuid, ${allowPrices}, ${showStock})
  `;

  return {
    token,
    urlPath: `/catalog?access=${token}`,
    allowPrices,
    showStock,
  };
}

export const approvalRequestTypes = {
  CATALOG_ACCESS: "CATALOG_ACCESS",
  CATALOG_ORDER: "CATALOG_ORDER",
  CREATE_USER: "CREATE_USER",
  UPDATE_USER: "UPDATE_USER",
  DEACTIVATE_USER: "DEACTIVATE_USER",
  CREATE_CUSTOMER: "CREATE_CUSTOMER",
  UPDATE_CUSTOMER: "UPDATE_CUSTOMER",
  DELETE_CUSTOMER: "DELETE_CUSTOMER",
  CREATE_PRODUCT: "CREATE_PRODUCT",
  UPDATE_PRODUCT: "UPDATE_PRODUCT",
  DELETE_PRODUCT: "DELETE_PRODUCT",
  CREATE_INVOICE: "CREATE_INVOICE",
  UPDATE_INVOICE: "UPDATE_INVOICE",
  CANCEL_INVOICE: "CANCEL_INVOICE",
  HARD_DELETE_INVOICE: "HARD_DELETE_INVOICE",
  CREATE_VOUCHER: "CREATE_VOUCHER",
  UPDATE_VOUCHER: "UPDATE_VOUCHER",
  CANCEL_VOUCHER: "CANCEL_VOUCHER",
  RESTORE_VOUCHER: "RESTORE_VOUCHER",
  DELETE_VOUCHER: "DELETE_VOUCHER",
  CREATE_TRANSFER: "CREATE_TRANSFER",
  NEGATIVE_STOCK_SALE: "NEGATIVE_STOCK_SALE",
  // «اطلب سعراً خاصاً» — the rep cannot discount, so they ask through the same
  // approvals screen everything else uses.
  AGENT_PRICE_REQUEST: "AGENT_PRICE_REQUEST",
  // «جرد الزبون» — the customer counted what reached them and it differs from
  // the invoice. Unlike the worker's count (applied on submit), nothing moves
  // until the owner approves this.
  INVOICE_COUNT_ADJUSTMENT: "INVOICE_COUNT_ADJUSTMENT",
} as const;

export type ApprovalRequestType =
  (typeof approvalRequestTypes)[keyof typeof approvalRequestTypes];

const deleteApprovalTypes = new Set([
  "CANCEL_INVOICE",
  "HARD_DELETE_INVOICE",
  "CANCEL_VOUCHER",
  "DELETE_VOUCHER",
]);

const approvalTypeLabels: Record<string, string> = {
  CANCEL_INVOICE: "تعطيل فاتورة",
  HARD_DELETE_INVOICE: "حذف فاتورة نهائياً",
  CANCEL_VOUCHER: "تعطيل سند",
  RESTORE_VOUCHER: "استرجاع سند",
  DELETE_VOUCHER: "حذف سند نهائياً",
  CREATE_INVOICE: "إنشاء فاتورة",
  UPDATE_INVOICE: "تعديل فاتورة",
  CREATE_VOUCHER: "إنشاء سند",
  UPDATE_VOUCHER: "تعديل سند",
  CREATE_PRODUCT: "إضافة مادة",
  UPDATE_PRODUCT: "تعديل مادة",
  DELETE_PRODUCT: "حذف مادة",
  CREATE_CUSTOMER: "إضافة زبون",
  UPDATE_CUSTOMER: "تعديل زبون",
  DELETE_CUSTOMER: "حذف زبون",
  CREATE_USER: "إضافة مستخدم",
  UPDATE_USER: "تعديل مستخدم",
  DEACTIVATE_USER: "تعطيل مستخدم",
  CATALOG_ACCESS: "طلب دخول كتالوج",
  CATALOG_ORDER: "طلب كتالوج",
  CREATE_TRANSFER: "تحويل بين المخازن",
  INVOICE_COUNT_ADJUSTMENT: "جرد الزبون لفاتورة",
  NEGATIVE_STOCK_SALE: "بيع بضاعة سالبة (عجز مخزون)",
  AGENT_PRICE_REQUEST: "طلب سعر خاص من مندوب",
};

// ── Human-readable display for the approvals page ──────────────────────────
// requestData only stores raw ids (e.g. {params:{id:"<uuid>"}}), which used to
// surface as raw JSON in the UI. Enrich each approval at list time with an
// Arabic summary + labelled details resolved from the referenced records.
type ApprovalDisplay = {
  summary: string;
  details: Array<{ label: string; value: string }>;
};

const fmtMoney = (v: unknown) => Number(v ?? 0).toLocaleString("en-US");

async function buildApprovalDisplay(
  requestType: string,
  requestData: unknown
): Promise<ApprovalDisplay | undefined> {
  const data = (requestData && typeof requestData === "object" ? requestData : {}) as Record<string, unknown>;
  const params = (data.params && typeof data.params === "object" ? data.params : {}) as Record<string, unknown>;
  const body = (data.body && typeof data.body === "object" ? data.body : {}) as Record<string, unknown>;
  const refId = typeof params.id === "string" ? params.id : undefined;

  try {
    switch (requestType) {
      case approvalRequestTypes.CANCEL_INVOICE:
      case approvalRequestTypes.HARD_DELETE_INVOICE:
      case approvalRequestTypes.UPDATE_INVOICE: {
        if (!refId) return undefined;
        const inv = await prisma.invoice.findUnique({
          where: { id: refId },
          select: {
            invoiceNumber: true, type: true, date: true, totalAmount: true,
            paidAmount: true, remainingAmount: true, status: true,
            customer: { select: { name: true, phone: true } },
          },
        });
        if (!inv) return { summary: "⚠️ الفاتورة غير موجودة (ربما حُذفت مسبقاً)", details: [] };
        const details = [
          { label: "رقم الفاتورة", value: inv.invoiceNumber },
          { label: "النوع", value: inv.type === "PURCHASE" ? "شراء" : inv.type === "SALES_RETURN" ? "مرتجع بيع" : "بيع" },
          { label: inv.type === "PURCHASE" ? "المورّد" : "الزبون", value: inv.customer?.name ?? "—" },
          { label: "التاريخ", value: new Date(inv.date).toLocaleDateString("en-GB") },
          { label: "الإجمالي", value: fmtMoney(inv.totalAmount) },
          { label: "المدفوع", value: fmtMoney(inv.paidAmount) },
          { label: "الباقي", value: fmtMoney(inv.remainingAmount) },
          { label: "الحالة", value: inv.status === "ACTIVE" ? "نشطة" : "ملغاة" },
        ];
        if (typeof data.reason === "string" && data.reason) details.push({ label: "سبب الطلب", value: data.reason });
        if (typeof data.returnWarehouseId === "string" && data.returnWarehouseId) {
          const wh = await prisma.branch.findUnique({ where: { id: data.returnWarehouseId }, select: { name: true } });
          if (wh) details.push({ label: "مخزن إرجاع البضاعة", value: wh.name });
        }
        return {
          summary: `فاتورة ${inv.invoiceNumber} — ${inv.customer?.name ?? "—"} — ${fmtMoney(inv.totalAmount)}`,
          details,
        };
      }
      case approvalRequestTypes.CREATE_INVOICE: {
        const customerId = typeof body.customerId === "string" ? body.customerId : undefined;
        const customer = customerId
          ? await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } })
          : null;
        const items = Array.isArray(body.items) ? body.items : [];
        return {
          summary: `${customer?.name ?? "زبون"} — ${items.length} مادة`,
          details: [
            { label: "الزبون", value: customer?.name ?? "—" },
            { label: "عدد المواد", value: String(items.length) },
            { label: "المدفوع", value: fmtMoney(body.paidAmount) },
          ],
        };
      }
      case approvalRequestTypes.CANCEL_VOUCHER:
      case approvalRequestTypes.RESTORE_VOUCHER:
      case approvalRequestTypes.DELETE_VOUCHER:
      case approvalRequestTypes.UPDATE_VOUCHER: {
        if (!refId) return undefined;
        const v = await prisma.paymentVoucher.findUnique({
          where: { id: refId },
          select: {
            voucherNumber: true, amount: true, type: true, date: true, description: true,
            customer: { select: { name: true } },
          },
        });
        if (!v) return { summary: "⚠️ السند غير موجود (ربما حُذف مسبقاً)", details: [] };
        const typeAr = v.type === "RECEIPT" ? "قبض" : v.type === "PAYMENT" ? "دفع" : "مصاريف";
        const details = [
          { label: "رقم السند", value: v.voucherNumber },
          { label: "النوع", value: typeAr },
          { label: "الجهة", value: v.customer?.name ?? v.description ?? "—" },
          { label: "المبلغ", value: fmtMoney(v.amount) },
          { label: "التاريخ", value: new Date(v.date).toLocaleDateString("en-GB") },
        ];
        if (typeof data.reason === "string" && data.reason) details.push({ label: "سبب الطلب", value: data.reason });
        return {
          summary: `سند ${typeAr} ${v.voucherNumber} — ${v.customer?.name ?? v.description ?? "—"} — ${fmtMoney(v.amount)}`,
          details,
        };
      }
      case approvalRequestTypes.CREATE_VOUCHER: {
        const customerId = typeof body.customerId === "string" ? body.customerId : undefined;
        const customer = customerId
          ? await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } })
          : null;
        const typeAr = body.type === "RECEIPT" ? "قبض" : body.type === "PAYMENT" ? "دفع" : "مصاريف";
        return {
          summary: `سند ${typeAr} — ${customer?.name ?? String(body.description ?? "—")} — ${fmtMoney(body.amount)}`,
          details: [
            { label: "النوع", value: typeAr },
            { label: "الجهة", value: customer?.name ?? String(body.description ?? "—") },
            { label: "المبلغ", value: fmtMoney(body.amount) },
          ],
        };
      }
      case approvalRequestTypes.UPDATE_PRODUCT:
      case approvalRequestTypes.DELETE_PRODUCT: {
        if (!refId) return undefined;
        const p = await prisma.product.findUnique({
          where: { id: refId },
          select: { name: true, itemNumber: true },
        });
        if (!p) return { summary: "⚠️ المادة غير موجودة (ربما حُذفت مسبقاً)", details: [] };
        return {
          summary: `${p.name} (${p.itemNumber})`,
          details: [
            { label: "المادة", value: p.name },
            { label: "رقم الصنف", value: p.itemNumber },
          ],
        };
      }
      case approvalRequestTypes.CREATE_PRODUCT:
        return typeof body.name === "string"
          ? { summary: String(body.name), details: [{ label: "المادة", value: String(body.name) }] }
          : undefined;
      case approvalRequestTypes.UPDATE_CUSTOMER:
      case approvalRequestTypes.DELETE_CUSTOMER: {
        if (!refId) return undefined;
        const c = await prisma.customer.findUnique({
          where: { id: refId },
          select: { name: true, phone: true, currentBalance: true },
        });
        if (!c) return { summary: "⚠️ الزبون غير موجود (ربما حُذف مسبقاً)", details: [] };
        return {
          summary: `${c.name} — ${c.phone}`,
          details: [
            { label: "الزبون", value: c.name },
            { label: "الهاتف", value: c.phone },
            { label: "الرصيد الحالي", value: fmtMoney(c.currentBalance) },
          ],
        };
      }
      case approvalRequestTypes.CREATE_CUSTOMER:
        return typeof body.name === "string"
          ? {
              summary: `${String(body.name)} — ${String(body.phone ?? "")}`,
              details: [
                { label: "الزبون", value: String(body.name) },
                { label: "الهاتف", value: String(body.phone ?? "—") },
              ],
            }
          : undefined;
      case approvalRequestTypes.UPDATE_USER:
      case approvalRequestTypes.DEACTIVATE_USER: {
        if (!refId) return undefined;
        const u = await prisma.user.findUnique({
          where: { id: refId },
          select: { name: true, username: true, role: true },
        });
        if (!u) return { summary: "⚠️ المستخدم غير موجود", details: [] };
        return {
          summary: `${u.name} (${u.username})`,
          details: [
            { label: "المستخدم", value: u.name },
            { label: "اسم الدخول", value: u.username },
            { label: "الدور", value: u.role },
          ],
        };
      }
      case approvalRequestTypes.CREATE_USER:
        return typeof body.name === "string"
          ? { summary: String(body.name), details: [{ label: "المستخدم", value: String(body.name) }] }
          : undefined;
      case approvalRequestTypes.INVOICE_COUNT_ADJUSTMENT: {
        // The owner has to see WHAT the customer counted before saying yes, not
        // just that a count happened — so the differing lines are spelled out.
        const linkId = typeof data.linkId === "string" ? data.linkId : undefined;
        if (!linkId) return undefined;
        const link = await prisma.invoiceCountLink.findUnique({
          where: { id: linkId },
          select: {
            recipientName: true, submittedAt: true, result: true,
            invoice: { select: { invoiceNumber: true, totalAmount: true, customer: { select: { name: true } } } },
          },
        });
        if (!link) return { summary: "⚠️ سجل الجرد غير موجود", details: [] };
        const result = link.result as { lines?: Array<Record<string, unknown>> } | null;
        const changed = (result?.lines ?? []).filter((l) => Number(l.differencePieces ?? 0) !== 0);
        const details = [
          { label: "الفاتورة", value: link.invoice?.invoiceNumber ?? "—" },
          { label: "الزبون", value: link.invoice?.customer?.name ?? link.recipientName },
          { label: "مجموع الفاتورة الآن", value: `${fmtMoney(link.invoice?.totalAmount)} د.ع` },
          { label: "أصناف مختلفة", value: `${changed.length}` },
          ...changed.slice(0, 12).map((l) => {
            const diff = Number(l.differencePieces ?? 0);
            const word = diff > 0 ? `زيادة ${diff}` : `نقص ${-diff}`;
            return {
              label: String(l.productName ?? "صنف"),
              value: `أُرسل ${Number(l.expectedPieces ?? 0)} — وصل ${Number(l.receivedPieces ?? 0)} (${word})`,
            };
          }),
        ];
        if (changed.length > 12) {
          details.push({ label: "…", value: `و${changed.length - 12} صنفاً آخر` });
        }
        return {
          summary: `${link.recipientName} جرد فاتورة ${link.invoice?.invoiceNumber ?? ""} — ${changed.length} صنف مختلف`,
          details,
        };
      }
      default:
        return undefined;
    }
  } catch {
    // Display enrichment must never break the approvals list.
    return undefined;
  }
}

/**
 * For a catalog order, whether the phone belongs to someone the shop already
 * has on its books — the first thing the merchant needs to know before
 * deciding what to do with the order, and something the stored snapshot
 * cannot answer because the answer changes after the order was placed.
 *
 * One query for every phone on the page, not one per row.
 */
async function attachOrderers<T extends { requestType: string; requestData: unknown }>(
  approvals: T[]
): Promise<Array<T & { orderer?: { known: boolean; customerId: string | null; customerName: string | null; balance: number | null; pastOrders: number } }>> {
  const { normalizePhone } = await import("../utils/phone");
  const phoneOf = (a: T) => {
    if (a.requestType !== approvalRequestTypes.CATALOG_ORDER) return null;
    const d = (a.requestData ?? {}) as { phone?: unknown };
    const raw = String(d.phone ?? "").trim();
    return raw ? normalizePhone(raw) : null;
  };

  const phones = [...new Set(approvals.map(phoneOf).filter(Boolean) as string[])];
  if (phones.length === 0) return approvals;

  const customers = await prisma.customer.findMany({
    where: { phone: { in: phones }, deletedAt: null },
    select: { id: true, name: true, phone: true, currentBalance: true },
  });
  const byPhone = new Map(customers.map((c) => [c.phone, c]));

  const counts = customers.length
    ? await prisma.invoice.groupBy({
        by: ["customerId"],
        where: { customerId: { in: customers.map((c) => c.id) }, type: "SALE" },
        _count: { customerId: true },
      })
    : [];
  const countById = new Map(counts.map((c) => [c.customerId, c._count.customerId]));

  return approvals.map((a) => {
    const phone = phoneOf(a);
    if (!phone) return a;
    const c = byPhone.get(phone);
    return {
      ...a,
      orderer: {
        known: Boolean(c),
        customerId: c?.id ?? null,
        customerName: c?.name ?? null,
        balance: c ? Number(c.currentBalance) : null,
        pastOrders: c ? countById.get(c.id) ?? 0 : 0,
      },
    };
  });
}

async function attachDisplays<T extends { requestType: string; requestData: unknown }>(
  approvals: T[]
) {
  const withDisplay = await Promise.all(
    approvals.map(async (a) => ({
      ...a,
      display: await buildApprovalDisplay(a.requestType, a.requestData),
    }))
  );
  return attachOrderers(withDisplay);
}

export async function createPendingApproval(
  requestType: ApprovalRequestType,
  requestData: Record<string, unknown>,
  requestedBy: string,
  requesterName?: string,
  /**
   * Idempotency key. Unique in the database, so two taps that arrive together
   * cannot both insert — the second one fails with P2002 and the caller hands
   * back the first request's approval instead of creating a twin.
   */
  clientRequestId?: string
) {
  const approval = await prisma.pendingApproval.create({
    data: {
      requestType,
      requestData: requestData as Prisma.InputJsonValue,
      requestedBy,
      clientRequestId: clientRequestId ?? null,
    },
  });

  // In-app IMPORTANT notification for the manager (does not change approval logic).
  const actionLabelForNotif = approvalTypeLabels[requestType] ?? requestType;
  await notifyAdmin({
    type: NotificationType.APPROVAL_PENDING,
    category: NotificationCategory.APPROVALS,
    severity: NotificationSeverity.IMPORTANT,
    title: "موافقة مطلوبة",
    message: `طلب «${actionLabelForNotif}» من ${requesterName ?? "موظف"} ينتظر موافقتك`,
    entityType: "APPROVAL",
    entityId: approval.id,
    actionUrl: "/approvals",
    metadata: {
      approvalId: approval.id,
      approvalType: requestType,
      requestedBy,
    },
    dedupeKey: buildDedupeKey(NotificationType.APPROVAL_PENDING, approval.id),
  }).catch(() => {});

  // Send WhatsApp notification to the manager for destructive operations.
  if (deleteApprovalTypes.has(requestType)) {
    const actionLabel = approvalTypeLabels[requestType] ?? requestType;
    const staffName = requesterName ?? "موظف";
    const params = (requestData?.params ?? {}) as Record<string, unknown>;
    const recordRef = params.id ? `\nالسجل: ${String(params.id)}` : "";
    const reason = typeof (requestData as Record<string, unknown>)?.reason === "string"
      ? `\nالسبب: ${(requestData as Record<string, unknown>).reason}`
      : "";
    const when = new Date().toLocaleString("en-GB");
    const message =
      `⚠️ طلب موافقة جديد\n` +
      `الموظف: ${staffName}\n` +
      `العملية: ${actionLabel}${recordRef}${reason}\n` +
      `الوقت: ${when}\n\n` +
      `راجع وأقرّ العملية من صفحة (الطلبات المعلّقة) في التطبيق.`;
    getSettings()
      .then((settings) => {
        // Dedicated approvals number, falling back to the store phone.
        const target = settings?.adminApprovalWhatsappNumber?.trim() || settings?.storePhone?.trim();
        if (target) {
          sendWhatsAppText(target, message).catch(() => {});
        }
      })
      .catch(() => {});
  }

  return approval;
}

export async function listPendingApprovals() {
  const rows = await prisma.pendingApproval.findMany({
    where: { status: ApprovalStatus.PENDING },
    include: {
      requester: {
        select: { id: true, name: true, username: true, role: true },
      },
      reviewer: {
        select: { id: true, name: true, username: true, role: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return attachDisplays(rows);
}

export async function listMyApprovals(userId: string) {
  const rows = await prisma.pendingApproval.findMany({
    where: { requestedBy: userId },
    include: {
      requester: {
        select: { id: true, name: true, username: true, role: true },
      },
      reviewer: {
        select: { id: true, name: true, username: true, role: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return attachDisplays(rows);
}

async function executeApprovedRequest(
  requestType: string,
  requestData: unknown,
  reviewerId: string,
  tx: Db,
  options?: { allowPrices?: boolean; showStock?: boolean },
  // The approval's own id. Only AGENT_PRICE_REQUEST needs it — the row it has
  // to flip is joined to the approval, not carried inside requestData.
  approvalId?: string
) {
  const data = requestData as Record<string, unknown>;

  switch (requestType) {
    case approvalRequestTypes.CREATE_USER:
      return createUser(data.body as Parameters<typeof createUser>[0], tx);
    case approvalRequestTypes.CATALOG_ACCESS: {
      const body = data.body as {
        customerName?: string;
        phone?: string;
        address?: string;
        notes?: string;
        // بند ٤ — لا يملأهما نموذج الطلب الحالي، لكن محادثة الواتساب (بند ٥)
        // ستملأهما لاحقاً؛ التاكات التلقائية تُطبَّق فوراً لو وصلا.
        province?: string;
        businessType?: string;
      };
      const phone = String(body.phone ?? "").trim();
      const customerName = String(body.customerName ?? "").trim();
      if (!phone || !customerName) {
        throw new AppError("Catalog access is missing required data", 400, "CATALOG_ACCESS_INVALID");
      }

      const existingCustomer = await tx.customer.findUnique({ where: { phone } });

      // A catalog-access request from someone who is NOT already a customer no
      // longer manufactures one. Browsing is not something the shop approves —
      // prices are. So an unknown phone becomes a visitor with its prices
      // unlocked, and joins the shop's books only when someone presses «احفظ
      // كزبون بالمحل» or approves its first order. This is the same rule the
      // storefront login follows; leaving this path creating customers was the
      // last place the two disagreed.
      if (!existingCustomer) {
        await tx.catalogVisitor.upsert({
          where: { phone },
          update: {
            name: customerName,
            address: body.address,
            notes: body.notes,
            ...(body.province ? { province: body.province } : {}),
            ...(body.businessType ? { businessType: body.businessType } : {}),
            detailsSubmittedAt: new Date(),
            pricesUnlockedAt: new Date(),
            priceRequestedAt: null,
          },
          create: {
            phone,
            name: customerName,
            address: body.address,
            notes: body.notes,
            ...(body.province ? { province: body.province } : {}),
            ...(body.businessType ? { businessType: body.businessType } : {}),
            detailsSubmittedAt: new Date(),
            pricesUnlockedAt: new Date(),
          },
        });

        // Send their credentials so the approval actually lets them in.
        setImmediate(async () => {
          try {
            const { prepareVisitorCode } = await import("./customer-login.service");
            const { sendStorefrontCredentials } = await import("./storefront-credentials.service");
            await sendStorefrontCredentials(await prepareVisitorCode(phone));
          } catch (err) {
            console.error("[CatalogAccess] visitor credentials send failed:", err);
          }
        });

        return { visitorPhone: phone };
      }

      const customer = existingCustomer
        ? await tx.customer.update({
            where: { id: existingCustomer.id },
            data: {
              name: customerName,
              address: body.address,
              notes: body.notes,
              deletedAt: null,
              ...(body.province ? { province: body.province } : {}),
              ...(body.businessType ? { businessType: body.businessType } : {}),
            },
          })
        : await tx.customer.create({
            data: {
              name: customerName,
              phone,
              address: body.address,
              notes: body.notes,
              openingBalance: 0,
              currentBalance: 0,
              province: body.province,
              businessType: body.businessType,
            },
          });

      await applyCustomerAutoTags(tx, customer.id, body.province, body.businessType);

      // بند ٥ — this phone just graduated from "prospect running the WhatsApp
      // registration bot" to "real customer". Clear any leftover conversation
      // row so it can never be read again — nothing else does, since the
      // routing gate that reads it is `!customer` and this phone is now one.
      await tx.whatsappBotChat.deleteMany({ where: { phone: customer.phone } });

      const link = await createCatalogAccessLink(tx, customer.id, Boolean(options?.allowPrices), options?.showStock ?? true);
      // بند ٧ — only a genuinely brand-new customer gets a welcome coupon; a
      // re-approval of an already-existing phone (e.g. after a soft-delete
      // restore through this same flow) must never mint a second one.
      const isNewCustomer = !existingCustomer;
      setImmediate(async () => {
        const coupon = isNewCustomer
          ? await issueFirstOrderCoupon(customer.id, customer.name).catch(() => null)
          : null;
        await notifyCatalogAccessApproved(
          customer.name,
          customer.phone,
          link.urlPath,
          link.allowPrices,
          // Lets the approval message carry their login code, not just a link.
          customer.id,
          coupon,
        ).catch((err) => console.error("[CatalogAccess] approval notify failed:", err));
      });
      return link;
    }
    case approvalRequestTypes.CATALOG_ORDER: {
      const body = data.body as {
        customerName?: string;
        phone?: string;
        address?: string;
        province?: string;
        notes?: string;
        warehouseId?: string;
        items?: Parameters<typeof createInvoice>[0]["items"];
        couponCode?: string;
        discount?: number;
        salesAgentId?: string;
      };
      const phone = String(body.phone ?? "").trim();
      const customerName = String(body.customerName ?? "").trim();
      if (!phone || !customerName || !Array.isArray(body.items) || body.items.length === 0) {
        throw new AppError("Catalog order is missing required data", 400, "CATALOG_ORDER_INVALID");
      }

      // displayItems from the approval snapshot (includes productId + productName)
      const displayItems = (data.displayItems ?? []) as Array<{
        productId: string;
        productName?: string;
        unit: string;
        quantity: number;
        unitPrice?: number;
        totalPrice?: number;
      }>;

      const prepItems = displayItems.length > 0
        ? displayItems
        : (body.items ?? []).map((it) => ({
            productId: it.productId ?? "",
            productName: String(it.productId ?? ""),
            unit: it.unit,
            quantity: it.quantity,
            unitPrice: undefined,
            totalPrice: undefined,
          }));

      // «عند أول طلب» — approving an order is the merchant saying this person
      // is real, and an invoice has to belong to a Customer anyway. Runs
      // outside the transaction and never blocks the approval: a visitor row
      // that fails to promote leaves the order untouched and can still be
      // promoted by hand from the storefront accounts screen.
      setImmediate(async () => {
        try {
          const { promoteVisitorToCustomer } = await import("./catalog-visitor.service");
          await promoteVisitorToCustomer(phone);
        } catch {
          /* not a visitor, or already a customer — nothing to do */
        }
      });

      // Create preparation record without invoice — invoice created when staff marks prepared
      const prep = await tx.orderPreparation.create({
        data: {
          customerName,
          customerPhone: phone,
          items: prepItems as unknown as import("@prisma/client").Prisma.InputJsonValue,
          orderData: {
            customerName,
            phone,
            address: body.address,
            province: body.province,
            warehouseId: body.warehouseId,
            items: body.items,
            // The order's earned tier discount, computed from server-side
            // prices when the order was placed. Hardcoding 0 here quietly
            // dropped it before it ever reached the invoice.
            discount: Math.max(0, Number(body.discount) || 0),
            tax: 0,
            paidAmount: 0,
            paymentType: "CREDIT",
            couponCode: body.couponCode,
            // «المندوب» — present only on orders a rep took. markPrepared reads
            // it back to credit the sale to them; absent on shopper orders,
            // which is why it is optional the whole way down.
            salesAgentId: body.salesAgentId,
          } as unknown as import("@prisma/client").Prisma.InputJsonValue,
          status: "PENDING",
          source: (data.source as string | undefined) ?? null,
        },
      });

      // Fire-and-forget: notify preparation staff (text only, no invoice yet)
      setImmediate(async () => {
        try {
          await notifyPreparationStaffPending(
            customerName,
            phone,
            prepItems.map((item) => ({
              productId: item.productId ?? "",
              productName: item.productName ?? item.productId ?? "",
              unit: item.unit,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
            })),
          );
        } catch (err) {
          console.error("[CatalogOrder] staff notify failed:", err);
        }
      });

      return prep;
    }
    case approvalRequestTypes.UPDATE_USER:
      return updateUser(
        data.params && typeof data.params === "object"
          ? String((data.params as Record<string, unknown>).id)
          : "",
        data.body as Parameters<typeof updateUser>[1],
        tx
      );
    case approvalRequestTypes.DEACTIVATE_USER:
      return deactivateUser(
        data.params && typeof data.params === "object"
          ? String((data.params as Record<string, unknown>).id)
          : "",
        reviewerId,
        tx
      );
    case approvalRequestTypes.CREATE_CUSTOMER:
      return createCustomer(data.body as Parameters<typeof createCustomer>[0], tx);
    case approvalRequestTypes.UPDATE_CUSTOMER:
      return updateCustomer(
        data.params && typeof data.params === "object"
          ? String((data.params as Record<string, unknown>).id)
          : "",
        data.body as Parameters<typeof updateCustomer>[1],
        tx
      );
    case approvalRequestTypes.DELETE_CUSTOMER:
      return softDeleteCustomer(
        data.params && typeof data.params === "object"
          ? String((data.params as Record<string, unknown>).id)
          : "",
        tx
      );
    case approvalRequestTypes.CREATE_PRODUCT:
      return createProduct(
        data.body as Parameters<typeof createProduct>[0],
        reviewerId,
        tx
      );
    case approvalRequestTypes.UPDATE_PRODUCT:
      return updateProduct(
        data.params && typeof data.params === "object"
          ? String((data.params as Record<string, unknown>).id)
          : "",
        data.body as Parameters<typeof updateProduct>[1],
        tx
      );
    case approvalRequestTypes.DELETE_PRODUCT:
      return deleteProduct(
        data.params && typeof data.params === "object"
          ? String((data.params as Record<string, unknown>).id)
          : "",
        tx
      );
    case approvalRequestTypes.CREATE_INVOICE:
      return createInvoice(
        data.body as Parameters<typeof createInvoice>[0],
        reviewerId,
        tx
      );
    case approvalRequestTypes.UPDATE_INVOICE:
      return updateInvoice(
        data.params && typeof data.params === "object"
          ? String((data.params as Record<string, unknown>).id)
          : "",
        data.body as Parameters<typeof updateInvoice>[1],
        reviewerId,
        tx
      );
    case approvalRequestTypes.CANCEL_INVOICE:
      return cancelInvoice(
        data.params && typeof data.params === "object"
          ? String((data.params as Record<string, unknown>).id)
          : "",
        tx,
        typeof data.returnWarehouseId === "string" ? data.returnWarehouseId : undefined
      );
    case approvalRequestTypes.HARD_DELETE_INVOICE:
      return hardDeleteInvoice(
        data.params && typeof data.params === "object"
          ? String((data.params as Record<string, unknown>).id)
          : "",
        reviewerId,
        typeof data.reason === "string" ? data.reason : undefined,
        typeof data.returnWarehouseId === "string" ? data.returnWarehouseId : undefined,
        tx
      );
    case approvalRequestTypes.CREATE_VOUCHER:
      return createVoucher(
        data.body as Parameters<typeof createVoucher>[0],
        reviewerId,
        tx
      );
    case approvalRequestTypes.UPDATE_VOUCHER:
      return updateVoucher(
        data.params && typeof data.params === "object"
          ? String((data.params as Record<string, unknown>).id)
          : "",
        data.body as Parameters<typeof updateVoucher>[1],
        tx
      );
    case approvalRequestTypes.CANCEL_VOUCHER:
      return cancelVoucher(
        data.params && typeof data.params === "object"
          ? String((data.params as Record<string, unknown>).id)
          : "",
        tx
      );
    case approvalRequestTypes.RESTORE_VOUCHER:
      return restoreVoucher(
        data.params && typeof data.params === "object"
          ? String((data.params as Record<string, unknown>).id)
          : "",
        tx
      );
    case approvalRequestTypes.DELETE_VOUCHER:
      return deleteVoucher(
        data.params && typeof data.params === "object"
          ? String((data.params as Record<string, unknown>).id)
          : "",
        tx,
        reviewerId,
        typeof data.reason === "string" ? data.reason : undefined
      );
    case approvalRequestTypes.CREATE_TRANSFER: {
      // Approved transfers always go through, even into negative stock — the
      // deficit will surface in the stocktake (per spec). But the manager
      // approved the SNAPSHOT numbers, which may be hours old — so re-check the
      // source stock at execution time and stamp any shortfall into the transfer
      // notes so it is visible on the transfer record instead of silently
      // driving the source warehouse negative.
      const body = data.body as Parameters<typeof executeTransferWithin>[1] & { notes?: string };
      const stocks = await tx.productWarehouseStock.findMany({
        where: {
          warehouseId: body.fromBranchId,
          productId: { in: body.items.map((i) => i.productId) },
        },
        select: { productId: true, quantityPieces: true },
      });
      const stockMap = new Map(stocks.map((s) => [s.productId, s.quantityPieces]));
      const products = await tx.product.findMany({
        where: { id: { in: body.items.map((i) => i.productId) } },
        select: { id: true, name: true, pcsPerCarton: true, boxPieces: true },
      });
      const productMap = new Map(products.map((p) => [p.id, p]));
      const shortfalls = body.items
        .map((i) => {
          const p = productMap.get(i.productId);
          const need = p ? amountInPieces(i.unit, i.quantity, p.pcsPerCarton, p.boxPieces) : i.quantity;
          const have = Number(stockMap.get(i.productId) ?? 0);
          return need > have ? `${p?.name ?? i.productId}: مطلوب ${need} والمتوفر الآن ${have}` : null;
        })
        .filter(Boolean);
      const execBody =
        shortfalls.length > 0
          ? {
              ...body,
              notes: [body.notes, `⚠️ نُفّذ بالموافقة والرصيد تغيّر عن وقت الطلب — ${shortfalls.join("، ")}`]
                .filter(Boolean)
                .join(" | "),
            }
          : body;
      return executeTransferWithin(tx, execBody, reviewerId, true);
    }
    case approvalRequestTypes.AGENT_PRICE_REQUEST: {
      // Flip the request to APPROVED so the rep's next order can spend it. The
      // price itself lives on the request row, not here — this approval is the
      // owner's yes, not a second copy of the number.
      await tx.salesAgentPriceRequest.updateMany({
        where: { approvalId, status: "PENDING" },
        data: { status: "APPROVED", reviewedAt: new Date() },
      });
      return { priceApproved: true };
    }
    case approvalRequestTypes.INVOICE_COUNT_ADJUSTMENT: {
      // The customer's counted quantities finally land here. The count itself
      // was frozen on the link when it was submitted, so approving days later
      // still applies exactly what the customer reported — not a re-read of an
      // invoice that may have moved since.
      const { applyCustomerCount } = await import("./invoice-count.service");
      const linkId = String(data.linkId ?? "");
      if (!linkId) throw new AppError("طلب الجرد غير مكتمل", 400, "COUNT_APPROVAL_INVALID");
      return applyCustomerCount(linkId, reviewerId, tx);
    }
    case approvalRequestTypes.NEGATIVE_STOCK_SALE:
      // Acknowledgment only: the sale already completed and stock already moved.
      // Approving simply marks the shortage as reviewed by the manager; the deficit
      // is settled automatically when stock arrives. Nothing to execute.
      return { acknowledged: true };
    default:
      throw new AppError("Unsupported approval request type", 400, "UNSUPPORTED_APPROVAL");
  }
}

export async function reviewApproval(
  approvalId: string,
  status: "APPROVED" | "REJECTED",
  reviewedBy: string,
  options?: {
    allowPrices?: boolean;
    showStock?: boolean;
    /**
     * Catalog orders only. "PREPARE" (the default, and what every approval
     * did before) sends the order to the preparation screen and bills it when
     * staff mark it ready. "INVOICE" bills it now.
     */
    catalogOrderMode?: "INVOICE" | "PREPARE";
    /**
     * Why it was rejected, in the reviewer's own words.
     *
     * A rep whose order comes back as a bare «مرفوض» has to telephone to find
     * out what to fix. Stored on the approval so the answer is written once and
     * read by whoever asks.
     */
    reviewNote?: string;
  }
) {
  const approval = await prisma.pendingApproval.findUnique({
    where: { id: approvalId },
  });

  if (!approval) {
    throw new AppError("Approval request not found", 404, "APPROVAL_NOT_FOUND");
  }

  if (approval.status !== ApprovalStatus.PENDING) {
    throw new AppError("Approval request already reviewed", 400, "APPROVAL_REVIEWED");
  }

  if (status === "REJECTED") {
    const rejected = await prisma.pendingApproval.update({
      where: { id: approvalId },
      data: {
        status: ApprovalStatus.REJECTED,
        reviewedBy,
        reviewedAt: new Date(),
        reviewNote: options?.reviewNote?.trim() || null,
      },
    });

    // A rejected price request must be closed too. Left PENDING it would block
    // the rep from ever asking about that product again — the duplicate guard
    // treats a live request as one already in flight.
    if (approval.requestType === approvalRequestTypes.AGENT_PRICE_REQUEST) {
      await prisma.salesAgentPriceRequest.updateMany({
        where: { approvalId, status: "PENDING" },
        data: { status: "REJECTED", reviewedAt: new Date() },
      });
    }

    return { approval: rejected, result: null };
  }

  const reviewed = await prisma.$transaction(async (tx) => {
    const approvalUpdate = await tx.pendingApproval.updateMany({
      where: { id: approvalId, status: ApprovalStatus.PENDING },
      data: {
        status: ApprovalStatus.APPROVED,
        reviewedBy,
        reviewedAt: new Date(),
      },
    });

    if (approvalUpdate.count !== 1) {
      throw new AppError("Approval request already reviewed", 400, "APPROVAL_REVIEWED");
    }

    const updatedApproval = await tx.pendingApproval.findUniqueOrThrow({
      where: { id: approvalId },
    });

    const result = await executeApprovedRequest(
      approval.requestType,
      approval.requestData,
      reviewedBy,
      tx,
      options,
      approvalId
    );

    return {
      approval: updatedApproval,
      result,
    };
  });

  // Billing runs AFTER the approval commits, deliberately: it opens its own
  // transaction, moves stock and sends a WhatsApp, and none of that can be
  // undone by a rollback. A failure here leaves an approved order sitting in
  // the preparation screen — recoverable by hand — rather than an invoice
  // for an approval that never happened.
  if (
    options?.catalogOrderMode === "INVOICE" &&
    approval.requestType === approvalRequestTypes.CATALOG_ORDER
  ) {
    const prepId = (reviewed.result as { id?: string } | null)?.id;
    if (prepId) {
      const { markPrepared } = await import("./order-preparation.service");
      const prepared = await markPrepared(prepId, reviewedBy);
      return { ...reviewed, result: { ...(reviewed.result as object), prepared } };
    }
  }

  return reviewed;
}

/**
 * «أضفه كزبون» — put the person behind a catalog order on the shop's books.
 *
 * Goes through promoteVisitorToCustomer where it can, so the storefront login
 * code, address and province they already gave move across with them and they
 * keep signing in as themselves. Falls back to a plain create for a phone the
 * storefront never saw. Idempotent: a phone that is already a customer just
 * comes back, so a double click cannot make two customers.
 */
export async function addCustomerFromApproval(approvalId: string, userId: string) {
  const approval = await prisma.pendingApproval.findUnique({ where: { id: approvalId } });
  if (!approval) throw new AppError("Approval request not found", 404, "APPROVAL_NOT_FOUND");
  if (approval.requestType !== approvalRequestTypes.CATALOG_ORDER) {
    throw new AppError("هذا الطلب مو طلب كتلوك", 400, "NOT_CATALOG_ORDER");
  }

  const data = (approval.requestData ?? {}) as {
    customerName?: string; phone?: string; address?: string; province?: string;
  };
  const { normalizePhone } = await import("../utils/phone");
  const phone = normalizePhone(String(data.phone ?? "").trim());
  if (!phone) throw new AppError("الطلب ما بيه رقم هاتف", 400, "PHONE_REQUIRED");

  const existing = await prisma.customer.findFirst({ where: { phone, deletedAt: null } });
  if (existing) return { customerId: existing.id, name: existing.name, created: false };

  const promoted = await (async () => {
    try {
      const { promoteVisitorToCustomer } = await import("./catalog-visitor.service");
      const result = await promoteVisitorToCustomer(phone);
      return await prisma.customer.findUnique({ where: { id: result.customerId } });
    } catch {
      return null;
    }
  })();

  const customer = promoted ?? await prisma.customer.create({
    data: {
      name: String(data.customerName ?? "").trim() || phone,
      phone,
      address: data.address?.trim() || null,
      province: data.province?.trim() || null,
      openingBalance: 0,
      currentBalance: 0,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "CUSTOMER_ADDED_FROM_CATALOG_ORDER",
      entity: "Customer",
      recordId: customer.id,
      metadata: { approvalId, phone } as Prisma.InputJsonValue,
    },
  });

  return { customerId: customer.id, name: customer.name, created: true };
}
