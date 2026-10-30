import { Router } from "express";
import {
  approveAllItems,
  approveItem,
  archiveSession,
  closeSession,
  createSession,
  getSession,
  listSessions,
  rejectAllItems,
  rejectItem,
  reopenSession,
  submitSession,
  updateItem,
  publicGetSession,
  publicScanQr,
  publicSetQty,
  publicSubmit,
  publicClose,
} from "../controllers/stocktake.controller";
import {
  cancelLineCountSession,
  createLineCountSession,
  decideLineCount,
  finalizeLineCountSession,
  getLineCountSession,
  listLineCountSessions,
  publicGetLineCountSession,
  publicSubmitLineCountSession,
  reopenLineCountSession,
} from "../controllers/line-count.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/permission.middleware";
import { validate } from "../middleware/validate";
import {
  stocktakeApproveAllSchema,
  stocktakeApproveItemSchema,
  stocktakeArchiveSchema,
  stocktakeCloseSchema,
  stocktakePublicScanSchema,
  stocktakePublicSetQtySchema,
  stocktakeUpdateItemSchema,
  lineCountCreateSchema,
  lineCountDecisionSchema,
  lineCountPublicSubmitSchema,
} from "../utils/schemas";

const router = Router();

// ── «جرد بالسطور» — registered before "/:id" so "lines" isn't read as an id ──
router.get("/lines", authMiddleware, requirePermission("INVENTORY_MANAGE"), listLineCountSessions);
router.post("/lines", authMiddleware, requirePermission("INVENTORY_MANAGE"), validate(lineCountCreateSchema), createLineCountSession);
router.get("/lines/:id", authMiddleware, requirePermission("INVENTORY_MANAGE"), getLineCountSession);
router.post("/lines/:id/decision", authMiddleware, requirePermission("INVENTORY_MANAGE"), validate(lineCountDecisionSchema), decideLineCount);
router.post("/lines/:id/finalize", authMiddleware, requirePermission("INVENTORY_MANAGE"), finalizeLineCountSession);
router.post("/lines/:id/cancel", authMiddleware, requirePermission("INVENTORY_MANAGE"), cancelLineCountSession);
router.post("/lines/:id/reopen", authMiddleware, requirePermission("INVENTORY_MANAGE"), reopenLineCountSession);
router.get("/public/lines/:token", publicGetLineCountSession);
router.post("/public/lines/:token/submit", validate(lineCountPublicSubmitSchema), publicSubmitLineCountSession);

// ── Admin routes (auth required) ─────────────────────────────────────────────
router.get("/", authMiddleware, requirePermission("INVENTORY_MANAGE"), listSessions);
router.post("/", authMiddleware, requirePermission("INVENTORY_MANAGE"), createSession);
router.get("/:id", authMiddleware, requirePermission("INVENTORY_MANAGE"), getSession);
router.patch("/:id/items", authMiddleware, requirePermission("INVENTORY_MANAGE"), validate(stocktakeUpdateItemSchema), updateItem);
router.post("/:id/submit", authMiddleware, requirePermission("INVENTORY_MANAGE"), submitSession);
router.post("/:id/close", authMiddleware, requirePermission("INVENTORY_MANAGE"), validate(stocktakeCloseSchema), closeSession);
router.post("/:id/archive", authMiddleware, requirePermission("INVENTORY_MANAGE"), validate(stocktakeArchiveSchema), archiveSession);
router.post("/:id/reopen", authMiddleware, requirePermission("INVENTORY_MANAGE"), reopenSession);
router.post("/:id/items/:itemId/approve", authMiddleware, requirePermission("INVENTORY_MANAGE"), validate(stocktakeApproveItemSchema), approveItem);
router.post("/:id/items/:itemId/reject", authMiddleware, requirePermission("INVENTORY_MANAGE"), rejectItem);
router.post("/:id/approve-all", authMiddleware, requirePermission("INVENTORY_MANAGE"), validate(stocktakeApproveAllSchema), approveAllItems);
router.post("/:id/reject-all", authMiddleware, requirePermission("INVENTORY_MANAGE"), rejectAllItems);

// ── Public routes (no auth — for workers) ────────────────────────────────────
router.get("/public/:token", publicGetSession);
router.post("/public/:token/scan", validate(stocktakePublicScanSchema), publicScanQr);
router.put("/public/:token/item", validate(stocktakePublicSetQtySchema), publicSetQty);
router.post("/public/:token/submit", publicSubmit);
router.post("/public/:token/close", publicClose);

export default router;
