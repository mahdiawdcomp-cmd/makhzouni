import { UserRole } from "@prisma/client";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  approvalRequestTypes,
  createPendingApproval,
} from "../services/approval.service";
import {
  createVoucher,
  deleteVoucher,
  getVoucherById,
  listVouchers,
  updateVoucher,
} from "../services/voucher.service";
import {
  generateVoucherPdf,
  generateVoucherPng,
} from "../services/voucher-export.service";

function requireUser(user: Express.User | undefined) {
  if (!user) {
    throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  }

  return user;
}

export const getVouchers = asyncHandler(async (req, res) => {
  const result = await listVouchers(
    req.validatedQuery as Parameters<typeof listVouchers>[0]
  );

  res.json({
    success: true,
    ...result,
  });
});

export const getVoucherDetails = asyncHandler(async (req, res) => {
  const voucher = await getVoucherById(String(req.params.id));

  res.json({
    success: true,
    data: voucher,
  });
});

export const addVoucher = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);

  if (user.role === UserRole.STAFF) {
    const approval = await createPendingApproval(
      approvalRequestTypes.CREATE_VOUCHER,
      { body: req.body },
      user.id
    );

    res.status(202).json({
      success: true,
      message: "طلبك قيد المراجعة",
      approvalId: approval.id,
    });
    return;
  }

  const voucher = await createVoucher(req.body, user.id);

  res.status(201).json({
    success: true,
    message: "Voucher created successfully",
    data: voucher,
  });
});

export const editVoucher = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const id = String(req.params.id);

  if (user.role === UserRole.STAFF) {
    const approval = await createPendingApproval(
      approvalRequestTypes.UPDATE_VOUCHER,
      { params: { id }, body: req.body },
      user.id
    );
    res.status(202).json({ success: true, message: "طلبك قيد المراجعة", approvalId: approval.id });
    return;
  }

  const voucher = await updateVoucher(id, req.body);
  res.json({ success: true, message: "Voucher updated", data: voucher });
});

export const exportVoucherPdf = asyncHandler(async (req, res) => {
  const pdf = await generateVoucherPdf(String(req.params.id));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="voucher-${String(req.params.id)}.pdf"`);
  res.send(pdf);
});

export const exportVoucherImage = asyncHandler(async (req, res) => {
  const png = await generateVoucherPng(String(req.params.id));
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Disposition", `attachment; filename="voucher-${String(req.params.id)}.png"`);
  res.send(png);
});

export const removeVoucher = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const id = String(req.params.id);

  if (user.role === UserRole.STAFF) {
    const approval = await createPendingApproval(
      approvalRequestTypes.DELETE_VOUCHER,
      { params: { id } },
      user.id
    );
    res.status(202).json({ success: true, message: "طلبك قيد المراجعة", approvalId: approval.id });
    return;
  }

  const voucher = await deleteVoucher(id);
  res.json({ success: true, message: "Voucher deleted", data: voucher });
});
