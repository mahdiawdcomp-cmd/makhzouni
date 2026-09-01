import { Router } from "express";
import {
  atRiskCustomersReport,
  customerDebtsReport,
  customerRatingsReport,
  customerStatementsExportReport,
  dailyAssistantReport,
  dailySummaryReport,
  dashboardReport,
  debtAgingReport,
  searchMissesReport,
  debtReminderList,
  endOfDayReport,
  collectionsSummary,
  inactiveReminderList,
  inventoryValuationReport,
  productMovementReport,
  profitReport,
  customerProfitAudit,
  fixInvoiceLineCost,
  warehouseComparisonReport,
  crossSellReport,
  storeBrainReport,
  salesReport,
  sendDebtReminder,
  sendInactiveReminder,
  topCustomersReport,
} from "../controllers/reports.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission, requireProfitReports } from "../middleware/permission.middleware";
import { validate } from "../middleware/validate";
import {
  customerDebtsReportSchema,
  customerStatementsExportSchema,
  dailyAssistantSchema,
  productMovementReportSchema,
  profitReportSchema,
  customerProfitAuditSchema,
  fixInvoiceLineCostSchema,
  warehouseComparisonReportSchema,
  crossSellReportSchema,
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
// Lightweight "today's income" widget for the Collections/Vouchers page —
// intentionally a different prefix than /reports/end-of-day so it is NOT
// caught by the dailyClosing feature gate (see ROUTE_FEATURE_MAP).
router.get("/collections-summary", collectionsSummary);
router.get("/customers/at-risk", atRiskCustomersReport);
router.get("/customers/ratings", customerRatingsReport);
router.get("/customers/debt-aging", debtAgingReport);
router.get("/search-misses", searchMissesReport);
router.get("/customers/statements-export", validate(customerStatementsExportSchema), customerStatementsExportReport);
// Profit + store-brain expose full financial margins — gated by the profit-visibility
// capability, which (unlike every other permission) can be revoked even from an ADMIN.
router.get("/profit", requireProfitReports(), validate(profitReportSchema), profitReport);
// Exposes per-line cost and margin, so it sits behind the same profit gate.
// The fix WRITES a recorded cost onto historical invoice lines, which is a
// product-data change on top of a profit read — hence both guards.
router.get("/customer-profit-audit", requireProfitReports(), validate(customerProfitAuditSchema), customerProfitAudit);
router.post("/customer-profit-audit/fix", requireProfitReports(), requirePermission("MANAGE_PRODUCTS"), validate(fixInvoiceLineCostSchema), fixInvoiceLineCost);
router.get("/warehouse-comparison", requireProfitReports(), validate(warehouseComparisonReportSchema), warehouseComparisonReport);
// Not profit-gated — pair counts only, no revenue/margin, useful to any staff.
router.get("/cross-sell", validate(crossSellReportSchema), crossSellReport);
router.get("/store-brain", requireProfitReports(), validate(storeBrainReportSchema), storeBrainReport);
// «المساعد الذكي اليومي» — exposes profit figures, so gated exactly like /profit.
router.get("/daily-assistant", requireProfitReports(), validate(dailyAssistantSchema), dailyAssistantReport);
router.get("/debt-reminder", debtReminderList);
router.post("/debt-reminder/send", sendDebtReminder);
router.get("/inactive-reminder", inactiveReminderList);
router.post("/inactive-reminder/send", sendInactiveReminder);

export default router;
