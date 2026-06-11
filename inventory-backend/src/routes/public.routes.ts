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
import { validate } from "../middleware/validate";
import { otpLimiter, catalogLimiter } from "../middleware/rate-limit.middleware";
import {
  catalogAccessQuerySchema,
  catalogAccessRequestSchema,
  catalogAccessStatusSchema,
  createCatalogOrderSchema,
  portalTokenSchema,
  sendOtpSchema,
  verifyOtpSchema,
  checkVerifiedSchema,
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

// Client portal
router.get("/client/:token", validate(portalTokenSchema), getClientPortal);
router.get("/client/:token/invoice/:invoiceId", validate(portalTokenSchema), getClientPortalInvoice);

export default router;
