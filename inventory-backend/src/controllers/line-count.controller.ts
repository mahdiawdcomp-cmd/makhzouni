import { asyncHandler } from "../utils/async-handler";
import {
  cancelLineCount,
  createLineCount,
  deleteLineCountLine,
  editLineCountLine,
  finalizeLineCount,
  getLineCountReview,
  listLineCounts,
  publicGetLineCount,
  publicSubmitLineCount,
  reopenLineCount,
  requestLineCountRecount,
  setLineCountDecision,
  setLineCountProductTotal,
  swapLineCountUnits,
  type LineCountDecision,
  type SubmittedLine,
} from "../services/line-count.service";

export const listLineCountSessions = asyncHandler(async (req, res) => {
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  res.json({ success: true, data: await listLineCounts(warehouseId) });
});

export const createLineCountSession = asyncHandler(async (req, res) => {
  const { warehouseId, notes } = req.body as { warehouseId?: string; notes?: string };
  res.status(201).json({ success: true, data: await createLineCount(String(req.user!.id), warehouseId, notes) });
});

export const getLineCountSession = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getLineCountReview(String(req.params.id)) });
});

export const decideLineCount = asyncHandler(async (req, res) => {
  const { decision, productId, productIds } = req.body as { decision: LineCountDecision; productId?: string; productIds?: string[] };
  res.json({ success: true, data: await setLineCountDecision(String(req.params.id), decision, productId, productIds) });
});

export const finalizeLineCountSession = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await finalizeLineCount(String(req.params.id), String(req.user!.id)) });
});

export const cancelLineCountSession = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await cancelLineCount(String(req.params.id)) });
});

export const reopenLineCountSession = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await reopenLineCount(String(req.params.id)) });
});

export const publicGetLineCountSession = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await publicGetLineCount(String(req.params.token)) });
});

export const publicSubmitLineCountSession = asyncHandler(async (req, res) => {
  const { lines } = req.body as { lines: SubmittedLine[] };
  res.json({ success: true, data: await publicSubmitLineCount(String(req.params.token), lines) });
});

type QtyBody = { qty: number; unit: "PIECE" | "CARTON" };

export const editLineCountLineHandler = asyncHandler(async (req, res) => {
  const { qty, unit } = req.body as QtyBody;
  res.json({ success: true, data: await editLineCountLine(String(req.params.id), String(req.params.lineId), qty, unit, String(req.user!.id)) });
});

export const deleteLineCountLineHandler = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await deleteLineCountLine(String(req.params.id), String(req.params.lineId), String(req.user!.id)) });
});

export const setLineCountProductTotalHandler = asyncHandler(async (req, res) => {
  const { qty, unit } = req.body as QtyBody;
  res.json({ success: true, data: await setLineCountProductTotal(String(req.params.id), String(req.params.productId), qty, unit, String(req.user!.id)) });
});

export const swapLineCountUnitsHandler = asyncHandler(async (req, res) => {
  const { lineIds } = req.body as { lineIds: string[] };
  res.json({ success: true, data: await swapLineCountUnits(String(req.params.id), String(req.params.productId), lineIds, String(req.user!.id)) });
});

export const requestLineCountRecountHandler = asyncHandler(async (req, res) => {
  const { productIds } = req.body as { productIds: string[] };
  res.json({ success: true, data: await requestLineCountRecount(String(req.params.id), productIds) });
});
