import { Router } from "express";
import {
  createCatalogAccessRequest,
  createCatalogOrder,
  getCatalogAccessStatus,
  getCatalogProducts,
  getCatalogSession,
} from "../controllers/catalog.controller";
import { sendOtp, confirmOtp, checkVerified } from "../controllers/otp.controller";
import { getClientPortal, getClientPortalInvoice } from "../controllers/customer-portal.controller";
import {
  getPublicActiveCoupon,
  getPublicRetailCatalog,
  getPublicRetailCategories,
  getPublicRetailOrder,
  getPublicStoreInfo,
  postPublicRetailOrder,
  previewPublicCoupon,
} from "../controllers/retail-public.controller";
import { validate } from "../middleware/validate";
import { otpLimiter, catalogLimiter } from "../middleware/rate-limit.middleware";
import prisma from "../config/database";
import { asyncHandler } from "../utils/async-handler";
import {
  catalogAccessQuerySchema,
  catalogAccessRequestSchema,
  catalogAccessStatusSchema,
  createCatalogOrderSchema,
  portalTokenSchema,
  sendOtpSchema,
  verifyOtpSchema,
  checkVerifiedSchema,
  submitRetailOrderSchema,
  previewRetailCouponSchema,
  idParamSchema,
} from "../utils/schemas";

const router = Router();

// OTP verification (strict rate limit on send)
router.post("/otp/send", otpLimiter, validate(sendOtpSchema), sendOtp);
router.post("/otp/verify", catalogLimiter, validate(verifyOtpSchema), confirmOtp);
router.get("/otp/check", catalogLimiter, validate(checkVerifiedSchema), checkVerified);

// Catalog public endpoints
router.post("/catalog/access/request", catalogLimiter, validate(catalogAccessRequestSchema), createCatalogAccessRequest);
router.get("/catalog/access/status", catalogLimiter, validate(catalogAccessStatusSchema), getCatalogAccessStatus);
router.get("/catalog/session", catalogLimiter, validate(catalogAccessQuerySchema), getCatalogSession);
router.get("/catalog/products", catalogLimiter, validate(catalogAccessQuerySchema), getCatalogProducts);
router.post("/catalog/orders", catalogLimiter, validate(createCatalogOrderSchema), createCatalogOrder);

// Retail storefront (كتلوك المفرد) — fully public, no login
router.get("/retail/store-info", catalogLimiter, getPublicStoreInfo);
router.get("/retail/categories", catalogLimiter, getPublicRetailCategories);
router.get("/retail/catalog", catalogLimiter, getPublicRetailCatalog);
router.get("/retail/active-coupon", catalogLimiter, getPublicActiveCoupon);
router.post("/retail/coupon/preview", catalogLimiter, validate(previewRetailCouponSchema), previewPublicCoupon);
router.post("/retail/orders", catalogLimiter, validate(submitRetailOrderSchema), postPublicRetailOrder);
router.get("/retail/orders/:id", catalogLimiter, validate(idParamSchema), getPublicRetailOrder);

// Client portal
router.get("/client/:token", validate(portalTokenSchema), getClientPortal);
router.get("/client/:token/invoice/:invoiceId", validate(portalTokenSchema), getClientPortalInvoice);

// Store display screen — returns basic product info for a TV/display
router.get("/display-products", catalogLimiter, asyncHandler(async (_req, res) => {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      salePrice: true,
      retailPrice: true,
      category: true,
      imageUrl: true,
      itemNumber: true,
      openingBalancePcs: true,
      cartonsAvailable: true,
      pcsPerCarton: true,
    },
    orderBy: { name: "asc" },
    take: 200,
  });

  const settings = await prisma.setting.findMany({
    where: { key: { in: ["storeName", "storeLogo", "currency"] } },
  });
  const kv: Record<string, string> = {};
  for (const s of settings) kv[s.key] = String(s.value ?? "");

  res.json({
    success: true,
    data: {
      storeName: kv.storeName ?? "مخزوني",
      storeLogo: kv.storeLogo ?? "",
      currency: kv.currency ?? "IQD",
      products: products.map((p) => ({
        ...p,
        salePrice: Number(p.salePrice),
        retailPrice: Number(p.retailPrice ?? 0),
        imageUrl: p.imageUrl ?? null,
        currentStock: p.openingBalancePcs + p.cartonsAvailable * p.pcsPerCarton,
      })),
    },
  });
}));

export default router;
