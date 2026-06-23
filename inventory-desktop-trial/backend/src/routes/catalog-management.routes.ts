import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import {
  getCatalogCustomers,
  grantCatalogAccess,
  patchCatalogAccess,
  revokeCatalogAccessCtrl,
} from "../controllers/catalog-management.controller";

const router = Router();

router.use(authMiddleware);

router.get("/", getCatalogCustomers);

// Grant / update / revoke per customer
router.post("/:id/grant", grantCatalogAccess);
router.patch("/:id", patchCatalogAccess);
router.delete("/:id", revokeCatalogAccessCtrl);

export default router;
