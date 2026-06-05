import rateLimit from "express-rate-limit";

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? 100),
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
