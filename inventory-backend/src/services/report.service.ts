import { InvoiceStatus, InvoiceType, Prisma, Unit } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";

type DecimalLike = Prisma.Decimal | number | string | null | undefined;

export interface SalesReportQuery {
  from?: string;
  to?: string;
  branchId?: string;
  groupBy: "day" | "week" | "month";
}

export interface ProductMovementQuery {
  productId: string;
  branchId?: string;
  from?: string;
  to?: string;
}

export interface CustomerDebtQuery {
  minDays: number;
  maxDays: number;
  branchId?: string;
}

export interface TopCustomersQuery {
  from?: string;
  to?: string;
  limit?: number;
}

function toNumber(value: DecimalLike) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateFilter(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  const filter: Prisma.DateTimeFilter = {};
  if (from) filter.gte = startOfDay(new Date(from));
  if (to) filter.lte = endOfDay(new Date(to));
  return Object.keys(filter).length ? filter : undefined;
}

function labelFor(date: Date, groupBy: "day" | "week" | "month") {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  if (groupBy === "month") return `${year}-${month}`;

  if (groupBy === "week") {
    const firstDay = new Date(date.getFullYear(), 0, 1);
    const pastDays = Math.floor(
      (startOfDay(date).getTime() - firstDay.getTime()) / 86400000
    );
    const week = Math.ceil((pastDays + firstDay.getDay() + 1) / 7);
    return `${year}-W${String(week).padStart(2, "0")}`;
  }

  return `${year}-${month}-${day}`;
}

function unitPurchaseCost(
  unit: Unit,
  purchasePrice: DecimalLike,
  pcsPerCarton: number
) {
  const price = toNumber(purchasePrice);
  if (unit === Unit.CARTON) return price * pcsPerCarton;
  if (unit === Unit.DOZEN) return price * 12;
  return price;
}

function currentStock(product: {
  openingBalancePcs: number;
  cartonsAvailable: number;
  pcsPerCarton: number;
}) {
  return product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton;
}

function invoiceRevenueRatio(invoice: {
  subtotal: DecimalLike;
  totalAmount: DecimalLike;
}) {
  const subtotal = toNumber(invoice.subtotal);
  if (subtotal <= 0) return 0;
  return toNumber(invoice.totalAmount) / subtotal;
}

async function getInvoiceItemsForProfit(where: Prisma.InvoiceWhereInput) {
  return prisma.invoiceItem.findMany({
    where: {
      invoice: where,
    },
    include: {
      product: true,
      invoice: true,
    },
  });
}

function calculateProfit(items: Awaited<ReturnType<typeof getInvoiceItemsForProfit>>) {
  return items.reduce((sum, item) => {
    const revenue = toNumber(item.totalPrice) * invoiceRevenueRatio(item.invoice); // FIXED
    const cost =
      unitPurchaseCost(item.unit, item.product.purchasePrice, item.product.pcsPerCarton) *
      item.quantity;
    return sum + (revenue - cost);
  }, 0);
}

export async function getDashboardReport() {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const sevenDaysAgo = startOfDay(addDays(now, -6));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    todaySales,
    todayInvoices,
    totalDebts,
    lowStockProducts,
    topProducts,
    lastSevenDaysInvoices,
  ] = await Promise.all([
    prisma.invoice.aggregate({
      where: {
        status: InvoiceStatus.ACTIVE,
        type: InvoiceType.SALE,
        date: { gte: todayStart, lte: todayEnd },
      },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.count({
      where: {
        status: InvoiceStatus.ACTIVE,
        type: InvoiceType.SALE,
        date: { gte: todayStart, lte: todayEnd },
      },
    }),
    prisma.customer.aggregate({
      where: {
        deletedAt: null,
        currentBalance: { gt: 0 },
      },
      _sum: { currentBalance: true },
    }),
    prisma.product.findMany({ where: { deletedAt: null } }),
    prisma.invoiceItem.findMany({
      where: {
        invoice: {
          status: InvoiceStatus.ACTIVE,
          type: InvoiceType.SALE,
          date: { gte: monthStart, lte: now },
        },
      },
      include: {
        invoice: true,
      },
    }),
    prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.ACTIVE,
        type: InvoiceType.SALE,
        date: { gte: sevenDaysAgo, lte: todayEnd },
      },
      select: {
        date: true,
        totalAmount: true,
      },
    }),
  ]);

  const lowStockCount = lowStockProducts.filter(
    (product) => currentStock(product) <= product.minStock
  ).length;

  const salesMap = new Map<string, number>();
  for (let i = 0; i < 7; i += 1) {
    salesMap.set(labelFor(addDays(sevenDaysAgo, i), "day"), 0);
  }
  for (const invoice of lastSevenDaysInvoices) {
    const key = labelFor(invoice.date, "day");
    salesMap.set(key, (salesMap.get(key) ?? 0) + toNumber(invoice.totalAmount));
  }

  const topProductMap = new Map<
    string,
    { productId: string; productName: string; quantitySold: number; totalSales: number }
  >();

  for (const item of topProducts) {
    const current = topProductMap.get(item.productId) ?? {
      productId: item.productId,
      productName: item.productName,
      quantitySold: 0,
      totalSales: 0,
    };
    current.quantitySold += item.quantity;
    current.totalSales += toNumber(item.totalPrice) * invoiceRevenueRatio(item.invoice);
    topProductMap.set(item.productId, current);
  }

  return {
    todaySales: toNumber(todaySales._sum.totalAmount),
    todayInvoices,
    totalDebts: toNumber(totalDebts._sum.currentBalance),
    lowStockProducts: lowStockCount,
    topProductsThisMonth: Array.from(topProductMap.values())
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, 5),
    lastSevenDaysSales: Array.from(salesMap.entries()).map(([date, totalSales]) => ({
      date,
      totalSales,
    })),
  };
}

export async function getSalesReport(query: SalesReportQuery) {
  const invoiceWhere: Prisma.InvoiceWhereInput = {
    status: InvoiceStatus.ACTIVE,
    type: InvoiceType.SALE,
    ...(query.branchId ? { branchId: query.branchId } : {}),
    ...(dateFilter(query.from, query.to) ? { date: dateFilter(query.from, query.to) } : {}),
  };

  const [invoiceTotals, items] = await Promise.all([
    prisma.invoice.aggregate({
      where: invoiceWhere,
      _sum: { totalAmount: true },
      _count: { id: true },
    }),
    getInvoiceItemsForProfit(invoiceWhere),
  ]);

  const chartMap = new Map<string, { totalSales: number; netProfit: number }>();

  for (const item of items) {
    const key = labelFor(item.invoice.date, query.groupBy);
    const revenue = toNumber(item.totalPrice) * invoiceRevenueRatio(item.invoice); // FIXED
    const cost =
      unitPurchaseCost(item.unit, item.product.purchasePrice, item.product.pcsPerCarton) *
      item.quantity;
    const current = chartMap.get(key) ?? { totalSales: 0, netProfit: 0 };
    current.totalSales += revenue;
    current.netProfit += revenue - cost;
    chartMap.set(key, current);
  }

  return {
    totalSales: toNumber(invoiceTotals._sum.totalAmount),
    invoiceCount: invoiceTotals._count.id,
    netProfit: calculateProfit(items),
    chart: Array.from(chartMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, values]) => ({
        period,
        ...values,
      })),
  };
}

export async function getProductMovementReport(query: ProductMovementQuery) {
  const product = await prisma.product.findUnique({
    where: { id: query.productId },
  });

  if (!product) {
    throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
  }

  const invoicesDateFilter = dateFilter(query.from, query.to);
  const items = await prisma.invoiceItem.findMany({
    where: {
      productId: query.productId,
      invoice: {
        status: InvoiceStatus.ACTIVE,
        type: InvoiceType.SALE,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(invoicesDateFilter ? { date: invoicesDateFilter } : {}),
      },
    },
    include: {
      invoice: {
        include: {
          customer: true,
        },
      },
    },
    orderBy: {
      invoice: {
        date: "desc",
      },
    },
  });

  return {
    product: {
      id: product.id,
      itemNumber: product.itemNumber,
      name: product.name,
    },
    rows: items.map((item) => ({
      date: item.invoice.date,
      customerName: item.invoice.customer.name,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: toNumber(item.unitPrice),
      totalPrice: toNumber(item.totalPrice) * invoiceRevenueRatio(item.invoice),
      invoiceNumber: item.invoice.invoiceNumber,
      invoiceId: item.invoice.id,
    })),
    totals: {
      quantitySold: items.reduce((sum, item) => sum + item.quantity, 0),
      totalRevenue: items.reduce(
        (sum, item) => sum + toNumber(item.totalPrice) * invoiceRevenueRatio(item.invoice),
        0
      ),
    },
  };
}

export async function getInventoryValuationReport() {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    orderBy: { itemNumber: "asc" },
  });

  const rows = products.map((product) => {
    const quantity = currentStock(product);
    const purchaseValue = quantity * toNumber(product.purchasePrice);
    const saleValue = quantity * toNumber(product.salePrice);

    return {
      id: product.id,
      itemNumber: product.itemNumber,
      name: product.name,
      category: product.category,
      currentStock: quantity,
      purchasePrice: toNumber(product.purchasePrice),
      salePrice: toNumber(product.salePrice),
      purchaseValue,
      saleValue,
    };
  });

  return {
    products: rows,
    totals: {
      currentStock: rows.reduce((sum, row) => sum + row.currentStock, 0),
      purchaseValue: rows.reduce((sum, row) => sum + row.purchaseValue, 0),
      saleValue: rows.reduce((sum, row) => sum + row.saleValue, 0),
    },
  };
}

export async function getCustomerDebtsReport(query: CustomerDebtQuery) {
  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      ...(query.branchId ? { branchId: query.branchId } : {}),
      currentBalance: { gt: 0 },
    },
    orderBy: { currentBalance: "desc" },
  });

  const now = Date.now();

  return customers
    .map((customer) => {
      const lastDate = customer.lastTransactionAt ?? customer.createdAt;
      const debtAgeDays = Math.floor((now - lastDate.getTime()) / 86400000);

      return {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        currentBalance: toNumber(customer.currentBalance),
        lastTransactionAt: customer.lastTransactionAt,
        debtAgeDays,
      };
    })
    .filter(
      (customer) =>
        customer.debtAgeDays >= query.minDays &&
        customer.debtAgeDays <= query.maxDays
    );
}

// ── Top Customers (by total SALE invoice amount) ──────────────────────────
export async function getTopCustomersReport(query: TopCustomersQuery) {
  const df = dateFilter(query.from, query.to);

  const grouped = await prisma.invoice.groupBy({
    by: ["customerId"],
    where: {
      status: InvoiceStatus.ACTIVE,
      type: "SALE" as any,
      ...(df ? { date: df } : {}),
    },
    _sum: { totalAmount: true, paidAmount: true },
    _count: { id: true },
    orderBy: { _sum: { totalAmount: "desc" } },
    take: query.limit ?? 15,
  });

  const customerIds = grouped.map((g) => g.customerId);
  const customers = await prisma.customer.findMany({
    where: { id: { in: customerIds } },
    select: { id: true, name: true, phone: true, currentBalance: true },
  });

  return grouped.map((g) => {
    const cust = customers.find((c) => c.id === g.customerId);
    return {
      customerId: g.customerId,
      name: cust?.name ?? "—",
      phone: cust?.phone ?? "",
      currentBalance: toNumber(cust?.currentBalance),
      totalPurchases: toNumber(g._sum.totalAmount),
      totalPaid: toNumber(g._sum.paidAmount),
      invoiceCount: g._count.id,
    };
  });
}

// ── End-of-Day summary ────────────────────────────────────────────────────
export async function getEndOfDayReport(date?: string) {
  const d = date ? new Date(date) : new Date();
  const start = new Date(d); start.setHours(0, 0, 0, 0);
  const end = new Date(d); end.setHours(23, 59, 59, 999);

  const [invoices, vouchers] = await Promise.all([
    prisma.invoice.findMany({
      where: { date: { gte: start, lte: end }, status: "ACTIVE" },
      include: { customer: { select: { name: true } } },
    }),
    prisma.paymentVoucher.findMany({
      where: { date: { gte: start, lte: end } },
      include: { customer: { select: { name: true } } },
    }),
  ]);

  const saleInvoices = invoices.filter((i) => i.type === "SALE");
  const purchaseInvoices = invoices.filter((i) => i.type === "PURCHASE");
  const receipts = vouchers.filter((v) => v.type === "RECEIPT");
  const payments = vouchers.filter((v) => v.type === "PAYMENT");
  const expenses = vouchers.filter((v) => v.type === "EXPENSE");

  return {
    date: start.toISOString().slice(0, 10),
    sales: {
      count: saleInvoices.length,
      total: saleInvoices.reduce((s, i) => s + toNumber(i.totalAmount), 0),
      collected: saleInvoices.reduce((s, i) => s + toNumber(i.paidAmount), 0),
    },
    purchases: {
      count: purchaseInvoices.length,
      total: purchaseInvoices.reduce((s, i) => s + toNumber(i.totalAmount), 0),
    },
    receipts: {
      count: receipts.length,
      total: receipts.reduce((s, v) => s + toNumber(v.amount), 0),
    },
    payments: {
      count: payments.length,
      total: payments.reduce((s, v) => s + toNumber(v.amount), 0),
    },
    expenses: {
      count: expenses.length,
      total: expenses.reduce((s, v) => s + toNumber(v.amount), 0),
    },
    invoices: saleInvoices.slice(0, 20).map((i) => ({
      invoiceNumber: i.invoiceNumber,
      customerName: i.customer?.name ?? "—",
      total: toNumber(i.totalAmount),
      paid: toNumber(i.paidAmount),
    })),
  };
}

// ── Daily Summary (for WhatsApp 9 PM report) ─────────────────────────────
export interface DailySummaryData {
  date: string;
  todaySales: number;
  yesterdaySales: number;
  salesChangePercent: number | null;
  topProduct: { name: string; quantity: number } | null;
  lowStockCount: number;
  lowStockNames: string[];
  collectionsToday: number;
  mostOverdueCustomer: { name: string; daysLate: number } | null;
  smartTip: string | null;
}

export async function getDailySummaryData(): Promise<DailySummaryData> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const yesterdayStart = startOfDay(addDays(now, -1));
  const yesterdayEnd = endOfDay(addDays(now, -1));
  const last28Start = startOfDay(addDays(now, -28));

  const [
    todaySalesAgg,
    yesterdaySalesAgg,
    receiptsToday,
    allProducts,
    topItemsToday,
    overdueCustomers,
    last28Invoices,
  ] = await Promise.all([
    prisma.invoice.aggregate({
      where: { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE, date: { gte: todayStart, lte: todayEnd } },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE, date: { gte: yesterdayStart, lte: yesterdayEnd } },
      _sum: { totalAmount: true },
    }),
    prisma.paymentVoucher.aggregate({
      where: { type: "RECEIPT", date: { gte: todayStart, lte: todayEnd } },
      _sum: { amount: true },
    }),
    prisma.product.findMany({ where: { deletedAt: null } }),
    prisma.invoiceItem.groupBy({
      by: ["productId", "productName"],
      where: {
        invoice: {
          status: InvoiceStatus.ACTIVE,
          type: InvoiceType.SALE,
          date: { gte: todayStart, lte: todayEnd },
        },
      },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 1,
    }),
    prisma.customer.findMany({
      where: { deletedAt: null, currentBalance: { gt: 0 } },
      orderBy: { lastTransactionAt: "asc" },
      take: 1,
      select: { name: true, lastTransactionAt: true, createdAt: true },
    }),
    prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.ACTIVE,
        type: InvoiceType.SALE,
        date: { gte: last28Start, lte: yesterdayEnd },
      },
      select: { date: true, totalAmount: true },
    }),
  ]);

  const todaySales = toNumber(todaySalesAgg._sum.totalAmount);
  const yesterdaySales = toNumber(yesterdaySalesAgg._sum.totalAmount);
  const salesChangePercent =
    yesterdaySales > 0
      ? Math.round(((todaySales - yesterdaySales) / yesterdaySales) * 100)
      : null;

  const collectionsToday = toNumber(receiptsToday._sum.amount);

  const lowStockItems = allProducts.filter(
    (p) => currentStock(p) >= 0 && currentStock(p) <= p.minStock
  );
  const lowStockNames = lowStockItems.slice(0, 3).map((p) => p.name);

  const topProduct =
    topItemsToday.length > 0
      ? { name: topItemsToday[0].productName, quantity: topItemsToday[0]._sum.quantity ?? 0 }
      : null;

  const mostOverdueCustomer =
    overdueCustomers.length > 0
      ? (() => {
          const c = overdueCustomers[0];
          const lastDate = c.lastTransactionAt ?? c.createdAt;
          const daysLate = Math.floor((now.getTime() - lastDate.getTime()) / 86_400_000);
          return { name: c.name, daysLate };
        })()
      : null;

  // Smart tip: compare average for today's weekday vs overall 28-day daily average
  const dayOfWeek = now.getDay();
  const arabicDays = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

  const dailyMap = new Map<string, number>();
  for (const inv of last28Invoices) {
    const key = labelFor(inv.date, "day");
    dailyMap.set(key, (dailyMap.get(key) ?? 0) + toNumber(inv.totalAmount));
  }
  const allDailyValues = Array.from(dailyMap.values());
  const overallAvg =
    allDailyValues.length > 0 ? allDailyValues.reduce((s, v) => s + v, 0) / allDailyValues.length : 0;

  const sameDowMap = new Map<string, number>();
  for (const inv of last28Invoices) {
    if (new Date(inv.date).getDay() !== dayOfWeek) continue;
    const key = labelFor(inv.date, "day");
    sameDowMap.set(key, (sameDowMap.get(key) ?? 0) + toNumber(inv.totalAmount));
  }
  const sameDowValues = Array.from(sameDowMap.values());
  const sameDowAvg =
    sameDowValues.length > 0 ? sameDowValues.reduce((s, v) => s + v, 0) / sameDowValues.length : 0;

  let smartTip: string | null = null;
  if (overallAvg > 0 && sameDowAvg > 0) {
    const diff = Math.round(((sameDowAvg - overallAvg) / overallAvg) * 100);
    if (diff >= 15) {
      smartTip = `مبيعات يوم ${arabicDays[dayOfWeek]} أعلى عادةً بـ ${diff}% — فكّر بزيادة المخزون`;
    } else if (diff <= -15) {
      smartTip = `مبيعات يوم ${arabicDays[dayOfWeek]} أقل عادةً بـ ${Math.abs(diff)}% — يوم مناسب للجرد والترتيب`;
    }
  }

  const arabicMonths = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  ];
  const dateLabel = `${arabicDays[dayOfWeek]} ${now.getDate()} ${arabicMonths[now.getMonth()]}`;

  return {
    date: dateLabel,
    todaySales,
    yesterdaySales,
    salesChangePercent,
    topProduct,
    lowStockCount: lowStockItems.length,
    lowStockNames,
    collectionsToday,
    mostOverdueCustomer,
    smartTip,
  };
}

/**
 * Returns customers who are "overdue" for a visit based on their own purchase rhythm.
 *
 * Algorithm:
 *  1. For each customer, get their last N sale invoices.
 *  2. Calculate their average interval between purchases (days).
 *  3. If days-since-last-purchase > avgInterval * 1.5, they are at-risk.
 *  4. Customers with only one purchase use a configurable fallback (default 30 days).
 *
 * Returns up to `limit` customers sorted by "most overdue" first.
 */
export async function getAtRiskCustomers(limit = 10) {
  const now = new Date();

  // Only regular customers (not suppliers) who have at least one sale invoice
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null, isSupplier: false },
    select: {
      id: true,
      name: true,
      phone: true,
      currentBalance: true,
      lastTransactionAt: true,
      invoices: {
        where: { type: "SALE", status: "ACTIVE" },
        select: { date: true },
        orderBy: { date: "desc" },
        take: 6,
      },
    },
  });

  const results: Array<{
    id: string;
    name: string;
    phone: string;
    currentBalance: number;
    lastTransactionAt: string | null;
    avgIntervalDays: number;
    daysSinceLastPurchase: number;
    overdueDays: number;
  }> = [];

  for (const c of customers) {
    if (c.invoices.length === 0) continue;

    const lastInvoiceDate = c.invoices[0].date;
    const daysSinceLast = Math.floor(
      (now.getTime() - lastInvoiceDate.getTime()) / 86_400_000
    );

    let avgInterval = 30; // default fallback for single-purchase customers
    if (c.invoices.length >= 2) {
      let totalGap = 0;
      for (let i = 0; i < c.invoices.length - 1; i++) {
        const gap =
          (c.invoices[i].date.getTime() - c.invoices[i + 1].date.getTime()) /
          86_400_000;
        totalGap += gap;
      }
      avgInterval = Math.max(1, totalGap / (c.invoices.length - 1));
    }

    const threshold = avgInterval * 1.5;
    if (daysSinceLast < threshold) continue; // still within normal window

    results.push({
      id: c.id,
      name: c.name,
      phone: c.phone,
      currentBalance: toNumber(c.currentBalance),
      lastTransactionAt: c.lastTransactionAt?.toISOString() ?? null,
      avgIntervalDays: Math.round(avgInterval),
      daysSinceLastPurchase: daysSinceLast,
      overdueDays: Math.round(daysSinceLast - threshold),
    });
  }

  // Most overdue first
  results.sort((a, b) => b.overdueDays - a.overdueDays);
  return results.slice(0, limit);
}
