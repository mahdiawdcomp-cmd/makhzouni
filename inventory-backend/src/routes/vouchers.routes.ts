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
} from "../controllers/vouchers.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/permission.middleware";
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
router.post("/", requirePermission("MANAGE_VOUCHERS"), validate(createVoucherSchema), addVoucher);
router.get("/:id/pdf",   validate(idParamSchema), exportVoucherPdf);
router.get("/:id/image", validate(idParamSchema), exportVoucherImage);
router.get("/:id", validate(idParamSchema), getVoucherDetails);
router.post("/:id/cancel", requirePermission("MANAGE_VOUCHERS"), validate(idParamSchema), cancelVoucherCtrl);
router.post("/:id/restore", requirePermission("MANAGE_VOUCHERS"), validate(idParamSchema), restoreVoucherCtrl);
router.put("/:id", requirePermission("MANAGE_VOUCHERS"), validate(updateVoucherSchema), editVoucher);
router.delete("/:id", requirePermission("MANAGE_VOUCHERS"), validate(idParamSchema), removeVoucher);

export default router;
