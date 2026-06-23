import { LossReason, Unit } from "@prisma/client";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  cancelStockLoss,
  createStockLoss,
  getStockLossById,
  listStockLosses,
} from "../services/stock-loss.service";

function requireUser(user: Express.User | undefined) {
  if (!user) throw new AppError("Authentication required", 401, "AUTH_REQUIRED");
  return user;
}

export const getLosses = asyncHandler(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const result = await listStockLosses({
    from: Array.isArray(q.from) ? q.from[0] : q.from,
    to: Array.isArray(q.to) ? q.to[0] : q.to,
    warehouseId: Array.isArray(q.warehouseId) ? q.warehouseId[0] : q.warehouseId,
    page: Number(q.page) || 1,
    limit: Number(q.limit) || 50,
  });
  res.json({ success: true, ...result });
});

export const getLossDetails = asyncHandler(async (req, res) => {
  const loss = await getStockLossById(String(req.params.id));
  res.json({ success: true, data: loss });
});

export const postLoss = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const body = req.body as {
    date: string;
    warehouseId: string;
    reason?: string;
    notes?: string;
    items: Array<{ productId: string; unit: string; quantity: number }>;
  };

  if (!body.date) throw new AppError("التاريخ مطلوب", 400, "MISSING_DATE");
  if (!body.warehouseId) throw new AppError("المخزن مطلوب", 400, "MISSING_WAREHOUSE");
  if (!Array.isArray(body.items) || !body.items.length)
    throw new AppError("يجب إضافة مادة واحدة على الأقل", 400, "NO_ITEMS");

  const loss = await createStockLoss(
    {
      date: body.date,
      warehouseId: body.warehouseId,
      reason: (body.reason as LossReason) ?? LossReason.DAMAGE,
      notes: body.notes,
      items: body.items.map((i) => ({
        productId: i.productId,
        unit: i.unit as Unit,
        quantity: Number(i.quantity),
      })),
    },
    user.id
  );

  res.status(201).json({ success: true, data: loss });
});

export const patchCancelLoss = asyncHandler(async (req, res) => {
  requireUser(req.user);
  const loss = await cancelStockLoss(String(req.params.id));
  res.json({ success: true, data: loss });
});
