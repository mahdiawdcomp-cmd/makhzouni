import { Router } from "express";
import {
  createCatalogAccessRequest,
  createCatalogOrder,
  getCatalogAccessStatus,
  getCatalogProducts,
  getCatalogSession,
} from "../controllers/catalog.controller";
import { getClientPortal } from "../controllers/customer-portal.controller";
import { validate } from "../middleware/validate";
import {
  catalogAccessQuerySchema,
  catalogAccessRequestSchema,
  catalogAccessStatusSchema,
  createCatalogOrderSchema,
  portalTokenSchema,
} from "../utils/schemas";

const router = Router();

router.post("/catalog/access/request", validate(catalogAccessRequestSchema), createCatalogAccessRequest);
router.get("/catalog/access/status", validate(catalogAccessStatusSchema), getCatalogAccessStatus);
router.get("/catalog/session", validate(catalogAccessQuerySchema), getCatalogSession);
router.get("/catalog/products", validate(catalogAccessQuerySchema), getCatalogProducts);
router.post("/catalog/orders", validate(createCatalogOrderSchema), createCatalogOrder);
router.get("/client/:token", validate(portalTokenSchema), getClientPortal);

export default router;
