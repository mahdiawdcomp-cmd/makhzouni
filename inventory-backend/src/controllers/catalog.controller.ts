import {
  confirmCatalogVerification,
  getCatalogAccess,
  getCatalogProductImage,
  listCatalogProducts,
  lookupCatalogAccess,
  requestCatalogAccess,
  submitCatalogOrder,
  validatePromoCode,
} from "../services/catalog.service";
import { asyncHandler } from "../utils/async-handler";

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
  // requireVerified:false so a stale session still returns needsOtp + the
  // customer's phone, letting the frontend run the OTP re-verification flow.
  const result = await getCatalogAccess(String(req.query.access ?? ""), { requireVerified: false });
  res.json({ success: true, data: result });
});

export const verifyCatalogAccessCtrl = asyncHandler(async (req, res) => {
  const result = await confirmCatalogVerification(String(req.query.access ?? ""));
  res.json({ success: true, data: result });
});

export const getCatalogProducts = asyncHandler(async (req, res) => {
  const products = await listCatalogProducts(String(req.query.access ?? ""));
  res.json({ success: true, data: products });
});

export const getCatalogProductImageCtrl = asyncHandler(async (req, res) => {
  const imageUrl = await getCatalogProductImage(
    String(req.query.access ?? ""),
    String(req.query.id ?? ""),
  );
  res.json({ success: true, data: { imageUrl } });
});

export const createCatalogOrder = asyncHandler(async (req, res) => {
  const result = await submitCatalogOrder(req.body, String(req.query.access ?? ""));
  res.status(201).json({
    success: true,
    message: "Catalog order submitted for approval",
    data: result,
  });
});

export const validatePromoCtrl = asyncHandler(async (req, res) => {
  const { code, customerId } = req.body as { code: string; customerId: string };
  const promo = await validatePromoCode(code, customerId);
  res.json({
    success: true,
    data: {
      code: promo.code,
      type: promo.type,
      value: promo.value !== null ? Number(promo.value) : null,
      description: promo.description,
    },
  });
});
