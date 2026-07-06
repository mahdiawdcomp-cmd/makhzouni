import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import {
  archiveApp,
  getAppRecent,
  getRecent,
  markAllAppRead,
  markAppRead,
} from "../controllers/notifications.controller";

const router = Router();

router.use(authMiddleware);

// Legacy derived feed (AuditLog / PendingApproval) — kept as-is.
router.get("/recent", getRecent);

// New AppNotification center (role-filtered inside the service).
router.get("/app/recent", getAppRecent);
router.post("/app/mark-all-read", markAllAppRead);
router.post("/app/:id/read", markAppRead);
router.post("/app/:id/archive", archiveApp);

export default router;
