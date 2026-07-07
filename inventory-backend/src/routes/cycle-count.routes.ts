// Routes for "جدولة الجرد الذكي" (/api/cycle-count) — independent from
// /api/stocktake. Admin routes require auth; the /public/:token routes are the
// no-login worker counting link (mirroring stocktake's /stocktake/public/:token
// shape, but systemQty is never exposed and the session is never auto-closed
// by the worker — only admin closes/cancels).
import { Router } from "express";
import {
  approveAllItems,
  approveItem,
  cancelSession,
  closeSession,
  createSession,
  getSession,
  listSessions,
  publicGetSession,
  publicScanQr,
  publicSetQty,
  publicSubmit,
  rejectAllItems,
  rejectItem,
  reopenSession,
  submitSession,
  updateItem,
} from "../controllers/cycle-count.controller";
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
router.post("/:id/cancel", authMiddleware, requirePermission("INVENTORY_MANAGE"), cancelSession);
router.post("/:id/reopen", authMiddleware, requirePermission("INVENTORY_MANAGE"), reopenSession);
router.post("/:id/items/:itemId/approve", authMiddleware, requirePermission("INVENTORY_MANAGE"), approveItem);
router.post("/:id/items/:itemId/reject", authMiddleware, requirePermission("INVENTORY_MANAGE"), rejectItem);
router.post("/:id/approve-all", authMiddleware, requirePermission("INVENTORY_MANAGE"), approveAllItems);
router.post("/:id/reject-all", authMiddleware, requirePermission("INVENTORY_MANAGE"), rejectAllItems);

// ── Public (worker, no auth) ─────────────────────────────────────────────────
router.get("/public/:token", publicGetSession);
router.post("/public/:token/scan", publicScanQr);
router.put("/public/:token/item", publicSetQty);
router.post("/public/:token/submit", publicSubmit);

export default router;
