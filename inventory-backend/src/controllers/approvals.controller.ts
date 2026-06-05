import { asyncHandler } from "../utils/async-handler";
import {
  listMyApprovals,
  listPendingApprovals,
  reviewApproval,
} from "../services/approval.service";
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

export const reviewPendingApproval = asyncHandler(async (req, res) => {
  if (!req.user) {
    throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  }
  if (req.user.role !== "ADMIN") {
    throw new AppError("Only admins can review approval requests", 403, "ADMIN_REQUIRED");
  }

  const id = String(req.params.id);
  const { status } = req.body as { status: "APPROVED" | "REJECTED" };
  const result = await reviewApproval(id, status, req.user.id);

  res.json({
    success: true,
    message:
      status === "APPROVED"
        ? "Approval request approved and executed"
        : "Approval request rejected",
    data: result,
  });
});
