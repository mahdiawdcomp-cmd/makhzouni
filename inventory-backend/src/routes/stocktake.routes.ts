import { Router } from "express";
import {
  closeSession,
  createSession,
  getSession,
  listSessions,
  submitSession,
  updateItem,
  publicGetSession,
  publicScanQr,
  publicSetQty,
  publicSubmit,
} from "../controllers/stocktake.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

// ── Admin routes (auth required) ─────────────────────────────────────────────
router.get("/", authMiddleware, listSessions);
router.post("/", authMiddleware, createSession);
router.get("/:id", authMiddleware, getSession);
router.patch("/:id/items", authMiddleware, updateItem);
router.post("/:id/submit", authMiddleware, submitSession);
router.post("/:id/close", authMiddleware, closeSession);

// ── Public routes (no auth — for workers) ────────────────────────────────────
router.get("/public/:token", publicGetSession);
router.post("/public/:token/scan", publicScanQr);
router.put("/public/:token/item", publicSetQty);
router.post("/public/:token/submit", publicSubmit);

export default router;
