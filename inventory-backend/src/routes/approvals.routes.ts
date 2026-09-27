import { Router } from "express";
import {
  addApprovalCustomer,
  bulkReviewApprovals,
  getMyApprovals,
  getPendingApprovals,
  reviewPendingApproval,
} from "../controllers/approvals.controller";
import { requireAnyPermission } from "../middleware/permission.middleware";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import { approvalIdParamSchema, reviewApprovalSchema } from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/my-requests", getMyApprovals);
// «الموافقات» (MANAGE_APPROVALS) reviews every request; «قبول التحويلات»
// (MANAGE_TRANSFERS) reviews transfers only — the controller narrows per item.
// Both permissions were offered in the users screen but these routes were
// adminOnly, so granting them did nothing.
const reviewers = requireAnyPermission("MANAGE_APPROVALS", "MANAGE_TRANSFERS");
router.get("/", reviewers, getPendingApprovals);
router.post("/bulk-review", reviewers, bulkReviewApprovals);
router.put("/:id", reviewers, validate(reviewApprovalSchema), reviewPendingApproval);
router.post("/:id/add-customer", requireAnyPermission("MANAGE_APPROVALS"), validate(approvalIdParamSchema), addApprovalCustomer);

export default router;
