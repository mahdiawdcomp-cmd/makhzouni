import { ApprovalStatus, Prisma } from "@prisma/client";
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
import { createVoucher, deleteVoucher, updateVoucher } from "./voucher.service";
import {
  createProduct,
  deleteProduct,
  updateProduct,
} from "./product.service";

type Db = Prisma.TransactionClient;

export const approvalRequestTypes = {
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
  CREATE_VOUCHER: "CREATE_VOUCHER",
  UPDATE_VOUCHER: "UPDATE_VOUCHER",
  DELETE_VOUCHER: "DELETE_VOUCHER",
} as const;

export type ApprovalRequestType =
  (typeof approvalRequestTypes)[keyof typeof approvalRequestTypes];

export async function createPendingApproval(
  requestType: ApprovalRequestType,
  requestData: Record<string, unknown>,
  requestedBy: string
) {
  return prisma.pendingApproval.create({
    data: {
      requestType,
      requestData: requestData as Prisma.InputJsonValue,
      requestedBy,
    },
  });
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

async function executeApprovedRequest(
  requestType: string,
  requestData: unknown,
  reviewerId: string,
  tx: Db
) {
  const data = requestData as Record<string, unknown>;

  switch (requestType) {
    case approvalRequestTypes.CREATE_USER:
      return createUser(data.body as Parameters<typeof createUser>[0], tx);
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
    case approvalRequestTypes.DELETE_VOUCHER:
      return deleteVoucher(
        data.params && typeof data.params === "object"
          ? String((data.params as Record<string, unknown>).id)
          : "",
        tx
      );
    default:
      throw new AppError("Unsupported approval request type", 400, "UNSUPPORTED_APPROVAL");
  }
}

export async function reviewApproval(
  approvalId: string,
  status: "APPROVED" | "REJECTED",
  reviewedBy: string
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
      tx
    );

    return {
      approval: updatedApproval,
      result,
    };
  });
}
