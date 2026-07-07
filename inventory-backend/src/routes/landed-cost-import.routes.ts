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
import { authMiddleware } from "../middleware/auth.middleware";
import { requireAnyPermission } from "../middleware/permission.middleware";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authMiddleware);
// Deals with purchase cost + creates real purchase invoices — gate behind the
// same capability used elsewhere to view/manage purchase pricing.
router.use(requireAnyPermission("MANAGE_PRODUCTS", "VIEW_PURCHASE_PRICE"));

router.get("/template", downloadLandedCostTemplate);
router.post("/preview", upload.single("file"), previewLandedCost);
router.post("/batches", createBatch);
router.get("/batches", listBatchesCtrl);
router.get("/batches/:id", getBatchCtrl);
router.patch("/batches/:id/items/:itemId", setItemDecisionCtrl);
router.post("/batches/:id/cancel", cancelBatchCtrl);
router.post("/batches/:id/confirm", confirmBatchCtrl);

export default router;
