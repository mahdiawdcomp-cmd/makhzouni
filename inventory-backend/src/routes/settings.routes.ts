import { Router } from "express";
import {
  getAllSettings,
  updateAppSettings,
  triggerManualBackup,
  triggerDailySummary,
} from "../controllers/settings.controller";
import { adminOnly } from "../middleware/admin-only.middleware";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import { updateSettingsSchema } from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/", getAllSettings);
router.put("/", adminOnly, validate(updateSettingsSchema), updateAppSettings);
router.post("/backup/run", adminOnly, triggerManualBackup);
router.post("/daily-summary/run", adminOnly, triggerDailySummary);

export default router;
