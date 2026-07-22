import { Router } from "express";
import {
  createCatalogAccessRequest,
  createCatalogOrder,
  createGuestCatalogOrder,
  getCatalogAccessStatus,
  getCatalogProductImageCtrl,
  getCatalogProducts,
  getCatalogSession,
  getGuestCatalogProductImageCtrl,
  getGuestCatalogProducts,
  guestCatalogEnter,
  trackCatalogProductView,
  validatePromoCtrl,
  verifyCatalogAccessCtrl,
} from "../controllers/catalog.controller";
import { isGuestCatalogEnabled } from "../services/catalog.service";
import { sendOtp, confirmOtp, checkVerified } from "../controllers/otp.controller";
import {
  whatsappIncomingWebhook,
  whatsappMetaWebhookVerify,
  whatsappMetaWebhookReceive,
} from "../controllers/whatsapp.controller";
import {
  getClientPortal,
  getClientPortalInvoice,
  getClientPortalOrders,
  postArrivalSubscribe,
  getArrivalSubscriptions,
  deleteArrivalSubscription,
  getVapidKey,
} from "../controllers/customer-portal.controller";
import {
  getPublicActiveCoupon,
  getPublicCustomerReferral,
  getPublicReferralInfo,
  getPublicRetailCatalog,
  getPublicRetailCategories,
  getPublicRetailOrder,
  getPublicRetailOrdersByPhone,
  getPublicRetailOrdersByToken,
  getPublicStoreInfo,
  postPublicRetailAiChat,
  postPublicRetailOrder,
  postPublicCartSession,
  postPublicSearchMiss,
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
  createGuestCatalogOrderSchema,
  guestCatalogProductImageSchema,
  portalTokenSchema,
  portalInvoiceSchema,
  portalArrivalDeleteSchema,
  sendOtpSchema,
  verifyOtpSchema,
  checkVerifiedSchema,
  submitRetailOrderSchema,
  previewRetailCouponSchema,
  cartSessionSchema,
  searchMissSchema,
  idParamSchema,
} from "../utils/schemas";

const router = Router();

// Incoming WhatsApp webhook (Green API) — set this URL in the Green API console.
router.post("/whatsapp/incoming-webhook", whatsappIncomingWebhook);

// Meta WhatsApp Cloud API webhook (single URL, GET verify + POST receive).
// Runs in parallel with the Green API webhook above.
router.get("/whatsapp/meta-webhook", whatsappMetaWebhookVerify);
router.post("/whatsapp/meta-webhook", whatsappMetaWebhookReceive);

// «بوت تيليگرام» webhook — registered automatically by the channel sync worker
// (ensureWebhook). Verified by the secret header Telegram echoes back; wrong or
// missing secret is silently dropped. Responds 200 immediately and processes
// the update async so Telegram never retries due to slow handlers.
router.post("/telegram/webhook", asyncHandler(async (req, res) => {
  const { getTelegramWebhookSecret } = await import("../services/telegram-channel.service");
  const secret = await getTelegramWebhookSecret();
  if (req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    res.status(200).json({ ok: true });
    return;
  }
  const update = req.body;
  setImmediate(async () => {
    const { handleTelegramUpdate } = await import("../services/telegram-bot.service");
    await handleTelegramUpdate(update).catch((err) =>
      console.error("[TelegramBot] webhook update failed:", err),
    );
  });
  res.status(200).json({ ok: true });
}));

// Public media by unguessable token — video playback in the catalog admin and
// the URL Meta pulls Instagram media from (images are ephemeral JPEG copies).
// Range support so <video> seeking works in the browser.
router.get("/media/:token", asyncHandler(async (req, res) => {
  const { getMediaAssetByToken } = await import("../services/media-asset.service");
  const asset = await getMediaAssetByToken(String(req.params.token));
  if (!asset) { res.status(404).json({ message: "Not found" }); return; }
  const total = asset.bytes.length;
  res.setHeader("Content-Type", asset.mime);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=3600");
  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? parseInt(match[1], 10) : 0;
    const end = match?.[2] ? Math.min(parseInt(match[2], 10), total - 1) : total - 1;
    if (start >= total || start > end) { res.status(416).setHeader("Content-Range", `bytes */${total}`).end(); return; }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Content-Length", end - start + 1);
    res.end(Buffer.from(asset.bytes.subarray(start, end + 1)));
    return;
  }
  res.setHeader("Content-Length", total);
  res.end(Buffer.from(asset.bytes));
}));

// Instagram OAuth callback (Meta redirects here) → connects accounts, then
// bounces the admin back to the web settings page.
router.get("/instagram/oauth-callback", asyncHandler(async (req, res) => {
  const { handleOauthCallback } = await import("../services/instagram.service");
  // returnTo is a FULL https URL sent by the tenant's own web app (kept in
  // state) — never hardcode a tenant domain here.
  const fallback = process.env.FRONTEND_PUBLIC_URL?.trim() || "";
  const safeUrl = (u: string) => (/^https:\/\/[\w.-]+(\/|$)/.test(u) ? u : fallback);
  const state = typeof req.query.state === "string" ? req.query.state : "";
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) throw new Error("missing code");
    const returnTo = safeUrl(await handleOauthCallback(code, state));
    res.redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}igconnect=ok`);
  } catch (error) {
    let returnTo = fallback;
    try {
      returnTo = safeUrl((JSON.parse(Buffer.from(state, "base64url").toString()) as { returnTo?: string }).returnTo || fallback);
    } catch { /* keep fallback */ }
    const msg = encodeURIComponent(error instanceof Error ? error.message : "connect failed");
    res.redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}igconnect=error&igerror=${msg}`);
  }
}));

// OTP verification (strict rate limit on send)
router.post("/otp/send", otpLimiter, validate(sendOtpSchema), sendOtp);
router.post("/otp/verify", catalogLimiter, validate(verifyOtpSchema), confirmOtp);
router.get("/otp/check", catalogLimiter, validate(checkVerifiedSchema), checkVerified);

// Catalog design (public — no auth needed)
router.get("/catalog/design", catalogLimiter, asyncHandler(async (_req, res) => {
  const settings = await prisma.setting.findMany({ where: { key: { startsWith: "catalogDesign" } } });
  const kv: Record<string, unknown> = {};
  for (const s of settings) {
    try { kv[s.key] = JSON.parse(String(s.value)); } catch { kv[s.key] = s.value; }
  }
  const guestModeEnabled = await isGuestCatalogEnabled();
  res.json({
    success: true,
    data: {
      primaryColor: (kv.catalogDesignPrimaryColor as string) ?? null,
      bgColor: (kv.catalogDesignBgColor as string) ?? null,
      defaultTheme: (kv.catalogDesignDefaultTheme as string) ?? "clean",
      logoUrl: (kv.catalogDesignLogoUrl as string) ?? null,
      welcomeMessage: (kv.catalogDesignWelcomeMessage as string) ?? null,
      bannerEnabled: kv.catalogDesignBannerEnabled ?? true,
      bannerImages: (kv.catalogDesignBannerImages as Array<{ url: string; title: string; order: number }>) ?? [],
      guestModeEnabled,
    },
  });
}));

// Catalog public endpoints
router.post("/catalog/access/request", catalogLimiter, validate(catalogAccessRequestSchema), createCatalogAccessRequest);
router.get("/catalog/access/status", catalogLimiter, validate(catalogAccessStatusSchema), getCatalogAccessStatus);
router.get("/catalog/session", catalogLimiter, validate(catalogAccessQuerySchema), getCatalogSession);
// Re-verify an existing access link after OTP (6-month window) — same token, no new admin approval
router.post("/catalog/access/verify", catalogLimiter, validate(catalogAccessQuerySchema), verifyCatalogAccessCtrl);
router.get("/catalog/products", catalogLimiter, validate(catalogAccessQuerySchema), getCatalogProducts);
router.get("/catalog/product-image", catalogLimiter, validate(catalogAccessQuerySchema), getCatalogProductImageCtrl);
router.post("/catalog/orders", catalogLimiter, validate(createCatalogOrderSchema), createCatalogOrder);
router.post("/catalog/validate-promo", catalogLimiter, validatePromoCtrl);

// Guest catalog (no OTP/access token) — only served when the merchant has
// turned off catalogRequireOtp; the service layer enforces that, not the route.
router.post("/catalog/guest-enter", catalogLimiter, guestCatalogEnter);
router.post("/catalog/track-view", catalogLimiter, trackCatalogProductView);
router.get("/catalog/guest-products", catalogLimiter, getGuestCatalogProducts);
router.get("/catalog/guest-product-image", catalogLimiter, validate(guestCatalogProductImageSchema), getGuestCatalogProductImageCtrl);
router.post("/catalog/guest-orders", catalogLimiter, validate(createGuestCatalogOrderSchema), createGuestCatalogOrder);

// Retail storefront (كتلوك المفرد) — fully public, no login
router.get("/retail/store-info", catalogLimiter, getPublicStoreInfo);
router.get("/retail/categories", catalogLimiter, getPublicRetailCategories);
router.get("/retail/catalog", catalogLimiter, getPublicRetailCatalog);
router.get("/retail/active-coupon", catalogLimiter, getPublicActiveCoupon);
router.post("/retail/coupon/preview", catalogLimiter, validate(previewRetailCouponSchema), previewPublicCoupon);
router.post("/retail/orders", catalogLimiter, validate(submitRetailOrderSchema), postPublicRetailOrder);
router.post("/retail/cart-session", catalogLimiter, validate(cartSessionSchema), postPublicCartSession);
router.post("/retail/search-miss", catalogLimiter, validate(searchMissSchema), postPublicSearchMiss);
// Removed GET /retail/my-orders?phone=... (privacy: exposed order history by phone without auth)
// Use the token-based endpoint instead: GET /retail/my-orders/:token
router.get("/retail/my-orders/:token", catalogLimiter, getPublicRetailOrdersByToken);
// Removed GET /retail/orders/:id (privacy: exposed individual orders without any authorization)
router.get("/retail/referral/:code", catalogLimiter, getPublicReferralInfo);
router.get("/retail/my-referral", catalogLimiter, getPublicCustomerReferral);
router.post("/retail/ai-chat", catalogLimiter, postPublicRetailAiChat);

// Client portal
router.get("/client/:token", validate(portalTokenSchema), getClientPortal);
router.get("/client/:token/invoice/:invoiceId", validate(portalInvoiceSchema), getClientPortalInvoice);
router.get("/client/:token/orders", validate(portalTokenSchema), getClientPortalOrders);
router.get("/client/:token/arrivals", validate(portalTokenSchema), getArrivalSubscriptions);
router.post("/client/:token/arrivals", validate(portalTokenSchema), postArrivalSubscribe);
router.delete("/client/:token/arrivals/:subId", validate(portalArrivalDeleteSchema), deleteArrivalSubscription);
router.get("/vapid-key", getVapidKey);

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
