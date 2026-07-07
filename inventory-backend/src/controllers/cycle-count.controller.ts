// Controllers for "جدولة الجرد الذكي" — independent from stocktake.controller.ts.
import { CycleCountSessionSource, CycleCountStrategy } from "@prisma/client";
import { asyncHandler } from "../utils/async-handler";
import {
  approveAllCycleCountItems,
  approveCycleCountItem,
  cancelCycleCountSession,
  closeCycleCountSession,
  createCycleCountSession,
  getCycleCountSession,
  getPublicCycleCountSession,
  listCycleCountSessions,
  rejectAllCycleCountItems,
  rejectCycleCountItem,
  reopenCycleCountSession,
  scanCycleCountQrCode,
  setCycleCountItemQty,
  submitCycleCountSession,
  submitPublicCycleCount,
  updateCycleCountItem,
} from "../services/cycle-count.service";

export const listSessions = asyncHandler(async (_req, res) => {
  const data = await listCycleCountSessions();
  res.json({ success: true, data });
});

export const createSession = asyncHandler(async (req, res) => {
  const { warehouseId, strategy, itemLimit, notes } = req.body as {
    warehouseId?: string;
    strategy: CycleCountStrategy;
    itemLimit: number;
    notes?: string;
  };
  const data = await createCycleCountSession({
    createdBy: String(req.user!.id),
    warehouseId,
    strategy,
    itemLimit: Number(itemLimit),
    notes,
    source: CycleCountSessionSource.MANUAL,
  });
  res.status(201).json({ success: true, data });
});

export const getSession = asyncHandler(async (req, res) => {
  const data = await getCycleCountSession(String(req.params.id));
  res.json({ success: true, data });
});

export const updateItem = asyncHandler(async (req, res) => {
  const { productId, actualQty, notes } = req.body as {
    productId: string;
    actualQty: number;
    notes?: string;
  };
  const data = await updateCycleCountItem(String(req.params.id), productId, Number(actualQty), notes);
  res.json({ success: true, data });
});

export const submitSession = asyncHandler(async (req, res) => {
  const data = await submitCycleCountSession(String(req.params.id));
  res.json({ success: true, data });
});

export const closeSession = asyncHandler(async (req, res) => {
  const data = await closeCycleCountSession(String(req.params.id));
  res.json({ success: true, data });
});

export const cancelSession = asyncHandler(async (req, res) => {
  const data = await cancelCycleCountSession(String(req.params.id));
  res.json({ success: true, data });
});

export const approveItem = asyncHandler(async (req, res) => {
  const data = await approveCycleCountItem(String(req.params.id), String(req.params.itemId), String(req.user!.id));
  res.json({ success: true, data });
});

export const rejectItem = asyncHandler(async (req, res) => {
  const data = await rejectCycleCountItem(String(req.params.id), String(req.params.itemId), String(req.user!.id));
  res.json({ success: true, data });
});

export const approveAllItems = asyncHandler(async (req, res) => {
  const data = await approveAllCycleCountItems(String(req.params.id), String(req.user!.id));
  res.json({ success: true, data });
});

export const rejectAllItems = asyncHandler(async (req, res) => {
  const data = await rejectAllCycleCountItems(String(req.params.id), String(req.user!.id));
  res.json({ success: true, data });
});

export const reopenSession = asyncHandler(async (req, res) => {
  const data = await reopenCycleCountSession(String(req.params.id));
  res.json({ success: true, data });
});

// ── Public (worker, no auth) ─────────────────────────────────────────────────

export const publicGetSession = asyncHandler(async (req, res) => {
  const data = await getPublicCycleCountSession(String(req.params.token));
  res.json({ success: true, data });
});

export const publicScanQr = asyncHandler(async (req, res) => {
  const { qrCode } = req.body as { qrCode: string };
  const data = await scanCycleCountQrCode(String(req.params.token), qrCode);
  res.json({ success: true, data });
});

export const publicSetQty = asyncHandler(async (req, res) => {
  const { productId, qty, unit } = req.body as {
    productId: string;
    qty: number;
    unit: "CARTON" | "PIECE";
  };
  const data = await setCycleCountItemQty(String(req.params.token), productId, qty, unit);
  res.json({ success: true, data });
});

export const publicSubmit = asyncHandler(async (req, res) => {
  const data = await submitPublicCycleCount(String(req.params.token));
  res.json({ success: true, data });
});
