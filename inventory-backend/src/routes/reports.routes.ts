import { Router } from "express";
import {
  atRiskCustomersReport,
  customerDebtsReport,
  customerRatingsReport,
  dailySummaryReport,
  dashboardReport,
  debtAgingReport,
  debtReminderList,
  endOfDayReport,
  inventoryValuationReport,
  productMovementReport,
  profitReport,
  storeBrainReport,
  salesReport,
  sendDebtReminder,
  topCustomersReport,
} from "../controllers/reports.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import {
  customerDebtsReportSchema,
  productMovementReportSchema,
  profitReportSchema,
  storeBrainReportSchema,
  salesReportSchema,
} from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/dashboard", dashboardReport);
router.get("/daily-summary", dailySummaryReport);
router.get("/sales", validate(salesReportSchema), salesReport);
router.get("/products/movement", validate(productMovementReportSchema), productMovementReport);
router.get("/inventory/valuation", inventoryValuationReport);
router.get("/customers/debts", validate(customerDebtsReportSchema), customerDebtsReport);
router.get("/customers/top", topCustomersReport);
router.get("/end-of-day", endOfDayReport);
router.get("/customers/at-risk", atRiskCustomersReport);
router.get("/customers/ratings", customerRatingsReport);
router.get("/customers/debt-aging", debtAgingReport);
router.get("/profit", validate(profitReportSchema), profitReport);
router.get("/store-brain", validate(storeBrainReportSchema), storeBrainReport);
router.get("/debt-reminder", debtReminderList);
router.post("/debt-reminder/send", sendDebtReminder);

export default router;
