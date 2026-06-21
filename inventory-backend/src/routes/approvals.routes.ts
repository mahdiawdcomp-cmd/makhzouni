import { Router } from "express";
import {
  bulkReviewApprovals,
  getMyApprovals,
  getPendingApprovals,
  reviewPendingApproval,
} from "../controllers/approvals.controller";
import { adminOnly } from "../middleware/admin-only.middleware";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import { reviewApprovalSchema } from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/my-requests", getMyApprovals);
router.get("/", adminOnly, getPendingApprovals);
router.post("/bulk-review", adminOnly, bulkReviewApprovals);
router.put("/:id", adminOnly, validate(reviewApprovalSchema), reviewPendingApproval);

export default router;
