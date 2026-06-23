import { Router } from "express";
import { getLossDetails, getLosses, patchCancelLoss, postLoss } from "../controllers/stock-loss.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/permission.middleware";
import { validate } from "../middleware/validate";
import { cancelStockLossSchema, createStockLossSchema } from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/", getLosses);
router.get("/:id", getLossDetails);
// Recording/cancelling damage moves real stock — gate behind inventory management,
// the same permission that guards product/stock edits.
router.post("/", requirePermission("MANAGE_PRODUCTS"), validate(createStockLossSchema), postLoss);
router.patch(
  "/:id/cancel",
  requirePermission("MANAGE_PRODUCTS"),
  validate(cancelStockLossSchema),
  patchCancelLoss
);

export default router;
