import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import {
  archiveApp,
  getAppCounts,
  getAppRecent,
  getRecent,
  markAllAppRead,
  markAppRead,
  markRecentSeen,
} from "../controllers/notifications.controller";

const router = Router();

router.use(authMiddleware);

// Legacy derived feed (AuditLog / PendingApproval). Its «seen» marker now lives
// on the user, so every device shows the same unread count.
router.get("/recent", getRecent);
router.post("/recent/seen", markRecentSeen);

// New AppNotification center (role-filtered inside the service).
router.get("/app/recent", getAppRecent);
router.get("/app/counts", getAppCounts);
router.post("/app/mark-all-read", markAllAppRead);
router.post("/app/:id/read", markAppRead);
router.post("/app/:id/archive", archiveApp);

export default router;
