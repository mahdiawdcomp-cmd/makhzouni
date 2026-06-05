import { Router } from "express";
import {
  atRiskCustomersReport,
  customerDebtsReport,
  dashboardReport,
  endOfDayReport,
  inventoryValuationReport,
  productMovementReport,
  salesReport,
  topCustomersReport,
} from "../controllers/reports.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import {
  customerDebtsReportSchema,
  productMovementReportSchema,
  salesReportSchema,
} from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/dashboard", dashboardReport);
router.get("/sales", validate(salesReportSchema), salesReport);
router.get(
  "/products/movement",
  validate(productMovementReportSchema),
  productMovementReport
);
router.get("/inventory/valuation", inventoryValuationReport);
router.get(
  "/customers/debts",
  validate(customerDebtsReportSchema),
  customerDebtsReport
);
router.get("/customers/top", topCustomersReport);
router.get("/end-of-day", endOfDayReport);
router.get("/customers/at-risk", atRiskCustomersReport);

export default router;
