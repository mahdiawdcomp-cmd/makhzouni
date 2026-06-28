import { Router } from "express";
import {
  addProduct,
  backfillProductQrs,
  editProduct,
  getCartonSheetPdf,
  getCartonLabelPng,
  getPieceLabelPng,
  openPieceLabelInDLabelCtrl,
  openPieceLabelInDLabelLinkCtrl,
  getPieceLabelPdf,
  getProductByQr,
  getProductDetails,
  getProductQr,
  getProducts,
  removeProduct,
} from "../controllers/products.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import {
  createProductSchema,
  dlabelPieceLabelSchema,
  idParamSchema,
  listProductsSchema,
  updateProductSchema,
} from "../utils/schemas";

const router = Router();

// QR image and PDF label endpoints are public — QR codes are physical stickers,
// anyone with the code can access the image; auth is enforced on data endpoints.
router.get("/:id/qr", validate(idParamSchema), getProductQr);
router.get("/:id/label/piece.pdf", validate(idParamSchema), getPieceLabelPdf);
router.get("/:id/label/piece.png", validate(idParamSchema), getPieceLabelPng);
router.get("/:id/label/carton.pdf", validate(idParamSchema), getCartonSheetPdf);
router.get("/:id/label/carton.png", validate(idParamSchema), getCartonLabelPng);
router.post("/label/piece/dlabel-open", validate(dlabelPieceLabelSchema), openPieceLabelInDLabelCtrl);
router.get("/label/piece/dlabel-open-link", openPieceLabelInDLabelLinkCtrl);

router.use(authMiddleware);

router.get("/", validate(listProductsSchema), getProducts);
router.post("/", validate(createProductSchema), addProduct);
router.post("/backfill-qr", backfillProductQrs);
router.get("/by-qr/:qrCode", getProductByQr);
router.get("/:id", validate(idParamSchema), getProductDetails);
router.put("/:id", validate(updateProductSchema), editProduct);
router.delete("/:id", validate(idParamSchema), removeProduct);

export default router;
