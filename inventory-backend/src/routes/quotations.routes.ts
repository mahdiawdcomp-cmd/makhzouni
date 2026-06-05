import { Router } from "express";
import {
  addQuotation,
  convertQuotation,
  editQuotationStatus,
  getQuotationDetails,
  getQuotations,
} from "../controllers/quotations.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/permission.middleware";
import { validate } from "../middleware/validate";
import {
  createQuotationSchema,
  idParamSchema,
  listQuotationsSchema,
  updateQuotationStatusSchema,
} from "../utils/schemas";

const router = Router();

router.use(authMiddleware, requirePermission("MANAGE_INVOICES"));

router.get("/", validate(listQuotationsSchema), getQuotations);
router.post("/", validate(createQuotationSchema), addQuotation);
router.get("/:id", validate(idParamSchema), getQuotationDetails);
router.patch("/:id/status", validate(updateQuotationStatusSchema), editQuotationStatus);
router.post("/:id/convert", validate(idParamSchema), convertQuotation);

export default router;
