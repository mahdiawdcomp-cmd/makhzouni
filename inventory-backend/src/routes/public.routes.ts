import { Router, type Request } from "express";
import { timingSafeEqual } from "node:crypto";
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
  getVisitorCatalogProducts,
  guestCatalogEnter,
  trackCatalogProductView,
  postVisitorHeartbeat,
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
import { buildCatalogLayout } from "../services/catalog.service";
import { getSettings } from "../services/settings.service";
import { getCloudDisplayPhoneNumber } from "../services/whatsapp.service";
import { asyncHandler } from "../utils/async-handler";
import { totalStock } from "../utils/product-stock";
import {
  catalogAccessQuerySchema,
  catalogAccessRequestSchema,
  catalogAccessStatusSchema,
  createCatalogOrderSchema,
  createGuestCatalogOrderSchema,
  guestCatalogProductImageSchema,
  trackCatalogViewSchema,
  visitorHeartbeatSchema,
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
  validatePromoSchema,
  retailAiChatSchema,
  guestCatalogEnterSchema,
  catalogProductIdSchema,
  catalogGalleryImageSchema,
  catalogThumbnailsSchema,
  submitProductReviewSchema,
  customerLoginSchema,
  visitorDetailsSchema,
  visitorTokenSchema,
  reserveIncomingSchema,
  visitorTokenQuerySchema,
  visitorPhoneSchema,
} from "../utils/schemas";
import {
  customerLoginCtrl,
  submitVisitorDetailsCtrl,
  visitorSessionCtrl,
  requestPriceAccessCtrl,
  publicIncomingItemsCtrl,
  reserveIncomingCtrl,
  customerAccountCtrl,
} from "../controllers/customer-login.controller";
import {
  getProductDetailCtrl,
  getGalleryImageCtrl,
  getThumbnailsCtrl,
  getMyProductReviewCtrl,
  submitProductReviewCtrl,
} from "../controllers/catalog-product-page.controller";

const router = Router();

// Incoming WhatsApp webhook (Green API) — set this URL in the Green API console.
//
// The handler dispatches OUTBOUND replies based on a sender phone and message
// text that the caller fully controls, so an unauthenticated version of this
// route is a free WhatsApp relay running on the merchant's billed account.
// It is therefore gated on a shared secret the same way the Telegram webhook
// below is, and it fails CLOSED: with no secret configured the endpoint is
// simply off, rather than open to the internet.
//
// Configure GREENAPI_WEBHOOK_SECRET and append `?secret=<value>` to the URL
// registered in the Green API console (or send it as `x-webhook-secret`).
function greenApiWebhookAuthorized(req: Request): boolean {
  const expected = process.env.GREENAPI_WEBHOOK_SECRET?.trim();
  if (!expected) return false;
  const headerValue = req.headers["x-webhook-secret"];
  const provided = String(
    (Array.isArray(headerValue) ? headerValue[0] : headerValue) ?? req.query.secret ?? ""
  );
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

router.post("/whatsapp/incoming-webhook", (req, res, next) => {
  if (!greenApiWebhookAuthorized(req)) {
    // Mirror Telegram's behaviour: acknowledge so the provider does not retry,
    // but do no work. Never reveal whether a secret is configured.
    res.status(200).json({ ok: true });
    return;
  }
  next();
}, whatsappIncomingWebhook);

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
  const settings = await prisma.setting.findMany({
    where: {
      OR: [
        { key: { startsWith: "catalogDesign" } },
        // Not catalogDesign* keys, but the code-request button below needs
        // them — without this they silently read as undefined and the button
        // fell back to a hardcoded keyword instead of the configured one.
        { key: { in: ["storefrontInviteKeywords", "catalogAdminWhatsappNumber", "storePhone", "catalogAnnouncementEnabled", "catalogAnnouncementText"] } },
      ],
    },
  });
  const kv: Record<string, unknown> = {};
  for (const s of settings) {
    // Prisma already decodes the Json column, so re-parsing it was pure noise
    // that only ever corrupted values: a digits-only string like a WhatsApp
    // number ("9647701234567") round-tripped into a *number*, while every
    // other value threw and fell back to the correct one. getSettings() reads
    // these rows raw for exactly this reason — match it.
    kv[s.key] = s.value;
  }
  const guestModeEnabled = await isGuestCatalogEnabled();
  const businessNumber = await getCloudDisplayPhoneNumber().catch(() => null);
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
      footer: {
        enabled: kv.catalogDesignFooterEnabled ?? true,
        about: (kv.catalogDesignFooterAbout as string) ?? "",
        phone: (kv.catalogDesignFooterPhone as string) ?? "",
        whatsapp: (kv.catalogDesignFooterWhatsapp as string) ?? "",
        address: (kv.catalogDesignFooterAddress as string) ?? "",
        hours: (kv.catalogDesignFooterHours as string) ?? "",
        instagram: (kv.catalogDesignFooterInstagram as string) ?? "",
        facebook: (kv.catalogDesignFooterFacebook as string) ?? "",
        telegram: (kv.catalogDesignFooterTelegram as string) ?? "",
        tiktok: (kv.catalogDesignFooterTiktok as string) ?? "",
        deliveryAreas: (kv.catalogDesignFooterDeliveryAreas as string) ?? "",
        deliveryTime: (kv.catalogDesignFooterDeliveryTime as string) ?? "",
        minOrder: (kv.catalogDesignFooterMinOrder as string) ?? "",
        cashOnDelivery: kv.catalogDesignFooterCashOnDelivery ?? false,
      },
      trust: {
        badges: [
          { enabled: kv.catalogDesignTrust1Enabled ?? false, text: (kv.catalogDesignTrust1Text as string) ?? "" },
          { enabled: kv.catalogDesignTrust2Enabled ?? false, text: (kv.catalogDesignTrust2Text as string) ?? "" },
          { enabled: kv.catalogDesignTrust3Enabled ?? false, text: (kv.catalogDesignTrust3Text as string) ?? "" },
        ],
        lowStockCartons: (kv.catalogDesignLowStockCartons as number) ?? 0,
      },
      // «اطلب رمزي» — a wa.me link that pre-fills the exact keyword the
      // inbound handler matches, so tapping it and hitting send is the whole
      // flow: the message opens Meta's 24h window and the code comes back
      // automatically. Blank whatsapp = the button is simply not rendered.
      codeRequest: (() => {
        // The bot only hears messages sent to the Cloud API business number.
        // The footer number is whatever the merchant typed for display, and
        // on this account the two differ — pointing the button at the footer
        // number sent shoppers to a chat nothing was listening on, so no code
        // ever came back. Meta's own number wins; the typed ones are the
        // fallback for a shop with no Cloud number configured.
        const raw = String(
          businessNumber ||
          (kv.catalogDesignFooterWhatsapp as string) ||
          (kv.catalogAdminWhatsappNumber as string) ||
          (kv.storePhone as string) || "",
        ).trim();
        let digits = raw.replace(/\D/g, "");
        if (digits.startsWith("00")) digits = digits.slice(2);
        if (digits.startsWith("0")) digits = `964${digits.slice(1)}`;
        else if (digits.startsWith("7")) digits = `964${digits}`;
        const keywords = (kv.storefrontInviteKeywords as string[]) ?? [];
        const keyword = (keywords.find((k) => String(k).trim()) ?? "حسابي").trim();
        return digits ? { whatsapp: digits, keyword } : null;
      })(),
      // Layout + wording + feature switches, from the one builder the
      // signed-in session also uses — two payloads that drifted would let the
      // same shop look different to a customer and to a visitor.
      ...buildCatalogLayout(await getSettings()),
      guestModeEnabled,
    },
  });
}));

// Storefront login — phone + 6-digit code. Behind the catalog rate limiter,
// which together with the per-account lockout is what makes a 6-digit secret
// safe to use as a standing credential.
router.post("/catalog/login", catalogLimiter, validate(customerLoginSchema), customerLoginCtrl);
router.post("/catalog/signup-details", catalogLimiter, validate(visitorDetailsSchema), submitVisitorDetailsCtrl);
// A signed-in visitor: their own session, their grid, and asking for prices.
router.get("/catalog/visitor-session", catalogLimiter, validate(visitorTokenQuerySchema), visitorSessionCtrl);
router.get("/catalog/visitor-products", catalogLimiter, validate(visitorTokenQuerySchema), getVisitorCatalogProducts);
router.post("/catalog/request-prices", catalogLimiter, validate(visitorTokenSchema), requestPriceAccessCtrl);

// «احجز البضاعة القادمة الجديدة» — goods bought but not yet received.
router.get("/catalog/incoming", catalogLimiter, publicIncomingItemsCtrl);
router.post("/catalog/incoming/reserve", catalogLimiter, validate(reserveIncomingSchema), reserveIncomingCtrl);
// The signed-in customer's own account — same data the /client/:token portal
// serves, reached with the catalog token instead of a second link.
router.get("/catalog/account", catalogLimiter, validate(catalogAccessQuerySchema), customerAccountCtrl);

// Catalog product page. Token in ?access when the shopper came through a
// customer link; without one the controller falls back to guest mode, which
// the service refuses unless the shop enabled open browsing.
router.get("/catalog/product/:id", catalogLimiter, validate(catalogProductIdSchema), getProductDetailCtrl);
router.post("/catalog/thumbnails", catalogLimiter, validate(catalogThumbnailsSchema), getThumbnailsCtrl);
router.get("/catalog/product/:id/image/:imageId", catalogLimiter, validate(catalogGalleryImageSchema), getGalleryImageCtrl);
router.get("/catalog/product/:id/my-review", catalogLimiter, validate(catalogProductIdSchema), getMyProductReviewCtrl);
router.post("/catalog/product/:id/review", catalogLimiter, validate(submitProductReviewSchema), submitProductReviewCtrl);

// Catalog public endpoints
router.post("/catalog/access/request", catalogLimiter, validate(catalogAccessRequestSchema), createCatalogAccessRequest);
router.get("/catalog/access/status", catalogLimiter, validate(catalogAccessStatusSchema), getCatalogAccessStatus);
router.get("/catalog/session", catalogLimiter, validate(catalogAccessQuerySchema), getCatalogSession);
// Re-verify an existing access link after OTP (6-month window) — same token, no new admin approval
router.post("/catalog/access/verify", catalogLimiter, validate(catalogAccessQuerySchema), verifyCatalogAccessCtrl);
router.get("/catalog/products", catalogLimiter, validate(catalogAccessQuerySchema), getCatalogProducts);
router.get("/catalog/product-image", catalogLimiter, validate(catalogAccessQuerySchema), getCatalogProductImageCtrl);
router.post("/catalog/orders", catalogLimiter, validate(createCatalogOrderSchema), createCatalogOrder);
router.post("/catalog/validate-promo", catalogLimiter, validate(validatePromoSchema), validatePromoCtrl);

// Guest catalog (no OTP/access token) — only served when the merchant has
// turned off catalogRequireOtp; the service layer enforces that, not the route.
router.post("/catalog/guest-enter", catalogLimiter, validate(guestCatalogEnterSchema), guestCatalogEnter);
router.post("/catalog/track-view", catalogLimiter, validate(trackCatalogViewSchema), trackCatalogProductView);
router.post("/catalog/visitor-heartbeat", catalogLimiter, validate(visitorHeartbeatSchema), postVisitorHeartbeat);
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
router.get("/retail/my-referral/:token", catalogLimiter, getPublicCustomerReferral);
router.post("/retail/ai-chat", catalogLimiter, validate(retailAiChatSchema), postPublicRetailAiChat);

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
      warehouseStocks: { select: { quantityPieces: true } },
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
      products: products.map(({ warehouseStocks, ...p }) => ({
        ...p,
        salePrice: Number(p.salePrice),
        retailPrice: Number(p.retailPrice ?? 0),
        imageUrl: p.imageUrl ?? null,
        currentStock: totalStock({ ...p, warehouseStocks }),
      })),
    },
  });
}));

export default router;
