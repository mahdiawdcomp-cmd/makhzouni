import rateLimit from "express-rate-limit";

// Keyed per IP, and a whole shop (every PC, the rep's phone on the shop Wi-Fi)
// shares one public IP. One dashboard open is ~20 requests, so 100/min locked
// every device out as soon as two screens were busy.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? 600),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again shortly.",
    code: "RATE_LIMITED",
  },
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT_PER_15_MINUTES ?? 5),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: "Too many login attempts. Please try again after 15 minutes.",
    code: "LOGIN_RATE_LIMITED",
  },
});

export const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.REFRESH_RATE_LIMIT_PER_MINUTE ?? 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many refresh requests. Please try again shortly.",
    code: "REFRESH_RATE_LIMITED",
  },
});

// Strict limiter for OTP send endpoint — 10 per IP per hour
export const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP requests from this IP. Try again in an hour.",
    code: "OTP_IP_RATE_LIMITED",
  },
});

// Strict limiter for public catalog endpoints — 60 per IP per minute
export const catalogLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Slow down.",
    code: "CATALOG_RATE_LIMITED",
  },
});

// «مزاد» page polling — every 2 s in the last ten minutes, so two open tabs on
// one shop Wi-Fi already reach the catalog limit exactly when it matters most.
export const auctionReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "طلبات كثيرة — انتظر شوي", code: "AUCTION_RATE_LIMITED" },
});

// «الكشك» — the shop's own screen. Every device in the shop shares one IP
// (the tablet, the PC, the owner's phone on the same Wi-Fi), and one open
// grid asks for its thumbnails in batches, so the catalog's 60/min locked the
// screen out of its own pictures. Reads only; ordering has its own limit.
export const kioskReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "طلبات كثيرة — انتظر شوي", code: "KIOSK_RATE_LIMITED" },
});

// A customer standing at the screen finishes an order every few minutes at
// most. This number only stops a script pointed at a leaked link.
export const kioskOrderLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "طلبات كثيرة بوقت قصير — انتظر دقيقة", code: "KIOSK_ORDER_RATE_LIMITED" },
});

// A person presses «زايد» a few times a minute at most; this only stops scripts.
export const auctionBidLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "مزايدات كثيرة بوقت قصير — انتظر دقيقة", code: "AUCTION_BID_RATE_LIMITED" },
});
