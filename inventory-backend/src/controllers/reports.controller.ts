import { asyncHandler } from "../utils/async-handler";
import {
  getAtRiskCustomers,
  getCustomerDebtsReport,
  getDashboardReport,
  getEndOfDayReport,
  getInventoryValuationReport,
  getProductMovementReport,
  getSalesReport,
  getTopCustomersReport,
} from "../services/report.service";

export const dashboardReport = asyncHandler(async (_req, res) => {
  const data = await getDashboardReport();

  res.json({
    success: true,
    data,
  });
});

export const salesReport = asyncHandler(async (req, res) => {
  const data = await getSalesReport(
    req.validatedQuery as Parameters<typeof getSalesReport>[0]
  );

  res.json({
    success: true,
    data,
  });
});

export const productMovementReport = asyncHandler(async (req, res) => {
  const data = await getProductMovementReport(
    req.validatedQuery as Parameters<typeof getProductMovementReport>[0]
  );

  res.json({
    success: true,
    data,
  });
});

export const inventoryValuationReport = asyncHandler(async (_req, res) => {
  const data = await getInventoryValuationReport();

  res.json({
    success: true,
    data,
  });
});

export const customerDebtsReport = asyncHandler(async (req, res) => {
  const data = await getCustomerDebtsReport(
    req.validatedQuery as Parameters<typeof getCustomerDebtsReport>[0]
  );

  res.json({
    success: true,
    data,
  });
});

export const topCustomersReport = asyncHandler(async (req, res) => {
  const { from, to, limit } = req.query as Record<string, string>;
  const data = await getTopCustomersReport({
    from: from || undefined,
    to: to || undefined,
    limit: limit ? Number(limit) : 15,
  });
  res.json({ success: true, data });
});

export const endOfDayReport = asyncHandler(async (req, res) => {
  const { date } = req.query as Record<string, string>;
  const data = await getEndOfDayReport(date || undefined);
  res.json({ success: true, data });
});

export const atRiskCustomersReport = asyncHandler(async (req, res) => {
  const { limit } = req.query as Record<string, string>;
  const data = await getAtRiskCustomers(limit ? Math.min(Number(limit), 50) : 10);
  res.json({ success: true, data });
});
