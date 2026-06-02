import { Router } from "express";
import {
  addVoucher,
  editVoucher,
  exportVoucherImage,
  exportVoucherPdf,
  getVoucherDetails,
  getVouchers,
  removeVoucher,
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
router.post("/", validate(createVoucherSchema), addVoucher);
router.get("/:id/pdf",   validate(idParamSchema), exportVoucherPdf);
router.get("/:id/image", validate(idParamSchema), exportVoucherImage);
router.get("/:id", validate(idParamSchema), getVoucherDetails);
router.put("/:id", validate(updateVoucherSchema), editVoucher);
router.delete("/:id", validate(idParamSchema), removeVoucher);

export default router;
