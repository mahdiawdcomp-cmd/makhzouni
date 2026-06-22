import { Router } from "express";
import {
  addInvoice,
  deleteInvoice,
  editInvoice,
  exportInvoiceImage,
  exportInvoicePdf,
  getInvoiceAudit,
  getInvoiceDetails,
  getInvoices,
  getLastSoldPriceForProduct,
  permanentDeleteInvoice,
  restoreInvoice,
} from "../controllers/invoices.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { enforcePlanLimit } from "../middleware/tenant.middleware";
import { validate } from "../middleware/validate";
import {
  createInvoiceSchema,
  idParamSchema,
  lastSoldPriceSchema,
  listInvoicesSchema,
  updateInvoiceSchema,
} from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/", validate(listInvoicesSchema), getInvoices);
router.post("/", enforcePlanLimit("invoice"), validate(createInvoiceSchema), addInvoice);
router.get("/last-sold-price", validate(lastSoldPriceSchema), getLastSoldPriceForProduct);
router.get("/:id/pdf", validate(idParamSchema), exportInvoicePdf);
router.get("/:id/image", validate(idParamSchema), exportInvoiceImage);
router.get("/:id/audit-trail", validate(idParamSchema), getInvoiceAudit);
router.get("/:id", validate(idParamSchema), getInvoiceDetails);
router.post("/:id/reactivate", validate(idParamSchema), restoreInvoice);
router.delete("/:id/permanent", validate(idParamSchema), permanentDeleteInvoice);
router.put("/:id", validate(updateInvoiceSchema), editInvoice);
router.delete("/:id", validate(idParamSchema), deleteInvoice);

export default router;
