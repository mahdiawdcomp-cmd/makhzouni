import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { getPendingPreparations, markOrderPrepared } from "../controllers/order-preparations.controller";

const router = Router();

router.use(authMiddleware);
router.get("/", getPendingPreparations);
router.post("/:id/mark-prepared", markOrderPrepared);

export default router;
