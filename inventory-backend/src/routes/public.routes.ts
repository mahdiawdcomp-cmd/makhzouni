import { Router } from "express";
import { createCatalogOrder, getCatalogProducts } from "../controllers/catalog.controller";
import { getClientPortal } from "../controllers/customer-portal.controller";
import { validate } from "../middleware/validate";
import { createCatalogOrderSchema, portalTokenSchema } from "../utils/schemas";

const router = Router();

router.get("/catalog/products", getCatalogProducts);
router.post("/catalog/orders", validate(createCatalogOrderSchema), createCatalogOrder);
router.get("/client/:token", validate(portalTokenSchema), getClientPortal);

export default router;
