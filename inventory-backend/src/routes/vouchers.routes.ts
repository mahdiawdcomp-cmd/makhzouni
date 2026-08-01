import { Router } from "express";
import {
  addVoucher,
  cancelVoucherCtrl,
  editVoucher,
  exportVoucherImage,
  exportVoucherPdf,
  getVoucherDetails,
  getVouchers,
  removeVoucher,
  restoreVoucherCtrl,
  sendVoucherPdfWhatsapp,
} from "../controllers/vouchers.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import {
  createVoucherSchema,
  idParamSchema,
  listVouchersSchema,
  updateVoucherSchema,
} from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/", validate(listVouchersSchema), getVouchers);
// NO requirePermission on any mutating voucher route: the controllers already gate
// ADMIN vs STAFF and route an unprivileged STAFF request into the approval
// queue (202 «طلبك قيد المراجعة»). A route-level 403 fired first, so that whole
// branch — and the CREATE_VOUCHER/UPDATE_VOUCHER/DELETE_VOUCHER approval
// workflow behind it — was unreachable from the UI. Mirrors the invoice routes.
router.post("/", validate(createVoucherSchema), addVoucher);
router.get("/:id/pdf",   validate(idParamSchema), exportVoucherPdf);
router.get("/:id/image", validate(idParamSchema), exportVoucherImage);
router.post("/:id/send-whatsapp", validate(idParamSchema), sendVoucherPdfWhatsapp);
router.get("/:id", validate(idParamSchema), getVoucherDetails);
router.post("/:id/cancel", validate(idParamSchema), cancelVoucherCtrl);
router.post("/:id/restore", validate(idParamSchema), restoreVoucherCtrl);
router.put("/:id", validate(updateVoucherSchema), editVoucher);
router.delete("/:id", validate(idParamSchema), removeVoucher);

export default router;
