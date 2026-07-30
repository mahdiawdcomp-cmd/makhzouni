import { NextFunction, Request, Response, Router } from "express";
import {
  getAllSettings,
  updateAppSettings,
  triggerManualBackup,
  triggerDailySummary,
  downloadBackup,
  downloadChanges,
  sendTelegramBackup,
  wipeOperational,
  mergeWarehousesHandler,
  getDangerInfo,
} from "../controllers/settings.controller";
import { adminOnly } from "../middleware/admin-only.middleware";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import { updateSettingsSchema } from "../utils/schemas";
import rateLimit from "express-rate-limit";
import { timingSafeEqual } from "node:crypto";

/**
 * Batch 13D — gates the secret-or-admin backup endpoints. Allows either:
 *   A) ?secret= matching BACKUP_SECRET exactly (external scripts), or
 *   B) an authenticated admin session (authMiddleware + adminOnly — the
 *      web/Android "download backup" button, which sends a JWT, no secret).
 * Fails closed (401 UNAUTHORIZED_BACKUP_ACCESS) unless one of the two holds;
 * never reveals which check failed.
 */
function backupSecretMatches(req: Request): boolean {
  const envSecret = process.env.BACKUP_SECRET ?? "";
  if (!envSecret) return false;
  // Header first — the query form is retained for the existing scheduled
  // scripts, but it puts the full-database secret into every access log, so
  // the header is the documented way and the URL is masked by requestLogger.
  const headerValue = req.headers["x-backup-secret"];
  const provided = String(
    (Array.isArray(headerValue) ? headerValue[0] : headerValue) ?? req.query.secret ?? ""
  );
  if (!provided) return false;
  // Constant-time compare so the secret cannot be recovered byte by byte.
  const expectedBuf = Buffer.from(envSecret);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

async function allowBackupAccess(req: Request, res: Response, next: NextFunction) {
  if (backupSecretMatches(req)) {
    next();
    return;
  }

  let authorized = false;
  await new Promise<void>((resolve) => {
    authMiddleware(req, res, (err?: unknown) => {
      if (err) { resolve(); return; }
      adminOnly(req, res, (err2?: unknown) => {
        authorized = !err2;
        resolve();
      });
    });
  });

  if (authorized) {
    next();
    return;
  }
  res.status(401).json({ success: false, error: "UNAUTHORIZED_BACKUP_ACCESS" });
}

// Backup operations are expensive — max 10 per hour per IP
const backupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many backup requests. Try again in an hour.", code: "BACKUP_RATE_LIMITED" },
});

const router = Router();

// Secret-OR-admin-session download. Must be registered BEFORE the blanket
// authMiddleware below so a valid ?secret= still works with no JWT at all
// (allowBackupAccess runs authMiddleware itself for the admin-session path).
router.get("/backup/download", backupLimiter, allowBackupAccess, downloadBackup);
router.get("/backup/changes", backupLimiter, allowBackupAccess, downloadChanges);

router.use(authMiddleware);

router.get("/", getAllSettings);
router.put("/", adminOnly, validate(updateSettingsSchema), updateAppSettings);
router.post("/backup/run", adminOnly, triggerManualBackup);
router.post("/backup/telegram", adminOnly, backupLimiter, sendTelegramBackup);
router.post("/daily-summary/run", adminOnly, triggerDailySummary);

// ── Danger zone (admin only) ────────────────────────────────────────────────
router.get("/danger/info", adminOnly, getDangerInfo);
router.post("/danger/wipe-operational", adminOnly, backupLimiter, wipeOperational);
router.post("/danger/merge-warehouses", adminOnly, mergeWarehousesHandler);

export default router;
