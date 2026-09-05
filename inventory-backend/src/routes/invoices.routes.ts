import { Router } from "express";
import {
  addInvoice,
  deleteInvoice,
  editInvoice,
  exportCustomerImageInvoiceExcel,
  exportCustomerImageInvoicePdf,
  exportInvoiceImage,
  exportInvoicePdf,
  getCustomerProductHistoryForProduct,
  getInvoiceAudit,
  getInvoiceDetails,
  getInvoices,
  getLastSoldPriceForProduct,
  getLastSoldPriceOverallForProduct,
  getRecentlyDeletedInvoicesCtrl,
  permanentDeleteInvoice,
  restoreArchivedInvoiceCtrl,
  restoreInvoice,
} from "../controllers/invoices.controller";
import { getInvoiceLabelsPdf } from "../controllers/invoice-labels.controller";
import {
  acknowledgeCountRefund,
  createInvoiceCountLink,
  heartbeatInvoiceEdit,
  listInvoiceCountLinks,
  releaseInvoiceEdit,
  revokeInvoiceCountLink,
} from "../controllers/invoice-count.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { enforcePlanLimit } from "../middleware/tenant.middleware";
import { validate } from "../middleware/validate";
import {
  createInvoiceSchema,
  customerProductHistorySchema,
  idParamSchema,
  lastSoldPriceOverallSchema,
  lastSoldPriceSchema,
  listInvoicesSchema,
  updateInvoiceSchema,
} from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/", validate(listInvoicesSchema), getInvoices);
router.get("/recently-deleted", getRecentlyDeletedInvoicesCtrl);
router.post("/", enforcePlanLimit("invoice"), validate(createInvoiceSchema), addInvoice);
router.get("/last-sold-price", validate(lastSoldPriceSchema), getLastSoldPriceForProduct);
router.get("/last-sold-price-overall", validate(lastSoldPriceOverallSchema), getLastSoldPriceOverallForProduct);
router.get("/customer-product-history", validate(customerProductHistorySchema), getCustomerProductHistoryForProduct);
router.get("/:id/pdf", validate(idParamSchema), exportInvoicePdf);
router.get("/:id/image", validate(idParamSchema), exportInvoiceImage);
router.get("/:id/customer-image-pdf/download", validate(idParamSchema), exportCustomerImageInvoicePdf);
router.get("/:id/customer-image-excel/download", validate(idParamSchema), exportCustomerImageInvoiceExcel);
router.get("/:id/audit-trail", validate(idParamSchema), getInvoiceAudit);
// «جرد الفاتورة» — counting links, their status strip, and the soft editing
// marker the public counting page watches.
router.get("/:id/count-links", validate(idParamSchema), listInvoiceCountLinks);
router.post("/:id/count-links", validate(idParamSchema), createInvoiceCountLink);
router.post("/count-links/:linkId/revoke", revokeInvoiceCountLink);
router.post("/count-links/:linkId/refund-ack", acknowledgeCountRefund);
router.post("/:id/editing/heartbeat", validate(idParamSchema), heartbeatInvoiceEdit);
router.post("/:id/editing/release", validate(idParamSchema), releaseInvoiceEdit);
// Barcode stickers for the goods on this invoice — a download, not a print job.
router.post("/:id/labels.pdf", validate(idParamSchema), getInvoiceLabelsPdf);
router.get("/:id", validate(idParamSchema), getInvoiceDetails);
router.post("/:id/reactivate", validate(idParamSchema), restoreInvoice);
router.post("/:id/restore-archived", validate(idParamSchema), restoreArchivedInvoiceCtrl);
router.delete("/:id/permanent", validate(idParamSchema), permanentDeleteInvoice);
router.put("/:id", validate(updateInvoiceSchema), editInvoice);
router.delete("/:id", validate(idParamSchema), deleteInvoice);

export default router;
