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
