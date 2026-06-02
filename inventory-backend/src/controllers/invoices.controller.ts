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
  listInvoices,
  updateInvoice,
} from "../services/invoice.service";
import {
  generateInvoicePdf,
  generateInvoicePng,
} from "../services/invoice-export.service";

function requireUser(user: Express.User | undefined) {
  if (!user) {
    throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  }

  return user;
}

async function queueInvoiceApproval(
  requestType: "CREATE_INVOICE" | "UPDATE_INVOICE" | "CANCEL_INVOICE",
  requestData: Record<string, unknown>,
  requestedBy: string
) {
  const approval = await createPendingApproval(
    approvalRequestTypes[requestType],
    requestData,
    requestedBy
  );

  return {
    success: true,
    message: "طلبك قيد المراجعة",
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

export const addInvoice = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);

  if (user.role === UserRole.STAFF) {
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

  if (user.role === UserRole.STAFF) {
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

  if (user.role === UserRole.STAFF) {
    res.status(202).json(
      await queueInvoiceApproval("CANCEL_INVOICE", { params: { id } }, user.id)
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

export const exportInvoicePdf = asyncHandler(async (req, res) => {
  const html = await generateInvoicePdf(String(req.params.id));

  // Return HTML so the browser renders and prints it — looks exactly like the web design
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
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
