import { Router } from "express";
import {
  getAllSettings,
  updateAppSettings,
  triggerManualBackup,
  triggerDailySummary,
  downloadBackup,
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

// Backup operations are expensive — max 10 per hour per IP
const backupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many backup requests. Try again in an hour.", code: "BACKUP_RATE_LIMITED" },
});

const router = Router();

router.use(authMiddleware);

router.get("/", getAllSettings);
router.put("/", adminOnly, validate(updateSettingsSchema), updateAppSettings);
router.post("/backup/run", adminOnly, triggerManualBackup);
router.get("/backup/download", adminOnly, backupLimiter, downloadBackup);
router.post("/backup/telegram", adminOnly, backupLimiter, sendTelegramBackup);
router.post("/daily-summary/run", adminOnly, triggerDailySummary);

// ── Danger zone (admin only) ────────────────────────────────────────────────
router.get("/danger/info", adminOnly, getDangerInfo);
router.post("/danger/wipe-operational", adminOnly, backupLimiter, wipeOperational);
router.post("/danger/merge-warehouses", adminOnly, mergeWarehousesHandler);

export default router;
