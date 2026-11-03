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
  publicSaveLineCountDraftHandler,
  publicLineCountThumbnailsHandler,
  publicLineCountImageHandler,
  setLineCountBasisHandler,
  reopenLineCountSession,
  deleteLineCountLineHandler,
  editLineCountLineHandler,
  cancelLineCountRecountHandler,
  listLineCountWatchHandler,
  markLineCountGoneHandler,
  requestLineCountRecountHandler,
  setLineCountProductTotalHandler,
  swapLineCountUnitsHandler,
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
  lineCountPublicDraftSchema,
  lineCountPublicThumbnailsSchema,
  lineCountPublicImageSchema,
  lineCountBasisSchema,
  lineCountLineEditSchema,
  lineCountLineParamsSchema,
  lineCountProductTotalSchema,
  lineCountRecountSchema,
  lineCountSwapUnitSchema,
} from "../utils/schemas";

const router = Router();

// ── «جرد بالسطور» — registered before "/:id" so "lines" isn't read as an id ──
router.get("/lines", authMiddleware, requirePermission("INVENTORY_MANAGE"), listLineCountSessions);
router.post("/lines", authMiddleware, requirePermission("INVENTORY_MANAGE"), validate(lineCountCreateSchema), createLineCountSession);
router.get("/lines/watch", authMiddleware, requirePermission("INVENTORY_MANAGE"), listLineCountWatchHandler);
router.get("/lines/:id", authMiddleware, requirePermission("INVENTORY_MANAGE"), getLineCountSession);
router.post("/lines/:id/decision", authMiddleware, requirePermission("INVENTORY_MANAGE"), validate(lineCountDecisionSchema), decideLineCount);
router.post("/lines/:id/finalize", authMiddleware, requirePermission("INVENTORY_MANAGE"), finalizeLineCountSession);
router.post("/lines/:id/cancel", authMiddleware, requirePermission("INVENTORY_MANAGE"), cancelLineCountSession);
router.post("/lines/:id/reopen", authMiddleware, requirePermission("INVENTORY_MANAGE"), reopenLineCountSession);
router.post("/lines/:id/recount", authMiddleware, requirePermission("INVENTORY_MANAGE"), validate(lineCountRecountSchema), requestLineCountRecountHandler);
router.post("/lines/:id/cancel-recount", authMiddleware, requirePermission("INVENTORY_MANAGE"), cancelLineCountRecountHandler);
router.post("/lines/:id/gone", authMiddleware, requirePermission("INVENTORY_MANAGE"), validate(lineCountRecountSchema), markLineCountGoneHandler);
router.patch("/lines/:id/line/:lineId", authMiddleware, requirePermission("INVENTORY_MANAGE"), validate(lineCountLineEditSchema), editLineCountLineHandler);
router.delete("/lines/:id/line/:lineId", authMiddleware, requirePermission("INVENTORY_MANAGE"), validate(lineCountLineParamsSchema), deleteLineCountLineHandler);
router.post("/lines/:id/product/:productId/total", authMiddleware, requirePermission("INVENTORY_MANAGE"), validate(lineCountProductTotalSchema), setLineCountProductTotalHandler);
router.post("/lines/:id/product/:productId/swap-unit", authMiddleware, requirePermission("INVENTORY_MANAGE"), validate(lineCountSwapUnitSchema), swapLineCountUnitsHandler);
router.post("/lines/:id/product/:productId/basis", authMiddleware, requirePermission("INVENTORY_MANAGE"), validate(lineCountBasisSchema), setLineCountBasisHandler);
router.get("/public/lines/:token", publicGetLineCountSession);
router.post("/public/lines/:token/submit", validate(lineCountPublicSubmitSchema), publicSubmitLineCountSession);
router.post("/public/lines/:token/draft", validate(lineCountPublicDraftSchema), publicSaveLineCountDraftHandler);
router.post("/public/lines/:token/thumbnails", validate(lineCountPublicThumbnailsSchema), publicLineCountThumbnailsHandler);
router.get("/public/lines/:token/image/:productId", validate(lineCountPublicImageSchema), publicLineCountImageHandler);

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
