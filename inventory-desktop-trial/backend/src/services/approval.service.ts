import { ApprovalStatus, Prisma } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { amountInPieces } from "../utils/financial";
import {
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
  NEGATIVE_STOCK_SALE: "بيع بضاعة سالبة (عجز مخزون)",
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
      default:
        return undefined;
    }
  } catch {
    // Display enrichment must never break the approvals list.
    return undefined;
  }
}

async function attachDisplays<T extends { requestType: string; requestData: unknown }>(
  approvals: T[]
): Promise<Array<T & { display?: ApprovalDisplay }>> {
  return Promise.all(
    approvals.map(async (a) => ({
      ...a,
      display: await buildApprovalDisplay(a.requestType, a.requestData),
    }))
  );
}

export async function createPendingApproval(
  requestType: ApprovalRequestType,
  requestData: Record<string, unknown>,
  requestedBy: string,
  requesterName?: string
) {
  const approval = await prisma.pendingApproval.create({
    data: {
      requestType,
      requestData: requestData as Prisma.InputJsonValue,
      requestedBy,
    },
  });

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
  options?: { allowPrices?: boolean; showStock?: boolean }
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
      };
      const phone = String(body.phone ?? "").trim();
      const customerName = String(body.customerName ?? "").trim();
      if (!phone || !customerName) {
        throw new AppError("Catalog access is missing required data", 400, "CATALOG_ACCESS_INVALID");
      }

      const existingCustomer = await tx.customer.findUnique({ where: { phone } });
      const customer = existingCustomer
        ? await tx.customer.update({
            where: { id: existingCustomer.id },
            data: {
              name: customerName,
              address: body.address,
              notes: body.notes,
              deletedAt: null,
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
            },
          });

      const link = await createCatalogAccessLink(tx, customer.id, Boolean(options?.allowPrices), options?.showStock ?? true);
      setImmediate(() => {
        notifyCatalogAccessApproved(
          customer.name,
          customer.phone,
          link.urlPath,
          link.allowPrices,
        ).catch((err) => console.error("[CatalogAccess] approval notify failed:", err));
      });
      return link;
    }
    case approvalRequestTypes.CATALOG_ORDER: {
      const body = data.body as {
        customerName?: string;
        phone?: string;
        address?: string;
        notes?: string;
        warehouseId?: string;
        items?: Parameters<typeof createInvoice>[0]["items"];
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
            warehouseId: body.warehouseId,
            items: body.items,
            discount: 0,
            tax: 0,
            paidAmount: 0,
            paymentType: "CREDIT",
          } as unknown as import("@prisma/client").Prisma.InputJsonValue,
          status: "PENDING",
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
        tx
      );
    case approvalRequestTypes.HARD_DELETE_INVOICE:
      return hardDeleteInvoice(
        data.params && typeof data.params === "object"
          ? String((data.params as Record<string, unknown>).id)
          : "",
        reviewerId,
        typeof data.reason === "string" ? data.reason : undefined
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
  options?: { allowPrices?: boolean; showStock?: boolean }
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
    return {
      approval: await prisma.pendingApproval.update({
        where: { id: approvalId },
        data: {
          status: ApprovalStatus.REJECTED,
          reviewedBy,
          reviewedAt: new Date(),
        },
      }),
      result: null,
    };
  }

  return prisma.$transaction(async (tx) => {
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
      options
    );

    return {
      approval: updatedApproval,
      result,
    };
  });
}
