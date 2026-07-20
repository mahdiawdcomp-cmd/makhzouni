import {
  getCatalogAccess,
  listCatalogProducts,
  lookupCatalogAccess,
  recordCatalogProductView,
  requestCatalogAccess,
  submitCatalogOrder,
} from "../services/catalog.service";
import { asyncHandler } from "../utils/async-handler";

export const trackCatalogProductView = asyncHandler(async (req, res) => {
  await recordCatalogProductView(String((req.body as { productId?: string })?.productId ?? ""));
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
