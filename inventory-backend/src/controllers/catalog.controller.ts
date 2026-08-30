import {
  confirmCatalogVerification,
  getCatalogAccess,
  getCatalogProductImage,
  getGuestCatalogProductImage,
  listCatalogProducts,
  listGuestCatalogProducts,
  lookupCatalogAccess,
  recordCatalogProductView,
  recordVisitorHeartbeat,
  recordGuestVisit,
  requestCatalogAccess,
  submitCatalogOrder,
  submitGuestCatalogOrder,
  validatePromoCode,
} from "../services/catalog.service";
import { asyncHandler } from "../utils/async-handler";

export const guestCatalogEnter = asyncHandler(async (req, res) => {
  const body = (req.body ?? {}) as { phone?: string; name?: string; province?: string };
  const result = await recordGuestVisit(String(body.phone ?? ""), { name: body.name, province: body.province });
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

export const getGuestCatalogProducts = asyncHandler(async (_req, res) => {
  const products = await listGuestCatalogProducts();
  res.json({ success: true, data: products });
});

// A signed-in visitor's grid. Same products as guest browsing, but gated on
// their session instead of the shop's open-browsing switch, and carrying
// prices once the shop has unlocked them for this phone.
export const getVisitorCatalogProducts = asyncHandler(async (req, res) => {
  const { requireVisitorSession } = await import("../services/catalog-visitor.service");
  const { listVisitorCatalogProducts } = await import("../services/catalog.service");
  const session = await requireVisitorSession(String(req.query.token ?? ""));
  const products = await listVisitorCatalogProducts({ pricesUnlocked: session.pricesUnlocked });
  res.json({ success: true, data: products });
});

export const getGuestCatalogProductImageCtrl = asyncHandler(async (req, res) => {
  const imageUrl = await getGuestCatalogProductImage(
    String(req.query.id ?? ""),
    String(req.query.visitor ?? ""),
  );
  res.json({ success: true, data: { imageUrl } });
});

export const createGuestCatalogOrder = asyncHandler(async (req, res) => {
  const result = await submitGuestCatalogOrder(req.body);
  res.status(201).json({
    success: true,
    message: "Guest catalog order submitted for approval",
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
