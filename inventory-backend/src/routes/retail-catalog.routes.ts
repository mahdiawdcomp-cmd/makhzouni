import { Router } from "express";
import {
  cancelRetailOrderCtrl,
  getRetailCoupons,
  getRetailItems,
  getRetailOrders,
  patchRetailCoupon,
  patchRetailItem,
  postRetailCoupon,
  postRetailItem,
  prepareRetailOrder,
  removeRetailCoupon,
  removeRetailItem,
} from "../controllers/retail-catalog.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/permission.middleware";
import { validate } from "../middleware/validate";
import {
  createRetailCouponSchema,
  createRetailItemSchema,
  idParamSchema,
  listRetailOrdersSchema,
  updateRetailCouponSchema,
  updateRetailItemSchema,
} from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

// Items
router.get("/items", requirePermission("MANAGE_PRODUCTS"), getRetailItems);
router.post("/items", requirePermission("MANAGE_PRODUCTS"), validate(createRetailItemSchema), postRetailItem);
router.put("/items/:id", requirePermission("MANAGE_PRODUCTS"), validate(updateRetailItemSchema), patchRetailItem);
router.delete("/items/:id", requirePermission("MANAGE_PRODUCTS"), validate(idParamSchema), removeRetailItem);

// Coupons
router.get("/coupons", requirePermission("MANAGE_SETTINGS"), getRetailCoupons);
router.post("/coupons", requirePermission("MANAGE_SETTINGS"), validate(createRetailCouponSchema), postRetailCoupon);
router.put("/coupons/:id", requirePermission("MANAGE_SETTINGS"), validate(updateRetailCouponSchema), patchRetailCoupon);
router.delete("/coupons/:id", requirePermission("MANAGE_SETTINGS"), validate(idParamSchema), removeRetailCoupon);

// Orders
router.get("/orders", requirePermission("MANAGE_INVOICES"), validate(listRetailOrdersSchema), getRetailOrders);
router.post("/orders/:id/prepare", requirePermission("MANAGE_INVOICES"), validate(idParamSchema), prepareRetailOrder);
router.post("/orders/:id/cancel", requirePermission("MANAGE_INVOICES"), validate(idParamSchema), cancelRetailOrderCtrl);

export default router;
