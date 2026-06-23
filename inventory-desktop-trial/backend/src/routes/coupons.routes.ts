import { Router } from "express";
import { addCoupon, applyCoupon, editCoupon, getCoupons } from "../controllers/coupons.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/permission.middleware";
import { validate } from "../middleware/validate";
import { applyCouponSchema, couponSchema, updateCouponSchema } from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/", requirePermission("MANAGE_SETTINGS"), getCoupons);
router.post("/", requirePermission("MANAGE_SETTINGS"), validate(couponSchema), addCoupon);
router.post("/apply", requirePermission("MANAGE_INVOICES"), validate(applyCouponSchema), applyCoupon);
router.put("/:id", requirePermission("MANAGE_SETTINGS"), validate(updateCouponSchema), editCoupon);

export default router;
