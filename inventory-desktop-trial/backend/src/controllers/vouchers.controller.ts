import { UserRole } from "@prisma/client";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import { contentDisposition } from "../utils/content-disposition";
import {
  approvalRequestTypes,
  createPendingApproval,
} from "../services/approval.service";
import {
  cancelVoucher,
  createVoucher,
  deleteVoucher,
  getVoucherById,
  listVouchers,
  restoreVoucher,
  updateVoucher,
} from "../services/voucher.service";
import {
  generateVoucherPdf,
  generateVoucherPng,
  money,
  voucherContext,
} from "../services/voucher-export.service";
import { sendPdfWithTemplateFallback } from "../services/whatsapp.service";
import { getSettings } from "../services/settings.service";
import { hasPermission } from "../middleware/permission.middleware";

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

  if (user.role === UserRole.STAFF && !hasPermission(user, "MANAGE_VOUCHERS")) {
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

  if (user.role === UserRole.STAFF && !hasPermission(user, "MANAGE_VOUCHERS")) {
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
  res.setHeader("Content-Disposition", contentDisposition("inline", `voucher-${String(req.params.id)}.pdf`));
  res.send(pdf);
});

export const exportVoucherImage = asyncHandler(async (req, res) => {
  const png = await generateVoucherPng(String(req.params.id));
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Disposition", `attachment; filename="voucher-${String(req.params.id)}.png"`);
  res.send(png);
});

// Sends the voucher's real PDF as the WhatsApp document header (Meta template
// requires one now that a PDF header was configured for the template) — falls
// back to the same PDF as a plain attachment if the template call fails.
// The caption text stays whatever the client built from Settings →
// voucherTemplate, so the customizable wording is unaffected.
export const sendVoucherPdfWhatsapp = asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const message = String(req.body?.message ?? "");
  if (!message) throw new AppError("نص الرسالة مطلوب", 400, "SEND_VOUCHER_PDF_INVALID");

  const context = await voucherContext(id);
  const { voucher, previous, final, storeName } = context;
  if (voucher.type === "EXPENSE") {
    throw new AppError("سندات المصاريف داخلية ولا ترسل عبر واتساب", 400, "VOUCHER_EXPENSE_NOT_SENDABLE");
  }
  const phone = voucher.customer?.phone;
  if (!phone) throw new AppError("رقم الهاتف غير متوفر", 400, "VOUCHER_PHONE_MISSING");

  const settings = await getSettings();
  const pdf = await generateVoucherPdf(id);
  const filename = `voucher-${voucher.voucherNumber}.pdf`;

  // bodyParams order must match the approved Meta template's {{1}}..{{7}}:
  // name, amount, voucher number, date, previous balance, current balance, store name.
  const bodyParams = [
    voucher.customer?.name ?? "",
    money(voucher.amount),
    voucher.voucherNumber,
    String(voucher.date).slice(0, 10),
    money(previous ?? 0),
    money(final ?? voucher.customer?.currentBalance ?? 0),
    storeName,
  ];

  const result = await sendPdfWithTemplateFallback(
    phone,
    settings.voucherTemplateName,
    "ar",
    message,
    pdf,
    filename,
    bodyParams,
  );

  res.json({ success: true, message: "تم إرسال السند عبر واتساب", data: result });
});

export const cancelVoucherCtrl = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const id = String(req.params.id);

  if (user.role === UserRole.STAFF && !hasPermission(user, "MANAGE_VOUCHERS")) {
    const approval = await createPendingApproval(
      approvalRequestTypes.CANCEL_VOUCHER,
      { params: { id } },
      user.id,
      user.name
    );
    res.status(202).json({ success: true, message: "طلبك قيد المراجعة — سيتم إشعار المدير للموافقة", approvalId: approval.id });
    return;
  }

  const voucher = await cancelVoucher(id);
  res.json({ success: true, message: "تم تعطيل السند وتحديث الحساب", data: voucher });
});

export const restoreVoucherCtrl = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const id = String(req.params.id);

  if (user.role === UserRole.STAFF && !hasPermission(user, "MANAGE_VOUCHERS")) {
    throw new AppError("صلاحية المدير مطلوبة لاستعادة السند", 403, "PERMISSION_REQUIRED");
  }

  const voucher = await restoreVoucher(id);
  res.json({ success: true, message: "تم استعادة السند وتحديث الحساب", data: voucher });
});

export const removeVoucher = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const id = String(req.params.id);

  if (user.role === UserRole.STAFF) {
    const approval = await createPendingApproval(
      approvalRequestTypes.DELETE_VOUCHER,
      { params: { id } },
      user.id,
      user.name
    );
    res.status(202).json({ success: true, message: "طلبك قيد المراجعة — سيتم إشعار المدير للموافقة", approvalId: approval.id });
    return;
  }

  const voucher = await deleteVoucher(id, undefined, user.id);
  res.json({ success: true, message: "تم حذف السند (محفوظ للتدقيق)", data: voucher });
});
