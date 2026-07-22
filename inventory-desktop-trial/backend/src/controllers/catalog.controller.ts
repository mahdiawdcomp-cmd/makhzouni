import {
  getCatalogAccess,
  listCatalogProducts,
  listGuestCatalogProducts,
  lookupCatalogAccess,
  recordCatalogProductView,
  recordVisitorHeartbeat,
  recordGuestVisit,
  requestCatalogAccess,
  submitCatalogOrder,
  submitGuestCatalogOrder,
} from "../services/catalog.service";
import { asyncHandler } from "../utils/async-handler";

export const getGuestCatalogProducts = asyncHandler(async (_req, res) => {
  const products = await listGuestCatalogProducts();
  res.json({ success: true, data: products });
});

export const createGuestCatalogOrder = asyncHandler(async (req, res) => {
  const result = await submitGuestCatalogOrder(req.body);
  res.status(201).json({ success: true, message: "Guest catalog order submitted for approval", data: result });
});

export const guestCatalogEnter = asyncHandler(async (req, res) => {
  const result = await recordGuestVisit(String((req.body as { phone?: string })?.phone ?? ""));
  res.json({ success: true, data: result });
});

export const trackCatalogProductView = asyncHandler(async (req, res) => {
  const body = req.body as { productId?: string; phone?: string };
  await recordCatalogProductView(String(body?.productId ?? ""), body?.phone);
  res.json({ success: true });
});

export const postVisitorHeartbeat = asyncHandler(async (req, res) => {
  const body = req.body as { phone?: string; seconds?: number };
  await recordVisitorHeartbeat(String(body?.phone ?? ""), Number(body?.seconds ?? 0));
  res.json({ success: true });
});

export const createCatalogAccessRequest = asyncHandler(async (req, res) => {
  const result = await requestCatalogAccess(req.body);
  res.status(201).json({
    success: true,
    message: "Catalog access request submitted for approval",
    data: result,
  });
});

export const getCatalogAccessStatus = asyncHandler(async (req, res) => {
  const result = await lookupCatalogAccess(String(req.query.phone ?? ""));
  res.json({ success: true, data: result });
});

export const getCatalogSession = asyncHandler(async (req, res) => {
  const result = await getCatalogAccess(String(req.query.access ?? ""));
  res.json({ success: true, data: result });
});

export const getCatalogProducts = asyncHandler(async (req, res) => {
  const products = await listCatalogProducts(String(req.query.access ?? ""));
  res.json({ success: true, data: products });
});

export const createCatalogOrder = asyncHandler(async (req, res) => {
  const result = await submitCatalogOrder(req.body, String(req.query.access ?? ""));
  res.status(201).json({
    success: true,
    message: "Catalog order submitted for approval",
    data: result,
  });
});
