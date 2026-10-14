import { LossReason } from "@prisma/client";
import { asyncHandler } from "../utils/async-handler";
import {
  approveAllStocktakeItems,
  approveStocktakeItem,
  archiveStocktakeSession,
  closePublicStocktake,
  closeStocktakeSession,
  createStocktakeSession,
  getPublicSession,
  getStocktakeSession,
  listStocktakeSessions,
  rejectAllStocktakeItems,
  rejectStocktakeItem,
  reopenStocktakeSession,
  scanQrCode,
  setItemQty,
  submitPublicStocktake,
  submitStocktakeSession,
  updateStocktakeItem,
} from "../services/stocktake.service";

// ── Admin ────────────────────────────────────────────────────────────────────

export const listSessions = asyncHandler(async (_req, res) => {
  const data = await listStocktakeSessions();
  res.json({ success: true, data });
});

export const createSession = asyncHandler(async (req, res) => {
  const { branchId, notes } = req.body as { branchId?: string; notes?: string };
  const data = await createStocktakeSession(String(req.user!.id), branchId, notes);
  res.status(201).json({ success: true, data });
});

export const getSession = asyncHandler(async (req, res) => {
  const data = await getStocktakeSession(String(req.params.id));
  res.json({ success: true, data });
});

export const closeSession = asyncHandler(async (req, res) => {
  const { force } = (req.body ?? {}) as { force?: boolean };
  const data = await closeStocktakeSession(String(req.params.id), String(req.user!.id), Boolean(force));
  res.json({ success: true, data });
});

export const archiveSession = asyncHandler(async (req, res) => {
  const { force } = (req.body ?? {}) as { force?: boolean };
  const data = await archiveStocktakeSession(String(req.params.id), Boolean(force));
  res.json({ success: true, data });
});

export const updateItem = asyncHandler(async (req, res) => {
  const { productId, actualQty, notes } = req.body as {
    productId: string;
    actualQty: number;
    notes?: string;
  };
  const data = await updateStocktakeItem(
    String(req.params.id),
    productId,
    Number(actualQty),
    notes,
  );
  res.json({ success: true, data });
});

export const submitSession = asyncHandler(async (req, res) => {
  const data = await submitStocktakeSession(String(req.params.id));
  res.json({ success: true, data });
});

export const approveItem = asyncHandler(async (req, res) => {
  const { reason, resolution } = req.body as { reason: LossReason; resolution?: "LOSS" | "SALE" | "PURCHASE" };
  const data = await approveStocktakeItem(
    String(req.params.id),
    String(req.params.itemId),
    String(req.user!.id),
    reason,
    resolution ?? "LOSS",
  );
  res.json({ success: true, data });
});

export const rejectItem = asyncHandler(async (req, res) => {
  const { reason } = (req.body ?? {}) as { reason?: string };
  const data = await rejectStocktakeItem(String(req.params.id), String(req.params.itemId), String(req.user!.id), reason);
  res.json({ success: true, data });
});

export const approveAllItems = asyncHandler(async (req, res) => {
  const { reason, mode } = req.body as { reason: LossReason; mode?: "LOSS" | "SALE_PURCHASE" };
  const data = await approveAllStocktakeItems(String(req.params.id), String(req.user!.id), reason, mode ?? "LOSS");
  res.json({ success: true, data });
});

export const rejectAllItems = asyncHandler(async (req, res) => {
  const data = await rejectAllStocktakeItems(String(req.params.id), String(req.user!.id));
  res.json({ success: true, data });
});

export const reopenSession = asyncHandler(async (req, res) => {
  const data = await reopenStocktakeSession(String(req.params.id));
  res.json({ success: true, data });
});

// ── Public (worker, no auth) ─────────────────────────────────────────────────

export const publicGetSession = asyncHandler(async (req, res) => {
  const data = await getPublicSession(String(req.params.token));
  res.json({ success: true, data });
});

export const publicScanQr = asyncHandler(async (req, res) => {
  const { qrCode } = req.body as { qrCode: string };
  const data = await scanQrCode(String(req.params.token), qrCode);
  res.json({ success: true, data });
});

export const publicSetQty = asyncHandler(async (req, res) => {
  const { productId, qty, unit, pcsPerCarton } = req.body as {
    productId: string;
    qty: number;
    unit: "CARTON" | "PIECE";
    pcsPerCarton: number;
  };
  const data = await setItemQty(
    String(req.params.token),
    productId,
    qty,
    unit,
    pcsPerCarton,
  );
  res.json({ success: true, data });
});

export const publicSubmit = asyncHandler(async (req, res) => {
  const data = await submitPublicStocktake(String(req.params.token));
  res.json({ success: true, data });
});

export const publicClose = asyncHandler(async (req, res) => {
  const data = await closePublicStocktake(String(req.params.token));
  res.json({ success: true, data });
});
