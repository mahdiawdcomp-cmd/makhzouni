import { requirePermission } from "../middleware/permission.middleware";
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
  getCatalogVisitorsCtrl,
  getVisitorProductViewsCtrl,
  convertVisitorCtrl,
  broadcastVisitorsCtrl,
  getCatalogProductStatsCtrl,
} from "../controllers/catalog-management.controller";

const router = Router();

router.use(authMiddleware);
// Every write below is customer-facing: granting wholesale-catalog access,
// broadcasting to the visitor list, minting promo codes, changing the public
// design. authMiddleware alone let any zero-permission staff account do all of
// it, and none of these routes sit behind the approval flow.
router.use((req, res, next) =>
  req.method === "GET" ? next() : requirePermission("MANAGE_CUSTOMERS")(req, res, next),
);

// Guest visitors (phone gate leads)
router.get("/visitors", getCatalogVisitorsCtrl);
router.get("/visitors/:phone/views", getVisitorProductViewsCtrl);
router.post("/visitors/broadcast", broadcastVisitorsCtrl);
router.post("/visitors/:phone/convert", convertVisitorCtrl);

// Catalog product analytics
router.get("/product-stats", getCatalogProductStatsCtrl);

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
