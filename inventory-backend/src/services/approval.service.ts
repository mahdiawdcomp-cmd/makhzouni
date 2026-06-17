import { ApprovalStatus, Prisma } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
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
  notifyCatalogOrderApproved,
  notifyPreparationStaff,
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
  DELETE_VOUCHER: "حذف سند نهائياً",
  CREATE_INVOICE: "إنشاء فاتورة",
  UPDATE_INVOICE: "تعديل فاتورة",
  CREATE_VOUCHER: "إنشاء سند",
  UPDATE_VOUCHER: "تعديل سند",
  DELETE_PRODUCT: "حذف منتج",
  DELETE_CUSTOMER: "حذف زبون",
};

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
  return prisma.pendingApproval.findMany({
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
}

export async function listMyApprovals(userId: string) {
  return prisma.pendingApproval.findMany({
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
        items?: Parameters<typeof createInvoice>[0]["items"];
      };
      const phone = String(body.phone ?? "").trim();
      const customerName = String(body.customerName ?? "").trim();
      if (!phone || !customerName || !Array.isArray(body.items) || body.items.length === 0) {
        throw new AppError("Catalog order is missing required data", 400, "CATALOG_ORDER_INVALID");
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

      const invoice = await createInvoice(
        {
          customerId: customer.id,
          type: "SALE",
          discount: 0,
          tax: 0,
          paidAmount: 0,
          paymentType: "CREDIT",
          items: body.items,
        },
        reviewerId,
        tx
      );

      // displayItems from the approval snapshot (includes productId + productName)
      const displayItems = (data.displayItems ?? []) as Array<{
        productId: string;
        productName?: string;
        unit: string;
        quantity: number;
        unitPrice?: number;
        totalPrice?: number;
      }>;

      // Fallback: build from body.items if no displayItems
      const prepItems: Array<{
        productId: string;
        productName?: string;
        unit: string;
        quantity: number;
        unitPrice?: number;
        totalPrice?: number;
      }> = displayItems.length > 0
        ? displayItems
        : (body.items ?? []).map((it) => ({
            productId: it.productId ?? "",
            productName: String(it.productId ?? ""),
            unit: it.unit,
            quantity: it.quantity,
            unitPrice: undefined,
            totalPrice: undefined,
          }));

      // Fire-and-forget (don't block tx)
      setImmediate(async () => {
        try {
          await createOrderPreparation(
            invoice.id,
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

          const settings = await getSettings().catch(() => null);
          const currency = settings?.currency ?? "IQD";
          await notifyCatalogOrderApproved(
            customerName,
            phone,
            invoice.id,
            invoice.invoiceNumber,
            Number(invoice.totalAmount),
            currency,
          );
          await notifyPreparationStaff(
            customerName,
            phone,
            invoice.id,
            invoice.invoiceNumber,
            Number(invoice.totalAmount),
            currency,
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
          console.error("[CatalogOrder] post-approval tasks failed:", err);
        }
      });

      return invoice;
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
    case approvalRequestTypes.CREATE_TRANSFER:
      // Approved transfers always go through, even into negative stock — the
      // deficit will surface in the stocktake (per spec).
      return executeTransferWithin(
        tx,
        data.body as Parameters<typeof executeTransferWithin>[1],
        reviewerId,
        true
      );
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
