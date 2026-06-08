import { asyncHandler } from "../utils/async-handler";
import {
  closeStocktakeSession,
  createStocktakeSession,
  getStocktakeSession,
  listStocktakeSessions,
  submitStocktakeSession,
  updateStocktakeItem,
} from "../services/stocktake.service";

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
  const forStaff = req.user?.role === "STAFF";
  const data = await getStocktakeSession(String(req.params.id), forStaff);
  res.json({ success: true, data });
});

export const patchItem = asyncHandler(async (req, res) => {
  const { productId, actualQty, notes } = req.body as {
    productId: string;
    actualQty: number;
    notes?: string;
  };
  const data = await updateStocktakeItem(String(req.params.id), productId, actualQty, notes);
  res.json({ success: true, data });
});

export const submitSession = asyncHandler(async (req, res) => {
  const data = await submitStocktakeSession(String(req.params.id));
  res.json({ success: true, data });
});

export const closeSession = asyncHandler(async (req, res) => {
  const data = await closeStocktakeSession(String(req.params.id));
  res.json({ success: true, data });
});
