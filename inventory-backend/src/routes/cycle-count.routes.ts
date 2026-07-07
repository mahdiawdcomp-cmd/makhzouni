// Routes for "جدولة الجرد الذكي" (/api/cycle-count) — independent from
// /api/stocktake. Admin-only; no public worker link (unlike stocktake).
import { Router } from "express";
import {
  approveItem,
  cancelSession,
  closeSession,
  createSession,
  getSession,
  listSessions,
  rejectItem,
  submitSession,
  updateItem,
} from "../controllers/cycle-count.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/permission.middleware";

const router = Router();

router.use(authMiddleware);

router.get("/", requirePermission("INVENTORY_MANAGE"), listSessions);
router.post("/", requirePermission("INVENTORY_MANAGE"), createSession);
router.get("/:id", requirePermission("INVENTORY_MANAGE"), getSession);
router.patch("/:id/items", requirePermission("INVENTORY_MANAGE"), updateItem);
router.post("/:id/submit", requirePermission("INVENTORY_MANAGE"), submitSession);
router.post("/:id/close", requirePermission("INVENTORY_MANAGE"), closeSession);
router.post("/:id/cancel", requirePermission("INVENTORY_MANAGE"), cancelSession);
router.post("/:id/items/:itemId/approve", requirePermission("INVENTORY_MANAGE"), approveItem);
router.post("/:id/items/:itemId/reject", requirePermission("INVENTORY_MANAGE"), rejectItem);

export default router;
