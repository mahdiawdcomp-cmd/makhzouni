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
  getProfitReport,
  getDebtCustomersForReminder,
} from "../services/report.service";
import { sendWhatsAppText } from "../services/whatsapp.service";
import { getSettings } from "../services/settings.service";

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

export const profitReport = asyncHandler(async (req, res) => {
  const data = await getProfitReport(
    req.validatedQuery as Parameters<typeof getProfitReport>[0]
  );
  res.json({ success: true, data });
});

// GET /api/reports/debt-reminder?minDays=X  — returns eligible customers
export const debtReminderList = asyncHandler(async (req, res) => {
  const minDays = Number((req.query as Record<string, string>).minDays ?? 0);
  const data = await getDebtCustomersForReminder(minDays);
  res.json({ success: true, data });
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
      await sendWhatsAppText(
        customer.phone,
        `مرحباً ${customer.name}،\nلديك رصيد مستحق بمقدار ${customer.currentBalance.toLocaleString("en-US")} ${currency}.\nنرجو التكرم بالتسوية في أقرب وقت.\nشكراً لتعاملكم معنا.`,
      );
      sent++;
    } catch (err) {
      failed++;
      errors.push(`${customer.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  res.json({ success: true, data: { sent, failed, errors } });
});
