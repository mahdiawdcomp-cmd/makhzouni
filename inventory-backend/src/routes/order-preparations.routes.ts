import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { completeOrderPreparation, getPendingPreparations, markOrderPrepared } from "../controllers/order-preparations.controller";

const router = Router();

router.use(authMiddleware);
router.get("/", getPendingPreparations);
router.post("/:id/mark-prepared", markOrderPrepared);
router.post("/:id/complete", completeOrderPreparation);

export default router;
