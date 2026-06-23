import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/permission.middleware";
import { validate } from "../middleware/validate";
import { createTransferSchema } from "../utils/schemas";
import { listTransfers, getTransfer, createTransfer } from "../controllers/transfers.controller";

const router = Router();

router.use(authMiddleware);

router.get("/", listTransfers);
router.get("/:id", getTransfer);
router.post("/", requirePermission("REQUEST_TRANSFER"), validate(createTransferSchema), createTransfer);

export default router;
