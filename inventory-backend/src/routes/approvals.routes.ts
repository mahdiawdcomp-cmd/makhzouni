import { Router } from "express";
import {
  getPendingApprovals,
  reviewPendingApproval,
} from "../controllers/approvals.controller";
import { adminOnly } from "../middleware/admin-only.middleware";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import { reviewApprovalSchema } from "../utils/schemas";

const router = Router();

router.use(authMiddleware, adminOnly);

router.get("/", getPendingApprovals);
router.put("/:id", validate(reviewApprovalSchema), reviewPendingApproval);

export default router;
