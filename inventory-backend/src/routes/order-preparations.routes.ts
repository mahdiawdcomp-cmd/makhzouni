import { requirePermission } from "../middleware/permission.middleware";
import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { cancelOrderPreparation, completeOrderPreparation, createPreparationCustomer, getPendingPreparations, markOrderPrepared } from "../controllers/order-preparations.controller";

const router = Router();

router.use(authMiddleware);
router.get("/", getPendingPreparations);
// These complete or cancel real customer orders and create customer records —
// they were reachable by any authenticated account.
router.post("/:id/mark-prepared", requirePermission("MANAGE_INVOICES"), markOrderPrepared);
router.post("/:id/complete", requirePermission("MANAGE_INVOICES"), completeOrderPreparation);
router.post("/:id/cancel", requirePermission("MANAGE_INVOICES"), cancelOrderPreparation);
router.post("/:id/create-customer", requirePermission("MANAGE_CUSTOMERS"), createPreparationCustomer);

export default router;
