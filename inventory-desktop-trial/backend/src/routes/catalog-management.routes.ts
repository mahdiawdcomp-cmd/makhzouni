import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import {
  getCatalogCustomers,
  getCatalogVisitorsCtrl,
  getVisitorProductViewsCtrl,
  convertVisitorCtrl,
  broadcastVisitorsCtrl,
  getCatalogProductStatsCtrl,
  grantCatalogAccess,
  patchCatalogAccess,
  revokeCatalogAccessCtrl,
} from "../controllers/catalog-management.controller";

const router = Router();

router.use(authMiddleware);

router.get("/visitors", getCatalogVisitorsCtrl);
router.get("/visitors/:phone/views", getVisitorProductViewsCtrl);
router.post("/visitors/broadcast", broadcastVisitorsCtrl);
router.post("/visitors/:phone/convert", convertVisitorCtrl);
router.get("/product-stats", getCatalogProductStatsCtrl);
router.get("/", getCatalogCustomers);

// Grant / update / revoke per customer
router.post("/:id/grant", grantCatalogAccess);
router.patch("/:id", patchCatalogAccess);
router.delete("/:id", revokeCatalogAccessCtrl);

export default router;
