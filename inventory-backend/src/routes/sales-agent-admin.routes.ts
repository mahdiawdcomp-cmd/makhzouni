/**
 * «المندوب» — owner-only router.
 *
 * Separate from `sales-agent.routes.ts` on purpose: that one is guarded by
 * `requireSalesAgent()`, this one by `adminOnly`. Two routers with opposite
 * guards is what makes it impossible for a rep-facing endpoint to accidentally
 * start serving commission or another rep's liability.
 */
import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminOnly } from "../middleware/admin-only.middleware";
import {
  getIssueReportsCtrl,
  getCommissionCtrl,
  getHandovers,
  getLiability,
  postHandover,
} from "../controllers/sales-agent-admin.controller";

const router = Router();

router.use(authMiddleware, adminOnly);

router.get("/liability", getLiability);
router.get("/handovers", getHandovers);
router.post("/handovers", postHandover);
router.get("/commission", getCommissionCtrl);

router.get("/issue-reports", getIssueReportsCtrl);

export default router;
