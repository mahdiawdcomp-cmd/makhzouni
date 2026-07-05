import { Router } from "express";
import {
  addProduct,
  adjustStock,
  getManualAdjustments,
  getStockHistory,
  backfillProductQrs,
  backfillThumbs,
  bulkDelete,
  convertVariety,
  editProduct,
  getCartonSheetPdf,
  getCartonLabelPng,
  getDeletedProductsList,
  getPieceLabelPdf,
  getPieceLabelPng,
  getProductByQr,
  getProductDetails,
  getProductQr,
  getProducts,
  getStale,
  removeProduct,
  restoreProductCtrl,
} from "../controllers/products.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middleware/permission.middleware";
import { validate } from "../middleware/validate";
import {
  createProductSchema,
  idParamSchema,
  listProductsSchema,
  updateProductSchema,
  varietyConvertSchema,
} from "../utils/schemas";

const router = Router();

// QR image and PDF label endpoints are public — QR codes are physical stickers,
// anyone with the code can access the image; auth is enforced on data endpoints.
router.get("/:id/qr", validate(idParamSchema), getProductQr);
router.get("/:id/label/piece.pdf", validate(idParamSchema), getPieceLabelPdf);
router.get("/:id/label/piece.png", validate(idParamSchema), getPieceLabelPng);
router.get("/:id/label/carton.pdf", validate(idParamSchema), getCartonSheetPdf);
router.get("/:id/label/carton.png", validate(idParamSchema), getCartonLabelPng);

router.use(authMiddleware);

router.get("/", validate(listProductsSchema), getProducts);
// POST / PUT / DELETE on products intentionally have NO requirePermission here:
// the controller routes STAFF without MANAGE_PRODUCTS into a PendingApproval
// (202) instead of executing — adding a 403 guard would break that flow.
router.post("/", validate(createProductSchema), addProduct);
router.post("/backfill-qr", requirePermission("MANAGE_PRODUCTS"), backfillProductQrs);
router.post("/backfill-thumbnails", requirePermission("MANAGE_PRODUCTS"), backfillThumbs);
router.post("/variety-convert", requireAnyPermission("VARIETY_CONVERT", "MANAGE_PRODUCTS"), validate(varietyConvertSchema), convertVariety);
router.get("/stale", getStale);
router.post("/bulk-delete", requirePermission("MANAGE_PRODUCTS"), bulkDelete);
router.get("/deleted", requirePermission("MANAGE_PRODUCTS"), getDeletedProductsList);
router.get("/by-qr/:qrCode", getProductByQr);
router.get("/:id", validate(idParamSchema), getProductDetails);
router.get("/:id/manual-adjustments", validate(idParamSchema), getManualAdjustments);
router.get("/:id/stock-history", validate(idParamSchema), getStockHistory);
router.post("/:id/adjust-stock", requireAnyPermission("INVENTORY_MANAGE", "MANAGE_PRODUCTS"), validate(idParamSchema), adjustStock);
router.put("/:id", validate(updateProductSchema), editProduct);
router.delete("/:id", validate(idParamSchema), removeProduct);
router.post("/:id/restore", requirePermission("MANAGE_PRODUCTS"), validate(idParamSchema), restoreProductCtrl);

export default router;
