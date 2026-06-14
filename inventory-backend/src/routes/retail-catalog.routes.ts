import { Router } from "express";
import {
  cancelRetailOrderCtrl,
  getRetailCategories,
  getRetailCoupons,
  getRetailCustomers,
  getRetailItems,
  getRetailOrders,
  getRetailReferralSettingsCtrl,
  patchRetailCategory,
  patchRetailCoupon,
  patchRetailItem,
  postRetailBroadcast,
  postRetailCategory,
  postRetailCoupon,
  postRetailItem,
  prepareRetailOrder,
  putRetailReferralSettingsCtrl,
  removeRetailCategory,
  removeRetailCoupon,
  removeRetailItem,
} from "../controllers/retail-catalog.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/permission.middleware";
import { validate } from "../middleware/validate";
import {
  createRetailCategorySchema,
  createRetailCouponSchema,
  createRetailItemSchema,
  idParamSchema,
  listRetailOrdersSchema,
  retailBroadcastSchema,
  updateRetailCategorySchema,
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

// Categories
router.get("/categories", requirePermission("MANAGE_PRODUCTS"), getRetailCategories);
router.post("/categories", requirePermission("MANAGE_PRODUCTS"), validate(createRetailCategorySchema), postRetailCategory);
router.put("/categories/:id", requirePermission("MANAGE_PRODUCTS"), validate(updateRetailCategorySchema), patchRetailCategory);
router.delete("/categories/:id", requirePermission("MANAGE_PRODUCTS"), validate(idParamSchema), removeRetailCategory);

// Customers + broadcast
router.get("/customers", requirePermission("MANAGE_PRODUCTS"), getRetailCustomers);
router.post("/broadcast", requirePermission("MANAGE_SETTINGS"), validate(retailBroadcastSchema), postRetailBroadcast);

// Coupons
router.get("/coupons", requirePermission("MANAGE_SETTINGS"), getRetailCoupons);
router.post("/coupons", requirePermission("MANAGE_SETTINGS"), validate(createRetailCouponSchema), postRetailCoupon);
router.put("/coupons/:id", requirePermission("MANAGE_SETTINGS"), validate(updateRetailCouponSchema), patchRetailCoupon);
router.delete("/coupons/:id", requirePermission("MANAGE_SETTINGS"), validate(idParamSchema), removeRetailCoupon);

// Orders
router.get("/orders", requirePermission("MANAGE_INVOICES"), validate(listRetailOrdersSchema), getRetailOrders);
router.post("/orders/:id/prepare", requirePermission("MANAGE_INVOICES"), validate(idParamSchema), prepareRetailOrder);
router.post("/orders/:id/cancel", requirePermission("MANAGE_INVOICES"), validate(idParamSchema), cancelRetailOrderCtrl);

// Referral settings (admin)
router.get("/referral-settings", requirePermission("MANAGE_SETTINGS"), getRetailReferralSettingsCtrl);
router.put("/referral-settings", requirePermission("MANAGE_SETTINGS"), putRetailReferralSettingsCtrl);

export default router;
