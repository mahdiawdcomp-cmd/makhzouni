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
  deleteSettlement,
  getAgentDayCtrl,
  getAgentsOverviewCtrl,
  getAreaPerformanceCtrl,
  getCommissionCtrl,
  getHandovers,
  getHealth,
  getIssueReportsCtrl,
  getIssuesCtrl,
  getLiability,
  getSettlements,
  getAgentCustomers,
  getAgentVisitPlan,
  patchAgentVisitPlanEntry,
  postAgentVisitPlanEntry,
  putAnyCustomerLocation,
  postHandover,
  postSettlement,
} from "../controllers/sales-agent-admin.controller";

const router = Router();

router.use(authMiddleware, adminOnly);

// «صفحة تحكم المندوب» — the owner's read of a rep's day and of every rep
// side by side. All three are reports: nothing here writes.
router.get("/agent-day", getAgentDayCtrl);
router.get("/agents-overview", getAgentsOverviewCtrl);
router.get("/area-performance", getAreaPerformanceCtrl);

router.get("/liability", getLiability);
router.get("/handovers", getHandovers);
router.post("/handovers", postHandover);
router.get("/commission", getCommissionCtrl);

router.get("/issue-reports", getIssueReportsCtrl);
router.get("/issues", getIssuesCtrl);
router.get("/health", getHealth);

// «خطة زيارات المندوب» — the owner assigns the round; the rep runs it from
// their own scoped routes.
router.get("/visit-plan", getAgentVisitPlan);
// The chosen rep's customers, so the plan screen can only offer their own.
router.get("/agent-customers", getAgentCustomers);
router.post("/visit-plan", postAgentVisitPlanEntry);
router.patch("/visit-plan/:id", patchAgentVisitPlanEntry);
// Correcting a shop's pin for any customer, audited.
router.put("/customers/:id/location", putAnyCustomerLocation);

router.get("/settlements", getSettlements);
router.post("/settlements", postSettlement);
router.delete("/settlements", deleteSettlement);

export default router;
