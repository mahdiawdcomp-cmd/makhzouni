import { UserRole } from "@prisma/client";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  approvalRequestTypes,
  createPendingApproval,
} from "../services/approval.service";
import {
  cancelInvoice,
  createInvoice,
  getInvoiceById,
  getLastSoldPrice,
  hardDeleteInvoice,
  listInvoices,
  listRecentlyDeletedInvoices,
  reactivateInvoice,
  restoreArchivedInvoice,
  updateInvoice,
} from "../services/invoice.service";
import {
  generateInvoicePdf,
  generateInvoicePng,
} from "../services/invoice-export.service";
import { getInvoiceAuditTrail } from "../services/invoice-audit.service";
import { hasPermission } from "../middleware/permission.middleware";

function requireUser(user: Express.User | undefined) {
  if (!user) {
    throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  }

  return user;
}

async function queueInvoiceApproval(
  requestType: "CREATE_INVOICE" | "UPDATE_INVOICE" | "CANCEL_INVOICE" | "HARD_DELETE_INVOICE",
  requestData: Record<string, unknown>,
  requestedBy: string,
  requesterName?: string
) {
  const approval = await createPendingApproval(
    approvalRequestTypes[requestType],
    requestData,
    requestedBy,
    requesterName
  );

  return {
    success: true,
    message: "طلبك قيد المراجعة — سيتم إشعار المدير للموافقة",
    approvalId: approval.id,
  };
}

export const getInvoices = asyncHandler(async (req, res) => {
  const result = await listInvoices(
    req.validatedQuery as Parameters<typeof listInvoices>[0]
  );

  res.json({
    success: true,
    ...result,
  });
});

export const getInvoiceDetails = asyncHandler(async (req, res) => {
  const invoice = await getInvoiceById(String(req.params.id));

  res.json({
    success: true,
    data: invoice,
  });
});

export const getInvoiceAudit = asyncHandler(async (req, res) => {
  const data = await getInvoiceAuditTrail(String(req.params.id));

  res.json({
    success: true,
    data,
  });
});

export const getLastSoldPriceForProduct = asyncHandler(async (req, res) => {
  const data = await getLastSoldPrice(String(req.query.customerId), String(req.query.productId));

  res.json({
    success: true,
    data,
  });
});

export const addInvoice = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);

  if (user.role === UserRole.STAFF && !hasPermission(user, "MANAGE_INVOICES")) {
    res.status(202).json(
      await queueInvoiceApproval("CREATE_INVOICE", { body: req.body }, user.id)
    );
    return;
  }

  const invoice = await createInvoice(req.body, user.id);

  res.status(201).json({
    success: true,
    message: "Invoice created successfully",
    data: invoice,
  });
});

export const editInvoice = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const id = String(req.params.id);

  if (user.role === UserRole.STAFF && !hasPermission(user, "MANAGE_INVOICES")) {
    res.status(202).json(
      await queueInvoiceApproval(
        "UPDATE_INVOICE",
        { params: { id }, body: req.body },
        user.id
      )
    );
    return;
  }

  const invoice = await updateInvoice(id, req.body, user.id);

  res.json({
    success: true,
    message: "Invoice updated successfully",
    data: invoice,
  });
});

export const deleteInvoice = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const id = String(req.params.id);

  if (user.role === UserRole.STAFF && !hasPermission(user, "MANAGE_INVOICES")) {
    res.status(202).json(
      await queueInvoiceApproval("CANCEL_INVOICE", { params: { id } }, user.id, user.name)
    );
    return;
  }

  const invoice = await cancelInvoice(id);

  res.json({
    success: true,
    message: "Invoice cancelled successfully",
    data: invoice,
  });
});

export const permanentDeleteInvoice = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const id = String(req.params.id);

  if (user.role === UserRole.STAFF) {
    res.status(202).json(
      await queueInvoiceApproval("HARD_DELETE_INVOICE", { params: { id } }, user.id, user.name)
    );
    return;
  }

  const result = await hardDeleteInvoice(id, user.id);

  res.json({
    success: true,
    message: `تم حذف الفاتورة ${result.invoiceNumber} (محفوظة للتدقيق)`,
    data: result,
  });
});

export const restoreInvoice = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const id = String(req.params.id);

  if (user.role === UserRole.STAFF && !hasPermission(user, "MANAGE_INVOICES")) {
    throw new AppError("Invoice permission is required", 403, "PERMISSION_REQUIRED");
  }

  const invoice = await reactivateInvoice(id);

  res.json({
    success: true,
    message: "Invoice reactivated successfully",
    data: invoice,
  });
});

export const getRecentlyDeletedInvoicesCtrl = asyncHandler(async (_req, res) => {
  const invoices = await listRecentlyDeletedInvoices();
  res.json({ success: true, data: invoices });
});

export const restoreArchivedInvoiceCtrl = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const invoice = await restoreArchivedInvoice(id);
  res.json({ success: true, message: "تم استرجاع الفاتورة", data: invoice });
});

export const exportInvoicePdf = asyncHandler(async (req, res) => {
  const pdf = await generateInvoicePdf(String(req.params.id));

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="invoice-${String(req.params.id)}.pdf"`
  );
  res.send(pdf);
});

export const exportInvoiceImage = asyncHandler(async (req, res) => {
  const png = await generateInvoicePng(String(req.params.id));

  res.setHeader("Content-Type", "image/png");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="invoice-${String(req.params.id)}.png"`
  );
  res.send(png);
});
