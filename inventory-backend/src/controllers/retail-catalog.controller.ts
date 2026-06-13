import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
import {
  broadcastToRetailCustomers,
  cancelRetailOrder,
  createRetailCategory,
  createRetailCoupon,
  createRetailItem,
  deleteRetailCategory,
  deleteRetailCoupon,
  deleteRetailItem,
  listRetailCategories,
  listRetailCoupons,
  listRetailCustomers,
  listRetailItems,
  listRetailOrders,
  markRetailOrderPrepared,
  updateRetailCategory,
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

// ── Categories ──
export const getRetailCategories = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listRetailCategories() });
});

export const postRetailCategory = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await createRetailCategory(req.body) });
});

export const patchRetailCategory = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await updateRetailCategory(String(req.params.id), req.body) });
});

export const removeRetailCategory = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await deleteRetailCategory(String(req.params.id)) });
});

// ── Customers + broadcast ──
export const getRetailCustomers = asyncHandler(async (req, res) => {
  const category = req.query.category ? String(req.query.category) : undefined;
  const subscribersOnly = req.query.subscribersOnly === "true";
  res.json({ success: true, data: await listRetailCustomers({ category, subscribersOnly }) });
});

export const postRetailBroadcast = asyncHandler(async (req, res) => {
  const { message, images, category, subscribersOnly } = req.body as {
    message: string; images?: string[]; category?: string; subscribersOnly?: boolean;
  };
  const recipients = await listRetailCustomers({ category, subscribersOnly });
  // Respond immediately; send in the background (sending is throttled and slow).
  res.json({ success: true, message: `جارٍ الإرسال إلى ${recipients.length} زبون`, data: { total: recipients.length } });
  setImmediate(() => {
    broadcastToRetailCustomers({ message, images, category, subscribersOnly })
      .then((r) => logger.info(`[RetailBroadcast] done: ${r.sent}/${r.total} sent, ${r.failed} failed`))
      .catch((err) => logger.error(`[RetailBroadcast] error: ${err}`));
  });
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
