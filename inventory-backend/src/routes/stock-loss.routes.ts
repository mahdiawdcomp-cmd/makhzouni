import { Router, type RequestHandler } from "express";
import { getLossDetails, getLosses, patchCancelLoss, postLoss } from "../controllers/stock-loss.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { hasPermission, requirePermission } from "../middleware/permission.middleware";
import { isWorkerOnlyUser } from "../middleware/worker-scope";
import { validate } from "../middleware/validate";
import { cancelStockLossSchema, createStockLossSchema } from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/", getLosses);
router.get("/:id", getLossDetails);
// Recording damage moves real stock. Product managers, stocktakers and the
// warehouse worker (whose «التالف» screen this is — worker-scope lets him in)
// may record it; cancelling one stays with product managers.
const canRecordLoss: RequestHandler = (req, res, next) => {
  const user = req.user;
  if (user && (isWorkerOnlyUser(user) || hasPermission(user, "INVENTORY_MANAGE"))) return next();
  return requirePermission("MANAGE_PRODUCTS")(req, res, next);
};
router.post("/", canRecordLoss, validate(createStockLossSchema), postLoss);
router.patch(
  "/:id/cancel",
  requirePermission("MANAGE_PRODUCTS"),
  validate(cancelStockLossSchema),
  patchCancelLoss
);

export default router;
