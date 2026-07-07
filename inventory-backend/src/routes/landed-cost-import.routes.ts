import { Router } from "express";
import multer from "multer";
import {
  cancelBatchCtrl,
  confirmBatchCtrl,
  createBatch,
  downloadLandedCostTemplate,
  getBatchCtrl,
  listBatchesCtrl,
  previewLandedCost,
  setItemDecisionCtrl,
} from "../controllers/landed-cost-import.controller";
import {
  createChinaBatchCtrl,
  downloadChinaTemplate,
  previewChinaOrder,
} from "../controllers/china-order-pricing.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { requireAnyPermission } from "../middleware/permission.middleware";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authMiddleware);
// Deals with purchase cost + creates real purchase invoices — gate behind the
// same capability used elsewhere to view/manage purchase pricing.
router.use(requireAnyPermission("MANAGE_PRODUCTS", "VIEW_PURCHASE_PRICE"));

// China fixed-template flow (the ONLY flow exposed in the UI). Review /
// decisions / cancel / confirm are shared with the batch endpoints below.
router.get("/china/template", downloadChinaTemplate);
router.post("/china/preview", upload.single("file"), previewChinaOrder);
router.post("/china/batches", createChinaBatchCtrl);

// Legacy generic flexible-column flow — kept API-compatible but no longer
// reachable from the UI (replaced by the China fixed template above).
router.get("/template", downloadLandedCostTemplate);
router.post("/preview", upload.single("file"), previewLandedCost);
router.post("/batches", createBatch);
router.get("/batches", listBatchesCtrl);
router.get("/batches/:id", getBatchCtrl);
router.patch("/batches/:id/items/:itemId", setItemDecisionCtrl);
router.post("/batches/:id/cancel", cancelBatchCtrl);
router.post("/batches/:id/confirm", confirmBatchCtrl);

export default router;
