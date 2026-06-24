import { Router } from "express";
import {
  addProduct,
  backfillProductQrs,
  convertVariety,
  editProduct,
  getCartonSheetPdf,
  getDeletedProductsList,
  getPieceLabelPdf,
  getProductByQr,
  getProductDetails,
  getProductQr,
  getProducts,
  removeProduct,
  restoreProductCtrl,
} from "../controllers/products.controller";
import { authMiddleware } from "../middleware/auth.middleware";
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
router.get("/:id/label/carton.pdf", validate(idParamSchema), getCartonSheetPdf);

router.use(authMiddleware);

router.get("/", validate(listProductsSchema), getProducts);
router.post("/", validate(createProductSchema), addProduct);
router.post("/backfill-qr", backfillProductQrs);
router.post("/variety-convert", validate(varietyConvertSchema), convertVariety);
router.get("/deleted", getDeletedProductsList);
router.get("/by-qr/:qrCode", getProductByQr);
router.get("/:id", validate(idParamSchema), getProductDetails);
router.put("/:id", validate(updateProductSchema), editProduct);
router.delete("/:id", validate(idParamSchema), removeProduct);
router.post("/:id/restore", validate(idParamSchema), restoreProductCtrl);

export default router;
