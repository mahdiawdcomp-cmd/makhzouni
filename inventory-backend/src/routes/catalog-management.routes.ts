import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import {
  getCatalogCustomers,
  grantCatalogAccess,
  patchCatalogAccess,
  revokeCatalogAccessCtrl,
  listPromoCodesCtrl,
  createPromoCodeCtrl,
  deletePromoCodeCtrl,
  togglePromoCodeCtrl,
  getCatalogDesignCtrl,
  updateCatalogDesignCtrl,
} from "../controllers/catalog-management.controller";

const router = Router();

router.use(authMiddleware);

// Customers
router.get("/", getCatalogCustomers);
router.post("/:id/grant", grantCatalogAccess);
router.patch("/:id", patchCatalogAccess);
router.delete("/:id", revokeCatalogAccessCtrl);

// Promo codes
router.get("/promo-codes", listPromoCodesCtrl);
router.post("/promo-codes", createPromoCodeCtrl);
router.delete("/promo-codes/:id", deletePromoCodeCtrl);
router.patch("/promo-codes/:id/toggle", togglePromoCodeCtrl);

// Design settings
router.get("/design", getCatalogDesignCtrl);
router.put("/design", updateCatalogDesignCtrl);

export default router;
