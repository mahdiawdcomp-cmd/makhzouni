import { Router } from "express";
import { getLossDetails, getLosses, patchCancelLoss, postLoss } from "../controllers/stock-loss.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.use(authMiddleware);

router.get("/", getLosses);
router.get("/:id", getLossDetails);
router.post("/", postLoss);
router.patch("/:id/cancel", patchCancelLoss);

export default router;
