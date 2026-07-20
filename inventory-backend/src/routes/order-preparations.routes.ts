import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { cancelOrderPreparation, completeOrderPreparation, createPreparationCustomer, getPendingPreparations, markOrderPrepared } from "../controllers/order-preparations.controller";

const router = Router();

router.use(authMiddleware);
router.get("/", getPendingPreparations);
router.post("/:id/mark-prepared", markOrderPrepared);
router.post("/:id/complete", completeOrderPreparation);
router.post("/:id/cancel", cancelOrderPreparation);
router.post("/:id/create-customer", createPreparationCustomer);

export default router;
