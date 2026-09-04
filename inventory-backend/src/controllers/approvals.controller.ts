import { asyncHandler } from "../utils/async-handler";
import {
  listMyApprovals,
  listPendingApprovals,
  reviewApproval,
  addCustomerFromApproval,
} from "../services/approval.service";
import { notifyTransferReviewed } from "../services/transfer.service";
import { hasPermission } from "../middleware/permission.middleware";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";

export const getPendingApprovals = asyncHandler(async (_req, res) => {
  const approvals = await listPendingApprovals();

  res.json({
    success: true,
    data: approvals,
  });
});

export const getMyApprovals = asyncHandler(async (req, res) => {
  if (!req.user) {
    throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  }

  const approvals = await listMyApprovals(req.user.id);

  res.json({
    success: true,
    data: approvals,
  });
});

export const bulkReviewApprovals = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");

  const { ids, status } = req.body as { ids: string[]; status: "APPROVED" | "REJECTED" };
  if (!Array.isArray(ids) || ids.length === 0) throw new AppError("ids must be a non-empty array", 400, "INVALID_INPUT");
  if (status !== "APPROVED" && status !== "REJECTED") throw new AppError("Invalid status", 400, "INVALID_INPUT");

  let done = 0;
  const errors: string[] = [];
  for (const id of ids) {
    try {
      const target = await prisma.pendingApproval.findUnique({
        where: { id },
        select: { requestType: true, requestedBy: true },
      });
      const isTransfer = target?.requestType === "CREATE_TRANSFER";
      const canReview = req.user.role === "ADMIN" || (isTransfer && hasPermission(req.user, "MANAGE_TRANSFERS"));
      if (!canReview) { errors.push(id); continue; }
      // Same segregation-of-duties rule as the single-review handler — bulk
      // approve must not become the way around it.
      if (req.user.role !== "ADMIN" && target?.requestedBy === req.user.id) { errors.push(id); continue; }
      const result = await reviewApproval(id, status, req.user.id, {});
      if (isTransfer) {
        const approval = result.approval as { requestData?: unknown; requestedBy?: string };
        notifyTransferReviewed(approval.requestData, approval.requestedBy ?? "", status).catch(() => {});
      }
      done++;
    } catch {
      errors.push(id);
    }
  }

  res.json({ success: true, done, failed: errors.length, message: `${status === "APPROVED" ? "وافقت" : "رفضت"} على ${done} طلب` });
});

export const reviewPendingApproval = asyncHandler(async (req, res) => {
  if (!req.user) {
    throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  }

  const id = String(req.params.id);
  // Admins review anything; holders of MANAGE_TRANSFERS may review transfers.
  const target = await prisma.pendingApproval.findUnique({
    where: { id },
    select: { requestType: true, requestedBy: true },
  });
  const isTransfer = target?.requestType === "CREATE_TRANSFER";
  const canReview =
    req.user.role === "ADMIN" || (isTransfer && hasPermission(req.user, "MANAGE_TRANSFERS"));
  if (!canReview) {
    throw new AppError("Only admins can review approval requests", 403, "ADMIN_REQUIRED");
  }

  // Segregation of duties: the whole point of the queue is that a second person
  // signs off. A staff account holding both REQUEST_TRANSFER and
  // MANAGE_TRANSFERS could otherwise raise a transfer and immediately approve
  // its own request, moving stock between warehouses with an audit trail that
  // reads as "reviewed". Admins are exempt — they can already act directly.
  if (req.user.role !== "ADMIN" && target?.requestedBy === req.user.id) {
    throw new AppError(
      "لا يمكنك الموافقة على طلبك الخاص — يحتاج مراجعة شخص آخر",
      403,
      "SELF_APPROVAL_FORBIDDEN"
    );
  }

  const { status, allowPrices, showStock, catalogOrderMode, reviewNote } = req.body as {
    status: "APPROVED" | "REJECTED"; allowPrices?: boolean; showStock?: boolean;
    catalogOrderMode?: "INVOICE" | "PREPARE";
    // Only meaningful on a rejection — the reason the requester will read.
    reviewNote?: string;
  };
  const result = await reviewApproval(id, status, req.user.id, {
    allowPrices,
    showStock,
    catalogOrderMode,
    reviewNote,
  });

  // Notify the requester + admin about the transfer decision (fire-and-forget).
  if (isTransfer) {
    const approval = result.approval as { requestData?: unknown; requestedBy?: string };
    notifyTransferReviewed(approval.requestData, approval.requestedBy ?? "", status).catch(() => {});
  }

  res.json({
    success: true,
    message:
      status === "APPROVED"
        ? "Approval request approved and executed"
        : "Approval request rejected",
    data: result,
  });
});

/** «أضفه كزبون» — the step before a stranger's order can become an invoice. */
export const addApprovalCustomer = asyncHandler(async (req, res) => {
  const data = await addCustomerFromApproval(String(req.params.id), req.user!.id);
  res.json({ success: true, data });
});
