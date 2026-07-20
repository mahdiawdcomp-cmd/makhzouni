import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import { cancelPreparation, completePreparationWithInvoice, createCustomerForPreparation, listPendingPreparations, markPrepared } from "../services/order-preparation.service";

export const getPendingPreparations = asyncHandler(async (_req, res) => {
  const data = await listPendingPreparations();
  res.json({ success: true, data });
});

export const markOrderPrepared = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication required", 401, "AUTH_REQUIRED");
  const id = String(req.params.id);
  const { warehouseId, notes } = req.body as { warehouseId?: string; notes?: string };
  const result = await markPrepared(id, req.user.id, { warehouseId, notes });
  res.json({ success: true, message: "Order marked as prepared and customer notified", ...result });
});

// Link an already-created invoice (manual full-invoice flow) and mark prepared.
export const completeOrderPreparation = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication required", 401, "AUTH_REQUIRED");
  const id = String(req.params.id);
  const { invoiceId } = req.body as { invoiceId?: string };
  if (!invoiceId) throw new AppError("invoiceId is required", 400, "INVOICE_ID_REQUIRED");
  const result = await completePreparationWithInvoice(id, req.user.id, invoiceId);
  res.json({ success: true, message: "Preparation completed", ...result });
});

// «زبون جديد — نسويله حساب؟»: create a Customer from the preparation phone.
export const createPreparationCustomer = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication required", 401, "AUTH_REQUIRED");
  const id = String(req.params.id);
  const result = await createCustomerForPreparation(id);
  res.json({
    success: true,
    message: result.created ? `تم إنشاء حساب للزبون: ${result.name}` : `الرقم مسجل أصلاً باسم: ${result.name}`,
    data: result,
  });
});

// Cancel a pending preparation (rejected / not prepared).
export const cancelOrderPreparation = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication required", 401, "AUTH_REQUIRED");
  const id = String(req.params.id);
  const result = await cancelPreparation(id);
  res.json({ success: true, message: "Preparation cancelled", ...result });
});
