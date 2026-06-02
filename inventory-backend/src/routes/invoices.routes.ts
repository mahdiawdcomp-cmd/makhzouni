import { Router } from "express";
import {
  addInvoice,
  deleteInvoice,
  editInvoice,
  exportInvoiceImage,
  exportInvoicePdf,
  getInvoiceDetails,
  getInvoices,
} from "../controllers/invoices.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import {
  createInvoiceSchema,
  idParamSchema,
  listInvoicesSchema,
  updateInvoiceSchema,
} from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/", validate(listInvoicesSchema), getInvoices);
router.post("/", validate(createInvoiceSchema), addInvoice);
router.get("/:id/pdf", validate(idParamSchema), exportInvoicePdf);
router.get("/:id/image", validate(idParamSchema), exportInvoiceImage);
router.get("/:id", validate(idParamSchema), getInvoiceDetails);
router.put("/:id", validate(updateInvoiceSchema), editInvoice);
router.delete("/:id", validate(idParamSchema), deleteInvoice);

export default router;
