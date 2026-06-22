import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import { listPendingPreparations, markPrepared } from "../services/order-preparation.service";

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
