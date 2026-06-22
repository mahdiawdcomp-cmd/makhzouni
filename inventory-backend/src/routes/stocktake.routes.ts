import { Router } from "express";
import {
  approveItem,
  closeSession,
  createSession,
  getSession,
  listSessions,
  rejectItem,
  submitSession,
  updateItem,
  publicGetSession,
  publicScanQr,
  publicSetQty,
  publicSubmit,
} from "../controllers/stocktake.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/permission.middleware";

const router = Router();

// ── Admin routes (auth required) ─────────────────────────────────────────────
router.get("/", authMiddleware, requirePermission("INVENTORY_MANAGE"), listSessions);
router.post("/", authMiddleware, requirePermission("INVENTORY_MANAGE"), createSession);
router.get("/:id", authMiddleware, requirePermission("INVENTORY_MANAGE"), getSession);
router.patch("/:id/items", authMiddleware, requirePermission("INVENTORY_MANAGE"), updateItem);
router.post("/:id/submit", authMiddleware, requirePermission("INVENTORY_MANAGE"), submitSession);
router.post("/:id/close", authMiddleware, requirePermission("INVENTORY_MANAGE"), closeSession);
router.post("/:id/items/:itemId/approve", authMiddleware, requirePermission("INVENTORY_MANAGE"), approveItem);
router.post("/:id/items/:itemId/reject", authMiddleware, requirePermission("INVENTORY_MANAGE"), rejectItem);

// ── Public routes (no auth — for workers) ────────────────────────────────────
router.get("/public/:token", publicGetSession);
router.post("/public/:token/scan", publicScanQr);
router.put("/public/:token/item", publicSetQty);
router.post("/public/:token/submit", publicSubmit);

export default router;
