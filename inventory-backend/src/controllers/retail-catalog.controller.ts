import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  cancelRetailOrder,
  createRetailCoupon,
  createRetailItem,
  deleteRetailCoupon,
  deleteRetailItem,
  listRetailCoupons,
  listRetailItems,
  listRetailOrders,
  markRetailOrderPrepared,
  updateRetailCoupon,
  updateRetailItem,
} from "../services/retail-catalog.service";

// ── Items ──
export const getRetailItems = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listRetailItems() });
});

export const postRetailItem = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await createRetailItem(req.body) });
});

export const patchRetailItem = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await updateRetailItem(String(req.params.id), req.body) });
});

export const removeRetailItem = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await deleteRetailItem(String(req.params.id)) });
});

// ── Coupons ──
export const getRetailCoupons = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listRetailCoupons() });
});

export const postRetailCoupon = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await createRetailCoupon(req.body) });
});

export const patchRetailCoupon = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await updateRetailCoupon(String(req.params.id), req.body) });
});

export const removeRetailCoupon = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await deleteRetailCoupon(String(req.params.id)) });
});

// ── Orders ──
export const getRetailOrders = asyncHandler(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  res.json({ success: true, data: await listRetailOrders(status) });
});

export const prepareRetailOrder = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication required", 401, "AUTH_REQUIRED");
  const result = await markRetailOrderPrepared(String(req.params.id), req.user.id);
  res.json({ success: true, message: `تم تجهيز الطلب ${result.orderNumber} وإشعار الزبون`, data: result });
});

export const cancelRetailOrderCtrl = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await cancelRetailOrder(String(req.params.id)) });
});
