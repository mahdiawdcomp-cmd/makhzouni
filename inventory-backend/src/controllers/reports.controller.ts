import { asyncHandler } from "../utils/async-handler";
import {
  getAtRiskCustomers,
  getCustomerDebtsReport,
  getDashboardReport,
  getDailySummaryData,
  getEndOfDayReport,
  getInventoryValuationReport,
  getProductMovementReport,
  getSalesReport,
  getTopCustomersReport,
  getProfitReport,
  getWarehouseComparisonReport,
  getCrossSellPairs,
  getStoreBrainReport,
  getDebtCustomersForReminder,
  getInactiveCustomersForReminder,
  getCustomerRatings,
  getDebtAging,
} from "../services/report.service";
import { getDailyAssistant } from "../services/daily-assistant.service";
import { getTopSearchMisses } from "../services/catalog-tracking.service";
import { sendTextWithTemplateFallback } from "../services/whatsapp.service";
import { getSettings } from "../services/settings.service";
import { getAllCustomerStatements } from "../services/customer.service";

const CLOUD_TEMPLATE_LANG = "ar";

export const dashboardReport = asyncHandler(async (_req, res) => {
  const data = await getDashboardReport();
  res.json({ success: true, data });
});

export const dailySummaryReport = asyncHandler(async (_req, res) => {
  const data = await getDailySummaryData();
  res.json({ success: true, data });
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

export const profitReport = asyncHandler(async (req, res) => {
  const data = await getProfitReport(
    req.validatedQuery as Parameters<typeof getProfitReport>[0]
  );
  res.json({ success: true, data });
});

export const warehouseComparisonReport = asyncHandler(async (req, res) => {
  const data = await getWarehouseComparisonReport(
    req.validatedQuery as Parameters<typeof getWarehouseComparisonReport>[0]
  );
  res.json({ success: true, data });
});

export const storeBrainReport = asyncHandler(async (req, res) => {
  const data = await getStoreBrainReport(
    req.validatedQuery as Parameters<typeof getStoreBrainReport>[0]
  );
  res.json({ success: true, data });
});

// GET /api/reports/daily-assistant?date=YYYY-MM-DD&refresh=true — «المساعد الذكي اليومي»
// Gated by requireProfitReports() at the route level (shows profit figures).
export const dailyAssistantReport = asyncHandler(async (req, res) => {
  const data = await getDailyAssistant(
    req.validatedQuery as Parameters<typeof getDailyAssistant>[0],
  );
  res.json({ success: true, data });
});

// GET /api/reports/debt-reminder?minDays=X  — returns eligible customers
export const debtReminderList = asyncHandler(async (req, res) => {
  const minDays = Number((req.query as Record<string, string>).minDays ?? 0);
  const data = await getDebtCustomersForReminder(minDays);
  res.json({ success: true, data });
});

export const customerRatingsReport = asyncHandler(async (_req, res) => {
  const data = await getCustomerRatings();
  res.json({ success: true, data });
});

export const debtAgingReport = asyncHandler(async (_req, res) => {
  const data = await getDebtAging();
  res.json({ success: true, data });
});

export const searchMissesReport = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getTopSearchMisses() });
});

export const crossSellReport = asyncHandler(async (req, res) => {
  const data = await getCrossSellPairs(
    req.validatedQuery as Parameters<typeof getCrossSellPairs>[0]
  );
  res.json({ success: true, data });
});

// GET /api/reports/customers/statements-export — paginated bulk statement export
// (used by the "حفظ الكشف العام" master statement HTML download).
export const customerStatementsExportReport = asyncHandler(async (req, res) => {
  const { page, limit } = req.validatedQuery as Parameters<typeof getAllCustomerStatements>[0];
  const { data, total, pages } = await getAllCustomerStatements({ page, limit });
  res.json({ success: true, data, pagination: { total, page, limit, pages } });
});

// POST /api/reports/debt-reminder/send  — send WhatsApp to selected customers
export const sendDebtReminder = asyncHandler(async (req, res) => {
  const { customerIds, minDays } = req.body as { customerIds?: string[]; minDays?: number };
  const settings = await getSettings().catch(() => null);
  const currency = settings?.currency ?? "IQD";

  const eligible = await getDebtCustomersForReminder(minDays ?? 0);
  const targets = customerIds?.length
    ? eligible.filter((c) => customerIds.includes(c.id))
    : eligible;

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const customer of targets) {
    try {
      const balanceStr = customer.currentBalance.toLocaleString("en-US");
      await sendTextWithTemplateFallback(
        customer.phone,
        settings?.debtReminderTemplateName,
        CLOUD_TEMPLATE_LANG,
        `مرحباً ${customer.name}،\nلديك رصيد مستحق بمقدار ${balanceStr} ${currency}.\nنرجو التكرم بالتسوية في أقرب وقت.\nشكراً لتعاملكم معنا.`,
        [customer.name, balanceStr, currency],
      );
      sent++;
    } catch (err) {
      failed++;
      errors.push(`${customer.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  res.json({ success: true, data: { sent, failed, errors } });
});

// GET /api/reports/inactive-reminder?minDays=X — returns eligible inactive customers
export const inactiveReminderList = asyncHandler(async (req, res) => {
  const minDays = Number((req.query as Record<string, string>).minDays ?? 0);
  const data = await getInactiveCustomersForReminder(minDays);
  res.json({ success: true, data });
});

// POST /api/reports/inactive-reminder/send — send WhatsApp to selected inactive customers
export const sendInactiveReminder = asyncHandler(async (req, res) => {
  const { customerIds, minDays } = req.body as { customerIds?: string[]; minDays?: number };
  const settings = await getSettings().catch(() => null);

  const eligible = await getInactiveCustomersForReminder(minDays ?? 0);
  const targets = customerIds?.length
    ? eligible.filter((c) => customerIds.includes(c.id))
    : eligible;

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const customer of targets) {
    try {
      await sendTextWithTemplateFallback(
        customer.phone,
        settings?.inactiveCustomerTemplateName,
        CLOUD_TEMPLATE_LANG,
        `مرحباً ${customer.name}،\nاشتقنا لك! مر وقت طويل من آخر تعامل معنا، تعال شوف عروضنا الجديدة.\nبانتظارك.`,
        [customer.name],
      );
      sent++;
    } catch (err) {
      failed++;
      errors.push(`${customer.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  res.json({ success: true, data: { sent, failed, errors } });
});
