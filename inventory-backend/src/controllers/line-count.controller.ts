import { asyncHandler } from "../utils/async-handler";
import {
  cancelLineCount,
  cancelLineCountRecount,
  createLineCount,
  deleteLineCountLine,
  editLineCountLine,
  finalizeLineCount,
  getLineCountReview,
  listLineCounts,
  listLineCountWatch,
  markLineCountGone,
  publicGetLineCount,
  publicLineCountImage,
  publicLineCountThumbnails,
  publicSaveLineCountDraft,
  publicSubmitLineCount,
  reopenLineCount,
  requestLineCountRecount,
  setLineCountBasis,
  setLineCountKeep,
  setLineCountDecision,
  setLineCountProductTotal,
  swapLineCountUnits,
  type LineCountDecision,
  type SubmitOptions,
  type SubmittedLine,
} from "../services/line-count.service";

// Who acted, for the count's «السجل».
const who = (req: { user?: { id: string | number; name?: string | null } }) => ({ id: String(req.user!.id), name: req.user?.name ?? undefined });

export const listLineCountSessions = asyncHandler(async (req, res) => {
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  res.json({ success: true, data: await listLineCounts(warehouseId) });
});

export const createLineCountSession = asyncHandler(async (req, res) => {
  const { warehouseId, notes } = req.body as { warehouseId?: string; notes?: string };
  res.status(201).json({ success: true, data: await createLineCount(who(req).id, warehouseId, notes, who(req).name) });
});

export const getLineCountSession = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getLineCountReview(String(req.params.id)) });
});

export const decideLineCount = asyncHandler(async (req, res) => {
  const { decision, productId, productIds, price } = req.body as { decision: LineCountDecision; productId?: string; productIds?: string[]; price?: number };
  res.json({ success: true, data: await setLineCountDecision(String(req.params.id), decision, productId, productIds, who(req).id, who(req).name, price) });
});

export const finalizeLineCountSession = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await finalizeLineCount(String(req.params.id), who(req).id, who(req).name) });
});

export const cancelLineCountSession = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await cancelLineCount(String(req.params.id), who(req).id, who(req).name) });
});

export const reopenLineCountSession = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await reopenLineCount(String(req.params.id), who(req).id, who(req).name) });
});

export const publicGetLineCountSession = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await publicGetLineCount(String(req.params.token)) });
});

export const publicSubmitLineCountSession = asyncHandler(async (req, res) => {
  const { lines, submitId, sentAt } = req.body as { lines: SubmittedLine[] } & SubmitOptions;
  res.json({ success: true, data: await publicSubmitLineCount(String(req.params.token), lines, { submitId, sentAt }) });
});

export const publicSaveLineCountDraftHandler = asyncHandler(async (req, res) => {
  const { deviceId, round, lines } = req.body as { deviceId: string; round: number; lines: SubmittedLine[] };
  res.json({ success: true, data: await publicSaveLineCountDraft(String(req.params.token), deviceId, round, lines) });
});

type QtyBody = { qty: number; unit: "PIECE" | "CARTON" };

export const editLineCountLineHandler = asyncHandler(async (req, res) => {
  const { qty, unit } = req.body as QtyBody;
  res.json({ success: true, data: await editLineCountLine(String(req.params.id), String(req.params.lineId), qty, unit, who(req).id, who(req).name) });
});

export const deleteLineCountLineHandler = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await deleteLineCountLine(String(req.params.id), String(req.params.lineId), who(req).id, who(req).name) });
});

export const setLineCountProductTotalHandler = asyncHandler(async (req, res) => {
  const { qty, unit } = req.body as QtyBody;
  res.json({ success: true, data: await setLineCountProductTotal(String(req.params.id), String(req.params.productId), qty, unit, who(req).id, who(req).name) });
});

export const swapLineCountUnitsHandler = asyncHandler(async (req, res) => {
  const { lineIds } = req.body as { lineIds: string[] };
  res.json({ success: true, data: await swapLineCountUnits(String(req.params.id), String(req.params.productId), lineIds, who(req).id, who(req).name) });
});

export const requestLineCountRecountHandler = asyncHandler(async (req, res) => {
  const { productIds } = req.body as { productIds: string[] };
  res.json({ success: true, data: await requestLineCountRecount(String(req.params.id), productIds, who(req).id, who(req).name) });
});

export const markLineCountGoneHandler = asyncHandler(async (req, res) => {
  const { productIds } = req.body as { productIds: string[] };
  res.json({ success: true, data: await markLineCountGone(String(req.params.id), productIds, who(req).id, who(req).name) });
});

export const listLineCountWatchHandler = asyncHandler(async (req, res) => {
  const days = Math.min(3650, Math.max(1, Number(req.query.days) || 60));
  res.json({ success: true, data: await listLineCountWatch(days) });
});

export const cancelLineCountRecountHandler = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await cancelLineCountRecount(String(req.params.id), who(req).id, who(req).name) });
});

export const setLineCountBasisHandler = asyncHandler(async (req, res) => {
  const { basis } = req.body as { basis: "FIRST" | "LAST" };
  res.json({ success: true, data: await setLineCountBasis(String(req.params.id), String(req.params.productId), basis, who(req).id, who(req).name) });
});

export const publicLineCountThumbnailsHandler = asyncHandler(async (req, res) => {
  const { productIds } = req.body as { productIds: string[] };
  res.json({ success: true, data: await publicLineCountThumbnails(String(req.params.token), productIds) });
});

export const publicLineCountImageHandler = asyncHandler(async (req, res) => {
  // Pictures don't change often; let the phone keep a full-size copy for a day.
  res.set("Cache-Control", "private, max-age=86400");
  res.json({ success: true, data: await publicLineCountImage(String(req.params.token), String(req.params.productId)) });
});

export const setLineCountKeepHandler = asyncHandler(async (req, res) => {
  const { productIds, keep } = req.body as { productIds: string[]; keep: boolean };
  res.json({ success: true, data: await setLineCountKeep(String(req.params.id), productIds, keep, who(req).id, who(req).name) });
});
