import { InvoiceStatus, InvoiceType, Prisma, Unit } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { amountInPieces, roundMoney } from "../utils/financial";
import { totalStock } from "../utils/product-stock";
import { assistantTimezone, dayKeyInTz, zonedDayRange } from "./daily-assistant.service";

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
  // Optional: absent means "no upper bound". A numeric default here silently
  // dropped the very oldest (most delinquent) debts from the dashboard table
  // while still counting them in the total-debt KPI.
  maxDays?: number;
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

// Day boundaries are computed in the SHOP timezone, not the server's.
//
// The container runs with no TZ set, so `setHours(0,0,0,0)` produced UTC
// midnight. In Baghdad (UTC+3) that made "today" run 03:00 → 02:59 the next
// day: a POS sale rung up at 00:30 local was attributed to the previous day by
// the dashboard, end-of-day report and cashier close, while the المساعد الذكي
// tab — which already used Asia/Baghdad — attributed it to the correct one.
// Two tabs of the same page disagreed, and the desktop's bundled backend
// (running in the user's local zone) produced a third answer.
//
// These now delegate to the same zonedDayRange/dayKeyInTz helpers the
// assistant uses, so every day bucket in the system agrees.
function shopDayKey(date: Date) {
  return dayKeyInTz(date, assistantTimezone());
}

function startOfDay(date: Date) {
  return zonedDayRange(shopDayKey(date), assistantTimezone()).start;
}

function endOfDay(date: Date) {
  return zonedDayRange(shopDayKey(date), assistantTimezone()).end;
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateFilter(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  const tz = assistantTimezone();
  const filter: Prisma.DateTimeFilter = {};
  // `from`/`to` arrive as plain YYYY-MM-DD. Resolving them in the shop zone
  // keeps a range picked in the UI aligned with the days the UI displays.
  if (from) filter.gte = zonedDayRange(from.slice(0, 10), tz).start;
  if (to) filter.lte = zonedDayRange(to.slice(0, 10), tz).end;
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

export function invoiceRevenueRatio(invoice: {
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
      // calculateProfit()/itemCostPrice() below only touch these fields —
      // full includes here pulled base64 product images + the whole invoice
      // row for every line item feeding profit calculations.
      product: { select: { costPrice: true, purchasePrice: true, pcsPerCarton: true, boxPieces: true } },
      invoice: { select: { date: true, subtotal: true, totalAmount: true } },
    },
  });
}

export function itemCostPrice(item: {
  unit: Unit;
  quantity: number;
  costPrice: DecimalLike;
  product: { costPrice: DecimalLike; purchasePrice: DecimalLike; pcsPerCarton: number; boxPieces?: number | null };
}) {
  // Use the snapshot costPrice if non-zero, else fall back to product.costPrice, else purchasePrice
  const snapshotCost = toNumber(item.costPrice);
  const productCost = toNumber(item.product.costPrice);
  const purchaseCost = toNumber(item.product.purchasePrice);
  const baseCost = snapshotCost > 0 ? snapshotCost : productCost > 0 ? productCost : purchaseCost;
  // baseCost is always a per-PIECE cost; amountInPieces covers all four units
  // (BOX resolves through effectiveBoxPieces — manual override or half carton).
  return baseCost * amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton, item.product.boxPieces);
}

// Accounting unit cost for valuing ON-HAND or DAMAGED stock: costPrice first
// (the weighted-average accounting cost), falling back to purchasePrice (which
// now means "last purchase price"). Same rule as inventory valuation /
// branch.service.ts. NOTE: sale-profit costing uses itemCostPrice() instead,
// which prefers the frozen invoiceItem.costPrice snapshot — do not mix them.
export function accountingUnitCost(product: { costPrice: DecimalLike; purchasePrice: DecimalLike }) {
  const cost = toNumber(product.costPrice);
  return cost > 0 ? cost : toNumber(product.purchasePrice);
}

function calculateProfit(items: Awaited<ReturnType<typeof getInvoiceItemsForProfit>>) {
  return roundMoney(items.reduce((sum, item) => {
    const revenue = toNumber(item.totalPrice) * invoiceRevenueRatio(item.invoice);
    const cost = itemCostPrice(item);
    return sum + (revenue - cost);
  }, 0));
}

export async function getDashboardReport() {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const sevenDaysAgo = startOfDay(addDays(now, -6));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    todaySales,
    todayReturns,
    todayInvoices,
    totalDebts,
    lowStockProducts,
    topProducts,
    topReturnProducts,
    lastSevenDaysInvoices,
    lastSevenDaysReturnInvoices,
  ] = await Promise.all([
    prisma.invoice.aggregate({
      where: {
        status: InvoiceStatus.ACTIVE,
        type: InvoiceType.SALE,
        date: { gte: todayStart, lte: todayEnd },
      },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.aggregate({
      where: {
        status: InvoiceStatus.ACTIVE,
        type: InvoiceType.SALES_RETURN,
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
        // Same rule as getDebtAging / getCustomerDebtsReport: a supplier's
        // positive balance is money WE owe, not customer debt. Mixing policies
        // meant the four aging buckets could never sum to this headline KPI.
        isSupplier: false,
        currentBalance: { gt: 0 },
      },
      _sum: { currentBalance: true },
    }),
    prisma.product.findMany({
      where: { deletedAt: null },
      // Only used for the low-stock count (totalStock() below) — a full
      // row pulls every product's base64 imageUrl/thumbnailUrl on every
      // dashboard load, which is the single most-hit endpoint in the app.
      select: {
        openingBalancePcs: true, cartonsAvailable: true, pcsPerCarton: true, minStock: true,
        warehouseStocks: { select: { quantityPieces: true } },
      },
    }),
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
        product: { select: { pcsPerCarton: true, boxPieces: true } },
      },
    }),
    prisma.invoiceItem.findMany({
      where: {
        invoice: {
          status: InvoiceStatus.ACTIVE,
          type: InvoiceType.SALES_RETURN,
          date: { gte: monthStart, lte: now },
        },
      },
      include: {
        invoice: true,
        product: { select: { pcsPerCarton: true, boxPieces: true } },
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
    prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.ACTIVE,
        type: InvoiceType.SALES_RETURN,
        date: { gte: sevenDaysAgo, lte: todayEnd },
      },
      select: {
        date: true,
        totalAmount: true,
      },
    }),
  ]);

  const lowStockCount = lowStockProducts.filter(
    (product) => totalStock(product) <= product.minStock
  ).length;

  const salesMap = new Map<string, number>();
  for (let i = 0; i < 7; i += 1) {
    salesMap.set(labelFor(addDays(sevenDaysAgo, i), "day"), 0);
  }
  for (const invoice of lastSevenDaysInvoices) {
    const key = labelFor(invoice.date, "day");
    salesMap.set(key, (salesMap.get(key) ?? 0) + toNumber(invoice.totalAmount));
  }
  for (const invoice of lastSevenDaysReturnInvoices) {
    const key = labelFor(invoice.date, "day");
    salesMap.set(key, (salesMap.get(key) ?? 0) - toNumber(invoice.totalAmount));
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
    current.quantitySold += amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton, item.product.boxPieces);
    current.totalSales += toNumber(item.totalPrice) * invoiceRevenueRatio(item.invoice);
    topProductMap.set(item.productId, current);
  }
  for (const item of topReturnProducts) {
    const current = topProductMap.get(item.productId) ?? {
      productId: item.productId,
      productName: item.productName,
      quantitySold: 0,
      totalSales: 0,
    };
    current.quantitySold -= amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton, item.product.boxPieces);
    current.totalSales -= toNumber(item.totalPrice) * invoiceRevenueRatio(item.invoice);
    topProductMap.set(item.productId, current);
  }

  return {
    todaySales: roundMoney(toNumber(todaySales._sum.totalAmount) - toNumber(todayReturns._sum.totalAmount)),
    todayInvoices,
    totalDebts: toNumber(totalDebts._sum.currentBalance),
    lowStockProducts: lowStockCount,
    topProductsThisMonth: Array.from(topProductMap.values())
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, 5),
    lastSevenDaysSales: Array.from(salesMap.entries()).map(([date, totalSales]) => ({
      date,
      totalSales: roundMoney(totalSales),
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
  const returnWhere: Prisma.InvoiceWhereInput = {
    status: InvoiceStatus.ACTIVE,
    type: InvoiceType.SALES_RETURN,
    ...(query.branchId ? { branchId: query.branchId } : {}),
    ...(dateFilter(query.from, query.to) ? { date: dateFilter(query.from, query.to) } : {}),
  };

  const [invoiceTotals, returnTotals, items, returnItems] = await Promise.all([
    prisma.invoice.aggregate({
      where: invoiceWhere,
      _sum: { totalAmount: true },
      _count: { id: true },
    }),
    prisma.invoice.aggregate({
      where: returnWhere,
      _sum: { totalAmount: true },
      _count: { id: true },
    }),
    getInvoiceItemsForProfit(invoiceWhere),
    getInvoiceItemsForProfit(returnWhere),
  ]);

  const chartMap = new Map<string, { totalSales: number; grossProfit: number }>();

  for (const item of items) {
    const key = labelFor(item.invoice.date, query.groupBy);
    const revenue = toNumber(item.totalPrice) * invoiceRevenueRatio(item.invoice);
    const cost = itemCostPrice(item);
    const current = chartMap.get(key) ?? { totalSales: 0, grossProfit: 0 };
    current.totalSales += revenue;
    current.grossProfit += revenue - cost;
    chartMap.set(key, current);
  }
  for (const item of returnItems) {
    const key = labelFor(item.invoice.date, query.groupBy);
    const revenue = toNumber(item.totalPrice) * invoiceRevenueRatio(item.invoice);
    const cost = itemCostPrice(item);
    const current = chartMap.get(key) ?? { totalSales: 0, grossProfit: 0 };
    current.totalSales -= revenue;
    current.grossProfit -= revenue - cost;
    chartMap.set(key, current);
  }

  return {
    totalSales: roundMoney(toNumber(invoiceTotals._sum.totalAmount) - toNumber(returnTotals._sum.totalAmount)),
    invoiceCount: invoiceTotals._count.id,
    // Gross profit = revenue minus cost of goods sold only (no losses/expenses).
    // Use getProfitReport() for net profit which subtracts losses and expenses.
    grossProfit: roundMoney(calculateProfit(items) - calculateProfit(returnItems)),
    chart: Array.from(chartMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, values]) => ({
        period,
        totalSales: roundMoney(values.totalSales),
        grossProfit: roundMoney(values.grossProfit),
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
  const [items, transferItems, lossItems] = await Promise.all([
    prisma.invoiceItem.findMany({
      where: {
        productId: query.productId,
        ...(query.branchId ? { warehouseId: query.branchId } : {}),
        invoice: {
          status: InvoiceStatus.ACTIVE,
          archivedAt: null,
          ...(invoicesDateFilter ? { date: invoicesDateFilter } : {}),
        },
      },
      include: {
        warehouse: { select: { name: true } },
        invoice: {
          include: {
            customer: true,
          },
        },
        product: { select: { pcsPerCarton: true, boxPieces: true } },
      },
    }),
    prisma.transferItem.findMany({
      where: {
        productId: query.productId,
        transfer: {
          status: "COMPLETED",
          ...(query.branchId
            ? { OR: [{ fromBranchId: query.branchId }, { toBranchId: query.branchId }] }
            : {}),
          ...(invoicesDateFilter ? { date: invoicesDateFilter } : {}),
        },
      },
      include: {
        transfer: {
          include: {
            fromBranch: { select: { name: true } },
            toBranch: { select: { name: true } },
          },
        },
      },
    }),
    prisma.stockLossItem.findMany({
      where: {
        productId: query.productId,
        loss: {
          cancelledAt: null,
          ...(query.branchId ? { warehouseId: query.branchId } : {}),
          ...(invoicesDateFilter ? { date: invoicesDateFilter } : {}),
        },
      },
      include: {
        loss: {
          include: {
            warehouse: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const invoiceRows = items.map((item) => ({
    date: item.invoice.date,
    movementType: item.invoice.type,
    movementLabel:
      item.invoice.type === InvoiceType.SALE
        ? "بيع"
        : item.invoice.type === InvoiceType.PURCHASE
          ? "شراء"
          : "مرتجع مبيعات",
    customerName: item.invoice.customer.name,
    warehouseName: item.warehouse?.name ?? null,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: toNumber(item.unitPrice),
    totalPrice: toNumber(item.totalPrice) * invoiceRevenueRatio(item.invoice),
    invoiceNumber: item.invoice.invoiceNumber,
    invoiceId: item.invoice.id,
  }));

  const transferRows = transferItems.map((item) => ({
    date: item.transfer.date,
    movementType: "TRANSFER",
    movementLabel: "تحويل",
    customerName: `${item.transfer.fromBranch.name} ← ${item.transfer.toBranch.name}`,
    warehouseName: `${item.transfer.fromBranch.name} ← ${item.transfer.toBranch.name}`,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: null,
    totalPrice: null,
    invoiceNumber: item.transfer.transferNumber,
    invoiceId: null,
  }));

  const lossRows = lossItems.map((item) => ({
    date: item.loss.date,
    movementType: "LOSS",
    movementLabel: "تلف / خسارة",
    customerName: item.loss.warehouse.name,
    warehouseName: item.loss.warehouse.name,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: null,
    totalPrice: null,
    invoiceNumber: item.loss.lossNumber,
    invoiceId: null,
  }));

  const rows = [...invoiceRows, ...transferRows, ...lossRows].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return {
    product: {
      id: product.id,
      itemNumber: product.itemNumber,
      name: product.name,
    },
    rows,
    totals: {
      quantitySold: items.reduce(
        (sum, item) => sum + amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton, item.product.boxPieces),
        0
      ),
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
    // Explicit select: imageUrl/thumbnailUrl are @db.Text base64 and the
    // dashboard calls this on every load (and every 120s refetch) just to build
    // a category pie chart. A bare findMany shipped every product image twice.
    select: {
      id: true,
      itemNumber: true,
      name: true,
      category: true,
      openingBalancePcs: true,
      cartonsAvailable: true,
      pcsPerCarton: true,
      purchasePrice: true,
      costPrice: true,
      salePrice: true,
      warehouseStocks: { select: { quantityPieces: true } },
    },
    orderBy: { itemNumber: "asc" },
  });

  const rows = products.map((product) => {
    const quantity = totalStock(product);
    // Inventory is valued at the accounting cost: costPrice first, falling back
    // to purchasePrice when no cost is set. Same rule as branch.service.ts so
    // both stock-valuation views agree. purchasePrice now means "last purchase
    // price" and is kept only for display, not for the valuation math.
    const unitCost =
      toNumber(product.costPrice) > 0 ? toNumber(product.costPrice) : toNumber(product.purchasePrice);
    const purchaseValue = quantity * unitCost;
    const saleValue = quantity * toNumber(product.salePrice);

    return {
      id: product.id,
      itemNumber: product.itemNumber,
      name: product.name,
      category: product.category,
      currentStock: quantity,
      purchasePrice: toNumber(product.purchasePrice),
      costPrice: unitCost,
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
      isSupplier: false,
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
        (query.maxDays === undefined || customer.debtAgeDays <= query.maxDays)
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
  const [customers, returnsByCustomer] = await Promise.all([
    prisma.customer.findMany({
      // Soft-deleted customers were still ranked, showing as "—".
      where: { id: { in: customerIds }, deletedAt: null },
      select: { id: true, name: true, phone: true, currentBalance: true },
    }),
    // Gross SALE totals alone rank a customer who bought 10M and returned 9M
    // above one who genuinely bought 5M — and عقل المحل, which DOES net
    // returns, then shows a different number for the same customer.
    prisma.invoice.groupBy({
      by: ["customerId"],
      where: {
        status: InvoiceStatus.ACTIVE,
        type: InvoiceType.SALES_RETURN,
        customerId: { in: customerIds },
        ...(df ? { date: df } : {}),
      },
      _sum: { totalAmount: true, paidAmount: true },
    }),
  ]);
  const returnMap = new Map(returnsByCustomer.map((r) => [r.customerId, r]));

  return grouped.map((g) => {
    const cust = customers.find((c) => c.id === g.customerId);
    const returned = returnMap.get(g.customerId);
    return {
      customerId: g.customerId,
      name: cust?.name ?? "—",
      phone: cust?.phone ?? "",
      currentBalance: toNumber(cust?.currentBalance),
      totalPurchases: roundMoney(
        toNumber(g._sum.totalAmount) - toNumber(returned?._sum.totalAmount),
      ),
      totalPaid: roundMoney(
        toNumber(g._sum.paidAmount) - toNumber(returned?._sum.paidAmount),
      ),
      invoiceCount: g._count.id,
    };
  });
}

// ── End-of-Day summary ────────────────────────────────────────────────────
export async function getEndOfDayReport(date?: string) {
  // Shop-timezone day, same as every other day bucket in this file.
  //
  // A plain "YYYY-MM-DD" is resolved DIRECTLY in the shop zone rather than
  // parsed to a Date first: `new Date("2026-08-01")` is midnight UTC, and for
  // any shop west of Greenwich that instant still belongs to 31 July locally,
  // so the round-trip would silently report the wrong day.
  const tz = assistantTimezone();
  const { start, end } = date
    ? zonedDayRange(date.slice(0, 10), tz)
    : zonedDayRange(dayKeyInTz(new Date(), tz), tz);

  const [invoices, vouchers] = await Promise.all([
    prisma.invoice.findMany({
      where: { date: { gte: start, lte: end }, status: "ACTIVE" },
      include: { customer: { select: { name: true } } },
    }),
    prisma.paymentVoucher.findMany({
      where: { date: { gte: start, lte: end }, archivedAt: null, cancelledAt: null },
      include: { customer: { select: { name: true } } },
    }),
  ]);

  const saleInvoices = invoices.filter((i) => i.type === "SALE");
  const salesReturns = invoices.filter((i) => i.type === "SALES_RETURN");
  const purchaseInvoices = invoices.filter((i) => i.type === "PURCHASE");
  const receipts = vouchers.filter((v) => v.type === "RECEIPT");
  const payments = vouchers.filter((v) => v.type === "PAYMENT");
  const expenses = vouchers.filter((v) => v.type === "EXPENSE");

  // Cash vs credit breakdown
  const cashSales   = saleInvoices.filter((i) => i.paymentType === "CASH");
  const creditSales = saleInvoices.filter((i) => i.paymentType !== "CASH");

  return {
    date: start.toISOString().slice(0, 10),
    sales: {
      count: saleInvoices.length,
      returnCount: salesReturns.length,
      returnTotal: roundMoney(salesReturns.reduce((s, i) => s + toNumber(i.totalAmount), 0)),
      total: roundMoney(
        saleInvoices.reduce((s, i) => s + toNumber(i.totalAmount), 0) -
        salesReturns.reduce((s, i) => s + toNumber(i.totalAmount), 0)
      ),
      collected: roundMoney(
        saleInvoices.reduce((s, i) => s + toNumber(i.paidAmount), 0) -
        salesReturns.reduce((s, i) => s + toNumber(i.paidAmount), 0)
      ),
      cashCount: cashSales.length,
      cashTotal: cashSales.reduce((s, i) => s + toNumber(i.totalAmount), 0),
      creditCount: creditSales.length,
      creditTotal: creditSales.reduce((s, i) => s + toNumber(i.totalAmount), 0),
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
    invoices: saleInvoices.slice(0, 50).map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      customerName: i.customer?.name ?? "—",
      total: toNumber(i.totalAmount),
      paid: toNumber(i.paidAmount),
      paymentType: i.paymentType,
    })),
  };
}

// ── Today's Collections Summary (lightweight, NOT feature-gated) ─────────
// Reuses getEndOfDayReport's own aggregation instead of re-querying, so the
// numbers can never drift from the (dailyClosing-gated) full end-of-day
// report. netCash mirrors the exact "صافي الصندوق" formula used on the
// Reports → End-of-Day tab: cash collected from sales + receipt vouchers −
// payment vouchers − expense vouchers.
export async function getCollectionsSummary(date?: string) {
  const r = await getEndOfDayReport(date);
  const netCash = roundMoney(
    r.sales.collected + r.receipts.total - r.payments.total - r.expenses.total
  );
  return {
    date: r.date,
    cashSales: { total: roundMoney(r.sales.cashTotal), count: r.sales.cashCount },
    creditSales: { total: roundMoney(r.sales.creditTotal), count: r.sales.creditCount },
    receipts: { total: roundMoney(r.receipts.total), count: r.receipts.count },
    netCash,
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
    todayReturnsAgg,
    yesterdaySalesAgg,
    yesterdayReturnsAgg,
    receiptsToday,
    allProducts,
    topItemsToday,
    topReturnItemsToday,
    overdueCustomers,
    last28Invoices,
    last28Returns,
  ] = await Promise.all([
    prisma.invoice.aggregate({
      where: { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE, date: { gte: todayStart, lte: todayEnd } },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALES_RETURN, date: { gte: todayStart, lte: todayEnd } },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE, date: { gte: yesterdayStart, lte: yesterdayEnd } },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALES_RETURN, date: { gte: yesterdayStart, lte: yesterdayEnd } },
      _sum: { totalAmount: true },
    }),
    prisma.paymentVoucher.aggregate({
      where: { type: "RECEIPT", date: { gte: todayStart, lte: todayEnd }, archivedAt: null, cancelledAt: null },
      _sum: { amount: true },
    }),
    prisma.product.findMany({
      where: { deletedAt: null },
      // Only used for the low-stock count/names below — same rationale as
      // getDashboardReport's identical query above.
      select: {
        name: true, openingBalancePcs: true, cartonsAvailable: true, pcsPerCarton: true, minStock: true,
        warehouseStocks: { select: { quantityPieces: true } },
      },
    }),
    prisma.invoiceItem.findMany({
      where: {
        invoice: {
          status: InvoiceStatus.ACTIVE,
          type: InvoiceType.SALE,
          date: { gte: todayStart, lte: todayEnd },
        },
      },
      select: {
        productId: true,
        productName: true,
        quantity: true,
        unit: true,
        product: { select: { pcsPerCarton: true, boxPieces: true } },
      },
    }),
    prisma.invoiceItem.findMany({
      where: {
        invoice: {
          status: InvoiceStatus.ACTIVE,
          type: InvoiceType.SALES_RETURN,
          date: { gte: todayStart, lte: todayEnd },
        },
      },
      select: {
        productId: true,
        productName: true,
        quantity: true,
        unit: true,
        product: { select: { pcsPerCarton: true, boxPieces: true } },
      },
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
    prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.ACTIVE,
        type: InvoiceType.SALES_RETURN,
        date: { gte: last28Start, lte: yesterdayEnd },
      },
      select: { date: true, totalAmount: true },
    }),
  ]);

  const todaySales = toNumber(todaySalesAgg._sum.totalAmount) - toNumber(todayReturnsAgg._sum.totalAmount);
  const yesterdaySales = toNumber(yesterdaySalesAgg._sum.totalAmount) - toNumber(yesterdayReturnsAgg._sum.totalAmount);
  const salesChangePercent =
    yesterdaySales > 0
      ? Math.round(((todaySales - yesterdaySales) / yesterdaySales) * 100)
      : null;

  const collectionsToday = toNumber(receiptsToday._sum.amount);

  const lowStockItems = allProducts.filter(
    // No `>= 0` floor: an oversold product at −12 pieces is the most urgent
    // restock in the shop. Excluding it made the 9 PM WhatsApp summary report a
    // smaller count than the dashboard card, which uses this same predicate.
    (p) => totalStock(p) <= p.minStock
  );
  const lowStockNames = lowStockItems.slice(0, 3).map((p) => p.name);

  const topProductMap = new Map<string, { name: string; quantity: number }>();
  for (const item of topItemsToday) {
    const cur = topProductMap.get(item.productId) ?? { name: item.productName, quantity: 0 };
    cur.quantity += amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton, item.product.boxPieces);
    topProductMap.set(item.productId, cur);
  }
  for (const item of topReturnItemsToday) {
    const cur = topProductMap.get(item.productId) ?? { name: item.productName, quantity: 0 };
    cur.quantity -= amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton, item.product.boxPieces);
    topProductMap.set(item.productId, cur);
  }
  const topProduct = topProductMap.size > 0
    ? Array.from(topProductMap.values()).sort((a, b) => b.quantity - a.quantity)[0]
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
  for (const inv of last28Returns) {
    const key = labelFor(inv.date, "day");
    dailyMap.set(key, (dailyMap.get(key) ?? 0) - toNumber(inv.totalAmount));
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
  for (const inv of last28Returns) {
    if (new Date(inv.date).getDay() !== dayOfWeek) continue;
    const key = labelFor(inv.date, "day");
    sameDowMap.set(key, (sameDowMap.get(key) ?? 0) - toNumber(inv.totalAmount));
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

// ── Profit Report ─────────────────────────────────────────────────────────────

export interface ProfitReportQuery {
  from?: string;
  to?: string;
  groupBy?: "day" | "week" | "month";
}

export async function getProfitReport(query: ProfitReportQuery) {
  const df = dateFilter(query.from, query.to);
  const gBy = query.groupBy ?? "month";

  const [saleItems, returnItems] = await Promise.all([
    prisma.invoiceItem.findMany({
      where: {
        invoice: {
          status: InvoiceStatus.ACTIVE,
          type: InvoiceType.SALE,
          ...(df ? { date: df } : {}),
        },
      },
      include: {
        // itemCostPrice()/amountInPieces() only need these 4 fields — a full
        // `product: true` pulls base64 images per line item over the whole
        // report date range (unbounded — can be a full year of invoices).
        product: { select: { costPrice: true, purchasePrice: true, pcsPerCarton: true, boxPieces: true } },
        invoice: { select: { date: true, subtotal: true, totalAmount: true } },
      },
    }),
    prisma.invoiceItem.findMany({
      where: {
        invoice: {
          status: InvoiceStatus.ACTIVE,
          type: InvoiceType.SALES_RETURN,
          ...(df ? { date: df } : {}),
        },
      },
      include: {
        // itemCostPrice()/amountInPieces() only need these 4 fields — a full
        // `product: true` pulls base64 images per line item over the whole
        // report date range (unbounded — can be a full year of invoices).
        product: { select: { costPrice: true, purchasePrice: true, pcsPerCarton: true, boxPieces: true } },
        invoice: { select: { date: true, subtotal: true, totalAmount: true } },
      },
    }),
  ]);

  // Group by period
  const periodMap = new Map<string, { revenue: number; cost: number }>();
  for (const item of saleItems) {
    const label = labelFor(item.invoice.date, gBy);
    const existing = periodMap.get(label) ?? { revenue: 0, cost: 0 };
    const revenue = toNumber(item.totalPrice) * invoiceRevenueRatio(item.invoice);
    const cost = itemCostPrice({ ...item, product: item.product });
    periodMap.set(label, {
      revenue: existing.revenue + revenue,
      cost: existing.cost + cost,
    });
  }
  for (const item of returnItems) {
    const label = labelFor(item.invoice.date, gBy);
    const existing = periodMap.get(label) ?? { revenue: 0, cost: 0 };
    const revenue = toNumber(item.totalPrice) * invoiceRevenueRatio(item.invoice);
    const cost = itemCostPrice(item);
    periodMap.set(label, {
      revenue: existing.revenue - revenue,
      cost: existing.cost - cost,
    });
  }

  const periodData = Array.from(periodMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, { revenue, cost }]) => ({
      period,
      revenue: Math.round(revenue),
      cost: Math.round(cost),
      profit: Math.round(revenue - cost),
      margin: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : 0,
    }));

  // Per-product profit
  const productMap = new Map<string, { name: string; revenue: number; cost: number; qty: number }>();
  for (const item of saleItems) {
    const existing = productMap.get(item.productId) ?? { name: item.productName, revenue: 0, cost: 0, qty: 0 };
    const revenue = toNumber(item.totalPrice) * invoiceRevenueRatio(item.invoice);
    const cost = itemCostPrice({ ...item, product: item.product });
    productMap.set(item.productId, {
      name: item.productName,
      revenue: existing.revenue + revenue,
      cost: existing.cost + cost,
      qty: existing.qty + amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton, item.product.boxPieces),
    });
  }
  for (const item of returnItems) {
    const existing = productMap.get(item.productId) ?? { name: item.productName, revenue: 0, cost: 0, qty: 0 };
    const revenue = toNumber(item.totalPrice) * invoiceRevenueRatio(item.invoice);
    const cost = itemCostPrice(item);
    productMap.set(item.productId, {
      name: item.productName,
      revenue: existing.revenue - revenue,
      cost: existing.cost - cost,
      qty: existing.qty - amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton, item.product.boxPieces),
    });
  }

  const topProducts = Array.from(productMap.entries())
    .map(([id, { name, revenue, cost, qty }]) => ({
      id,
      name,
      revenue: Math.round(revenue),
      cost: Math.round(cost),
      profit: Math.round(revenue - cost),
      margin: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : 0,
      qty,
    }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 20);

  const totalRevenue = periodData.reduce((s, p) => s + p.revenue, 0);
  const totalCost = periodData.reduce((s, p) => s + p.cost, 0);
  const totalProfit = totalRevenue - totalCost;

  // Fetch losses and expenses to compute net profit
  const [lossItems, expenseVouchers] = await Promise.all([
    prisma.stockLossItem.findMany({
      where: {
        loss: {
          cancelledAt: null,
          ...(df ? { date: df } : {}),
        },
      },
      include: {
        product: { select: { costPrice: true, purchasePrice: true, pcsPerCarton: true, boxPieces: true } },
        // direction distinguishes automatic corrections that REDUCED recognized
        // profit (LOSS — manual "خسائر/تلف", or a shrinkage found in an
        // adjust-stock/cycle-count/stocktake correction) from ones that ADDED to
        // it (GAIN — an overage found in the same automatic flows). Pre-existing
        // rows all default to LOSS so historical totals are unaffected.
        loss: { select: { direction: true } },
      },
    }),
    prisma.paymentVoucher.findMany({
      where: {
        type: "EXPENSE",
        cancelledAt: null,
        ...(df ? { date: df } : {}),
      },
      select: { amount: true, category: true },
    }),
  ]);

  const lossItemCost = (item: (typeof lossItems)[number]) => {
    // Prefer the piece count frozen at loss time; only legacy rows (null) fall
    // back to a live re-computation, which can drift if pcsPerCarton changed.
    const pcs =
      item.quantityPieces ??
      amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton, item.product.boxPieces);
    // Prefer the frozen snapshot stockLossItem.costPrice (cost at loss time);
    // fall back to the live accounting cost (costPrice → purchasePrice) only
    // when the snapshot is missing/zero. Same freeze model as sale invoices.
    const snapshot = toNumber(item.costPrice);
    const unitCost = snapshot > 0 ? snapshot : accountingUnitCost(item.product);
    return pcs * unitCost;
  };
  const lossesTotal = Math.round(
    lossItems
      .filter((item) => item.loss.direction !== "GAIN")
      .reduce((s, item) => s + lossItemCost(item), 0),
  );
  const gainsTotal = Math.round(
    lossItems
      .filter((item) => item.loss.direction === "GAIN")
      .reduce((s, item) => s + lossItemCost(item), 0),
  );
  const expensesTotal = Math.round(
    expenseVouchers.reduce((s, v) => s + toNumber(v.amount), 0),
  );
  const netProfit = Math.round(totalProfit - lossesTotal + gainsTotal - expensesTotal);

  // Breakdown by category (كهرباء/إيجار/رواتب/...) — uncategorized vouchers
  // (created before this field existed, or left blank) group under "أخرى".
  const expensesByCategoryMap = new Map<string, number>();
  for (const v of expenseVouchers) {
    const key = v.category?.trim() || "أخرى";
    expensesByCategoryMap.set(key, (expensesByCategoryMap.get(key) ?? 0) + toNumber(v.amount));
  }
  const expensesByCategory = [...expensesByCategoryMap.entries()]
    .map(([category, amount]) => ({ category, amount: Math.round(amount) }))
    .sort((a, b) => b.amount - a.amount);

  return {
    periods: periodData,
    topProducts,
    summary: {
      totalRevenue: Math.round(totalRevenue),
      totalCost: Math.round(totalCost),
      totalProfit: Math.round(totalProfit),
      lossesTotal,
      gainsTotal,
      expensesTotal,
      expensesByCategory,
      netProfit,
      avgMargin: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0,
    },
  };
}

// ── Warehouse/branch comparison ───────────────────────────────────────────────
// This shop is architecturally one sales point (المحل) plus N depot warehouses
// that never sell directly (see resolveShopWarehouseId) — so "sales by branch"
// alone would show one meaningful bar today. This report ALSO surfaces
// warehouse ACTIVITY (stock in/out, transfers) so depot comparison is useful
// right now, while staying ready for a genuine multi-shop future where every
// warehouse carries its own sales too.
export interface WarehouseComparisonQuery {
  from?: string;
  to?: string;
}

export async function getWarehouseComparisonReport(query: WarehouseComparisonQuery) {
  const df = dateFilter(query.from, query.to);

  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  const branchIds = branches.map((b) => b.id);

  const [stockByWarehouse, movements, transfersOut, transfersIn, saleItems] = await Promise.all([
    prisma.productWarehouseStock.groupBy({
      by: ["warehouseId"],
      // deleteProduct only sets deletedAt — the stock rows survive with their
      // quantities. Without this filter مقارنة المخازن keeps counting stock the
      // inventory report has already dropped, and the two totals on the same
      // page disagree permanently.
      where: { warehouseId: { in: branchIds }, product: { deletedAt: null } },
      _sum: { quantityPieces: true },
    }),
    // StockMovement.branchId is the WAREHOUSE the movement happened in (see
    // applyStockMovement / executeTransferWithin) — not Invoice.branchId.
    prisma.stockMovement.groupBy({
      by: ["branchId", "type"],
      where: { branchId: { in: branchIds }, ...(df ? { createdAt: df } : {}) },
      _sum: { quantity: true },
    }),
    // Only COMPLETED transfers are activity. Counting PENDING drafts and
    // CANCELLED transfers made a depot with three abandoned drafts look busier
    // than one with two real transfers. getProductMovementReport already
    // filters this way.
    prisma.inventoryTransfer.groupBy({
      by: ["fromBranchId"],
      where: {
        fromBranchId: { in: branchIds },
        status: "COMPLETED",
        ...(df ? { date: df } : {}),
      },
      _count: true,
    }),
    prisma.inventoryTransfer.groupBy({
      by: ["toBranchId"],
      where: {
        toBranchId: { in: branchIds },
        status: "COMPLETED",
        ...(df ? { date: df } : {}),
      },
      _count: true,
    }),
    // Sales revenue/profit per branch — Invoice.branchId (office/customer branch,
    // set from input.branchId ?? customer.branchId), NOT the warehouse the stock
    // physically left from. Ready for a real multi-shop setup; today it mostly
    // collapses onto whichever branch new invoices default to.
    prisma.invoiceItem.findMany({
      where: {
        invoice: {
          status: InvoiceStatus.ACTIVE,
          type: InvoiceType.SALE,
          branchId: { in: branchIds },
          ...(df ? { date: df } : {}),
        },
      },
      include: {
        // itemCostPrice() needs four fields; `product: true` pulled every line
        // item's base64 image over an unbounded, all-time-by-default range.
        product: {
          select: {
            costPrice: true,
            purchasePrice: true,
            pcsPerCarton: true,
            boxPieces: true,
          },
        },
        invoice: { select: { branchId: true, subtotal: true, totalAmount: true } },
      },
    }),
  ]);

  const stockMap = new Map(stockByWarehouse.map((s) => [s.warehouseId, s._sum.quantityPieces ?? 0]));
  const inMap = new Map<string, number>();
  const outMap = new Map<string, number>();
  for (const m of movements) {
    if (!m.branchId) continue;
    const target = m.type === "IN" ? inMap : m.type === "OUT" ? outMap : null;
    if (!target) continue;
    target.set(m.branchId, (target.get(m.branchId) ?? 0) + (m._sum.quantity ?? 0));
  }
  const transfersOutMap = new Map(transfersOut.map((t) => [t.fromBranchId, t._count]));
  const transfersInMap = new Map(transfersIn.map((t) => [t.toBranchId, t._count]));

  const salesMap = new Map<string, { revenue: number; profit: number }>();
  for (const item of saleItems) {
    const bId = item.invoice.branchId;
    if (!bId) continue;
    const existing = salesMap.get(bId) ?? { revenue: 0, profit: 0 };
    const revenue = toNumber(item.totalPrice) * invoiceRevenueRatio(item.invoice);
    const cost = itemCostPrice({ ...item, product: item.product });
    salesMap.set(bId, { revenue: existing.revenue + revenue, profit: existing.profit + (revenue - cost) });
  }

  return branches.map((b) => ({
    id: b.id,
    name: b.name,
    currentStockPieces: stockMap.get(b.id) ?? 0,
    stockInPieces: inMap.get(b.id) ?? 0,
    stockOutPieces: outMap.get(b.id) ?? 0,
    transfersOutCount: transfersOutMap.get(b.id) ?? 0,
    transfersInCount: transfersInMap.get(b.id) ?? 0,
    salesRevenue: Math.round(salesMap.get(b.id)?.revenue ?? 0),
    salesProfit: Math.round(salesMap.get(b.id)?.profit ?? 0),
  }));
}

// ── Cross-sell ("bought together") ────────────────────────────────────────────
// Product-pair co-occurrence within the same ACTIVE sale invoice. No existing
// market-basket analysis in this codebase — computed from scratch by grouping
// InvoiceItem rows by invoiceId, then counting every unique pair per invoice.
// Simple O(items) + O(pairs-per-invoice²) approach — fine at this shop's scale;
// revisit if invoice sizes or history grow large enough to matter.
export interface CrossSellQuery {
  from?: string;
  to?: string;
  productId?: string;
  limit?: number;
}

export async function getCrossSellPairs(query: CrossSellQuery) {
  const df = dateFilter(query.from, query.to);
  const limit = Math.min(query.limit ?? 20, 100);

  const items = await prisma.invoiceItem.findMany({
    where: {
      invoice: { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE, ...(df ? { date: df } : {}) },
    },
    select: { invoiceId: true, productId: true, productName: true },
  });

  const byInvoice = new Map<string, Array<{ id: string; name: string }>>();
  for (const it of items) {
    const list = byInvoice.get(it.invoiceId) ?? [];
    // De-dup the same product appearing on more than one line of the same
    // invoice (different units/warehouses) — a pair should count once per invoice.
    if (!list.some((p) => p.id === it.productId)) list.push({ id: it.productId, name: it.productName });
    byInvoice.set(it.invoiceId, list);
  }

  const pairCounts = new Map<string, { a: { id: string; name: string }; b: { id: string; name: string }; count: number }>();
  for (const products of byInvoice.values()) {
    if (products.length < 2) continue;
    for (let i = 0; i < products.length; i++) {
      for (let j = i + 1; j < products.length; j++) {
        if (query.productId && products[i].id !== query.productId && products[j].id !== query.productId) continue;
        const [a, b] = products[i].id < products[j].id ? [products[i], products[j]] : [products[j], products[i]];
        const key = `${a.id}:${b.id}`;
        const existing = pairCounts.get(key);
        if (existing) existing.count += 1;
        else pairCounts.set(key, { a, b, count: 1 });
      }
    }
  }

  return [...pairCounts.values()]
    .sort((x, y) => y.count - x.count)
    .slice(0, limit)
    .map((p) => ({ productA: p.a, productB: p.b, count: p.count }));
}

// ── «عقل المحل» — Store Brain (smart profit dashboard) ────────────────────────
// Gross profit per product/customer/employee/day-of-week (revenue − snapshot COGS),
// net profit month-over-month, and "fake star" / "promote" classification.
export interface StoreBrainQuery {
  from?: string;
  to?: string;
}

export async function getStoreBrainReport(query: StoreBrainQuery) {
  const now = new Date();
  const curStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const curEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  // Month-over-month net profit (always calendar months) — reuse getProfitReport.
  const [curReport, prevReport] = await Promise.all([
    getProfitReport({ from: iso(curStart), to: iso(curEnd), groupBy: "month" }),
    getProfitReport({ from: iso(prevStart), to: iso(prevEnd), groupBy: "month" }),
  ]);
  const pct = (cur: number, prev: number) =>
    prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / Math.abs(prev)) * 100);

  // Breakdowns over the selected range (default = current month).
  const from = query.from ?? iso(curStart);
  const to = query.to ?? iso(curEnd);
  const df = dateFilter(from, to);
  const include = {
    // itemCostPrice()/amountInPieces() below only touch these 4 fields.
    product: { select: { costPrice: true, purchasePrice: true, pcsPerCarton: true, boxPieces: true } },
    invoice: {
      select: {
        date: true, subtotal: true, totalAmount: true, createdBy: true, customerId: true,
        creator: { select: { name: true } },
        customer: { select: { name: true } },
      },
    },
  };

  const [saleItems, returnItems] = await Promise.all([
    prisma.invoiceItem.findMany({
      where: { invoice: { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE, ...(df ? { date: df } : {}) } },
      include,
    }),
    prisma.invoiceItem.findMany({
      where: { invoice: { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALES_RETURN, ...(df ? { date: df } : {}) } },
      include,
    }),
  ]);

  type Agg = { name: string; revenue: number; cost: number; qty: number };
  const products = new Map<string, Agg>();
  const customers = new Map<string, Agg>();
  const employees = new Map<string, Agg>();
  const dow = new Map<number, { revenue: number; cost: number }>();

  const accumulate = (items: typeof saleItems, sign: 1 | -1) => {
    for (const item of items) {
      const revenue = toNumber(item.totalPrice) * invoiceRevenueRatio(item.invoice) * sign;
      const cost = itemCostPrice({ ...item, product: item.product }) * sign;
      const qty = amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton, item.product.boxPieces) * sign;

      const p = products.get(item.productId) ?? { name: item.productName, revenue: 0, cost: 0, qty: 0 };
      products.set(item.productId, { name: item.productName, revenue: p.revenue + revenue, cost: p.cost + cost, qty: p.qty + qty });

      const custName = item.invoice.customer?.name ?? "—";
      const c = customers.get(item.invoice.customerId) ?? { name: custName, revenue: 0, cost: 0, qty: 0 };
      customers.set(item.invoice.customerId, { name: custName, revenue: c.revenue + revenue, cost: c.cost + cost, qty: c.qty + qty });

      const empName = item.invoice.creator?.name ?? "—";
      const e = employees.get(item.invoice.createdBy) ?? { name: empName, revenue: 0, cost: 0, qty: 0 };
      employees.set(item.invoice.createdBy, { name: empName, revenue: e.revenue + revenue, cost: e.cost + cost, qty: e.qty + qty });

      const d = new Date(item.invoice.date).getDay();
      const day = dow.get(d) ?? { revenue: 0, cost: 0 };
      dow.set(d, { revenue: day.revenue + revenue, cost: day.cost + cost });
    }
  };
  accumulate(saleItems, 1);
  accumulate(returnItems, -1);

  const toRow = (id: string, a: Agg) => ({
    id,
    name: a.name,
    revenue: Math.round(a.revenue),
    profit: Math.round(a.revenue - a.cost),
    margin: a.revenue > 0 ? Math.round(((a.revenue - a.cost) / a.revenue) * 100) : 0,
    qty: a.qty,
  });

  const productRows = Array.from(products.entries()).map(([id, a]) => toRow(id, a));

  // Smart classification via tertiles over products that actually sold.
  const sold = productRows.filter((r) => r.qty > 0);
  const qtySorted = sold.map((r) => r.qty).sort((a, b) => a - b);
  const marginSorted = sold.map((r) => r.margin).sort((a, b) => a - b);
  const tertile = (arr: number[], frac: number) => (arr.length ? arr[Math.floor((arr.length - 1) * frac)] : 0);
  const qtyHi = tertile(qtySorted, 2 / 3);
  const qtyLo = tertile(qtySorted, 1 / 3);
  const marginHi = tertile(marginSorted, 2 / 3);
  const marginLo = tertile(marginSorted, 1 / 3);
  const classify = (r: { qty: number; margin: number }): "fake_star" | "promote" | null => {
    if (r.qty <= 0) return null;
    if (r.qty >= qtyHi && r.margin <= marginLo) return "fake_star"; // sells a lot, low margin
    if (r.margin >= marginHi && r.qty <= qtyLo) return "promote"; // high margin, sells little
    return null;
  };
  const byProduct = productRows
    .map((r) => ({ ...r, flag: classify(r) }))
    .sort((a, b) => b.profit - a.profit);

  const dayNames = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

  return {
    comparison: {
      current: {
        label: iso(curStart).slice(0, 7),
        netProfit: curReport.summary.netProfit,
        grossProfit: curReport.summary.totalProfit,
        revenue: curReport.summary.totalRevenue,
        margin: curReport.summary.avgMargin,
      },
      previous: {
        label: iso(prevStart).slice(0, 7),
        netProfit: prevReport.summary.netProfit,
        grossProfit: prevReport.summary.totalProfit,
        revenue: prevReport.summary.totalRevenue,
        margin: prevReport.summary.avgMargin,
      },
      change: {
        netProfitPct: pct(curReport.summary.netProfit, prevReport.summary.netProfit),
        grossProfitPct: pct(curReport.summary.totalProfit, prevReport.summary.totalProfit),
        revenuePct: pct(curReport.summary.totalRevenue, prevReport.summary.totalRevenue),
      },
    },
    range: { from, to },
    byProduct: byProduct.slice(0, 50),
    fakeStars: byProduct.filter((r) => r.flag === "fake_star").slice(0, 10),
    promote: byProduct.filter((r) => r.flag === "promote").slice(0, 10),
    byCustomer: Array.from(customers.entries()).map(([id, a]) => toRow(id, a)).sort((a, b) => b.profit - a.profit).slice(0, 15),
    byEmployee: Array.from(employees.entries()).map(([id, a]) => toRow(id, a)).sort((a, b) => b.profit - a.profit),
    byDayOfWeek: Array.from(dow.entries())
      .map(([d, v]) => ({ day: d, name: dayNames[d], revenue: Math.round(v.revenue), profit: Math.round(v.revenue - v.cost) }))
      .sort((a, b) => a.day - b.day),
  };
}

// ── Bulk Debt Reminder ────────────────────────────────────────────────────────

export async function getDebtCustomersForReminder(minDays: number) {
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null, currentBalance: { gt: 0 } },
    orderBy: { currentBalance: "desc" },
  });

  const now = Date.now();
  return customers
    .map((c) => {
      const lastDate = c.lastTransactionAt ?? c.createdAt;
      const debtAgeDays = Math.floor((now - lastDate.getTime()) / 86400000);
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        currentBalance: toNumber(c.currentBalance),
        debtAgeDays,
        lastTransactionAt: c.lastTransactionAt?.toISOString() ?? null,
      };
    })
    .filter((c) => c.debtAgeDays >= minDays);
}

// ── Bulk Inactive-Customer Reminder ───────────────────────────────────────────

export async function getInactiveCustomersForReminder(minDays: number) {
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    orderBy: { lastTransactionAt: "asc" },
  });

  const now = Date.now();
  return customers
    .map((c) => {
      const lastDate = c.lastTransactionAt ?? c.createdAt;
      const inactiveDays = Math.floor((now - lastDate.getTime()) / 86400000);
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        currentBalance: toNumber(c.currentBalance),
        inactiveDays,
        lastTransactionAt: c.lastTransactionAt?.toISOString() ?? null,
      };
    })
    .filter((c) => c.inactiveDays >= minDays);
}

// ── Customer Ratings (A/B/C) ──────────────────────────────────────────────────

export type CustomerRating = "A" | "B" | "C";

export interface CustomerRatingEntry {
  id: string;
  name: string;
  phone: string;
  currentBalance: number;
  totalPurchases: number;
  invoiceCount: number;
  avgPaymentDays: number;
  rating: CustomerRating;
  ratingLabel: string;
}

function computeRating(balance: number, totalPurchases: number, avgPaymentDays: number): CustomerRating {
  // A = high volume AND good payer (balance ≤ 0 or pays within 30 days)
  // C = high debt relative to purchases OR very slow payer
  // B = everything else
  const debtRatio = totalPurchases > 0 ? balance / totalPurchases : (balance > 0 ? 1 : 0);
  if (debtRatio <= 0.1 && avgPaymentDays <= 30) return "A";
  if (debtRatio >= 0.6 || avgPaymentDays > 90) return "C";
  return "B";
}

export async function getCustomerRatings() {
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null, isSupplier: false },
    select: {
      id: true,
      name: true,
      phone: true,
      currentBalance: true,
      createdAt: true,
      lastTransactionAt: true,
      invoices: {
        where: { type: "SALE", status: "ACTIVE", archivedAt: null },
        select: { totalAmount: true, remainingAmount: true, date: true },
      },
    },
  });

  const now = Date.now();
  return customers.map((c) => {
    const totalPurchases = c.invoices.reduce((s, i) => s + toNumber(i.totalAmount), 0);
    const invoiceCount = c.invoices.length;
    const balance = toNumber(c.currentBalance);

    // avgPaymentDays = weighted average age of outstanding invoice balances.
    // A customer with old unpaid invoices scores high; one who paid everything scores 0.
    let avgPaymentDays = 0;
    const invoicesWithDebt = c.invoices.filter((i) => toNumber(i.remainingAmount) > 0);
    if (invoicesWithDebt.length > 0 && balance > 0) {
      const totalDebt = invoicesWithDebt.reduce((s, i) => s + toNumber(i.remainingAmount), 0);
      const weightedAge = invoicesWithDebt.reduce((s, i) => {
        const ageDays = Math.floor((now - i.date.getTime()) / 86_400_000);
        return s + ageDays * toNumber(i.remainingAmount);
      }, 0);
      avgPaymentDays = Math.min(180, Math.floor(weightedAge / totalDebt));
    }

    const rating = computeRating(balance, totalPurchases, avgPaymentDays);
    const ratingLabel = rating === "A" ? "زبون ممتاز" : rating === "B" ? "زبون جيد" : "يحتاج متابعة";

    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      currentBalance: balance,
      totalPurchases,
      invoiceCount,
      avgPaymentDays: Math.round(avgPaymentDays),
      rating,
      ratingLabel,
    };
  });
}

// ── Debt Aging ────────────────────────────────────────────────────────────────

export interface DebtAgingRow {
  id: string;
  name: string;
  phone: string;
  current: number;   // 0-30 days
  days30: number;    // 31-60 days
  days60: number;    // 61-90 days
  days90: number;    // 90+ days
  total: number;
}

export async function getDebtAging() {
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null, isSupplier: false, currentBalance: { gt: 0 } },
    select: { id: true, name: true, phone: true, currentBalance: true },
    orderBy: { currentBalance: "desc" },
    // No take limit — return all customers with debt
  });

  if (customers.length === 0) return [];

  // Fetch active sale invoices with outstanding balance for these customers.
  // Aging is computed per-invoice so a customer with mixed old/new debt gets
  // accurate bucket distribution instead of putting everything in one bucket.
  const customerIds = customers.map((c) => c.id);
  const invoices = await prisma.invoice.findMany({
    where: {
      customerId: { in: customerIds },
      type: InvoiceType.SALE,
      status: InvoiceStatus.ACTIVE,
      archivedAt: null,
      remainingAmount: { gt: 0 },
    },
    select: { customerId: true, remainingAmount: true, date: true },
  });

  type Buckets = { current: number; days30: number; days60: number; days90: number };
  const agingMap = new Map<string, Buckets>();
  const now = Date.now();

  for (const inv of invoices) {
    if (!inv.customerId) continue;
    const b = agingMap.get(inv.customerId) ?? { current: 0, days30: 0, days60: 0, days90: 0 };
    const age = Math.floor((now - inv.date.getTime()) / 86_400_000);
    const rem = toNumber(inv.remainingAmount);
    if (age <= 30)       b.current += rem;
    else if (age <= 60)  b.days30  += rem;
    else if (age <= 90)  b.days60  += rem;
    else                 b.days90  += rem;
    agingMap.set(inv.customerId, b);
  }

  return customers.map((c) => {
    const balance = toNumber(c.currentBalance);
    const b = agingMap.get(c.id) ?? { current: 0, days30: 0, days60: 0, days90: 0 };
    const invoicedTotal = b.current + b.days30 + b.days60 + b.days90;
    // Reconcile the per-invoice buckets to the customer's ACTUAL currentBalance
    // so the four bucket columns always sum to the "total" column. currentBalance
    // also nets opening balances, unallocated RECEIPT/PAYMENT vouchers, and
    // returns — none of which appear as an outstanding SALE invoice remainder.
    //   • surplus (balance > invoiced): untied/opening debt → oldest bucket (90+)
    //   • shortfall (balance < invoiced): an unapplied credit settles the oldest
    //     debt first (FIFO), so remove it from oldest → newest buckets.
    const diff = roundMoney(balance - invoicedTotal);
    if (diff > 0) {
      b.days90 += diff;
    } else if (diff < 0) {
      let credit = -diff;
      for (const k of ["days90", "days60", "days30", "current"] as const) {
        if (credit <= 0) break;
        const take = Math.min(b[k], credit);
        b[k] -= take;
        credit -= take;
      }
    }

    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      current:  roundMoney(b.current),
      days30:   roundMoney(b.days30),
      days60:   roundMoney(b.days60),
      days90:   roundMoney(b.days90),
      total:    balance,
    };
  });
}

/* ══════════════════════════════════════════════════════════════════════
   «تدقيق ربح الزبون» — where the numbers are lying, and by how much

   A product sold before anyone filled in its purchase price carries a cost of
   zero, and every profit figure downstream then reads that sale as pure
   profit. On this shop that is 1,060 sale lines out of 10,373 — a tenth of
   them — so the profit the merchant is pricing discounts against is
   materially higher than what he actually made.

   This does not fix anything by itself. It shows, per customer, which lines
   are suspicious and what they are doing to his profit, so he can correct the
   cost with the numbers in front of him.
══════════════════════════════════════════════════════════════════════ */

export interface CustomerProfitAuditQuery {
  customerId: string;
  /** Lines at or above this margin are flagged. Percent, 0–100. */
  minMarginPercent?: number;
  from?: string;
  to?: string;
}

export interface AuditLineGroup {
  productId: string;
  productName: string;
  itemNumber: string | null;
  /** How many pieces of it this customer bought in the window. */
  pieces: number;
  revenue: number;
  /** Per PIECE, as recorded on the invoice lines. 0 = never filled in. */
  costPerPiece: number;
  /**
   * Where the cost the PROFIT REPORT uses actually comes from:
   * RECORDED — frozen on the invoice line, the only trustworthy one.
   * PRODUCT  — the line was blank, so the report falls back to the product
   *            card's cost TODAY, which may be nothing like the cost then.
   * NONE     — nothing anywhere, so the report reads the sale as pure profit.
   */
  costSource: "RECORDED" | "PRODUCT" | "NONE";
  cost: number;
  profit: number;
  /** Null when there is no cost to compare against — an unknown, not 100%. */
  marginPercent: number | null;
  /** What the product card says now, for a merchant deciding what to enter. */
  productCostPrice: number;
  productPurchasePrice: number;
  lines: Array<{
    invoiceItemId: string;
    invoiceId: string;
    invoiceNumber: string;
    date: string;
    unit: string;
    quantity: number;
    pieces: number;
    unitPrice: number;
    revenue: number;
    costPerPiece: number;
  }>;
}

export async function getCustomerProfitAudit(query: CustomerProfitAuditQuery) {
  const minMargin = Math.max(0, Math.min(100, Number(query.minMarginPercent ?? 30)));
  const customer = await prisma.customer.findFirst({
    where: { id: query.customerId, deletedAt: null },
    select: { id: true, name: true, phone: true },
  });
  if (!customer) throw new AppError("الزبون غير موجود", 404, "CUSTOMER_NOT_FOUND");

  const items = await prisma.invoiceItem.findMany({
    where: {
      invoice: {
        customerId: query.customerId,
        type: InvoiceType.SALE,
        date: dateFilter(query.from, query.to),
      },
    },
    select: {
      id: true, productId: true, productName: true, itemNumber: true,
      unit: true, quantity: true, unitPrice: true, costPrice: true, totalPrice: true,
      invoice: { select: { id: true, invoiceNumber: true, date: true } },
      product: { select: { pcsPerCarton: true, boxPieces: true, costPrice: true, purchasePrice: true, itemNumber: true } },
    },
    orderBy: { invoice: { date: "desc" } },
  });

  const groups = new Map<string, AuditLineGroup>();
  let totalRevenue = 0;
  let totalCost = 0;
  let revenueWithKnownCost = 0;
  let profitOnKnownCost = 0;
  // Split, because they are different lies. Estimated revenue has roughly the
  // right profit attached; no-cost revenue is being counted as pure profit.
  let revenueEstimated = 0;
  let revenueNoCost = 0;

  for (const it of items) {
    const pieces = amountInPieces(
      it.unit,
      it.quantity,
      it.product?.pcsPerCarton ?? 1,
      it.product?.boxPieces ?? null,
    );
    const recorded = toNumber(it.costPrice);
    const productCost = toNumber(it.product?.costPrice ?? 0);
    const productPurchase = toNumber(it.product?.purchasePrice ?? 0);
    // The SAME fallback chain getProfitReport uses. Anything else here would
    // quote the merchant a "reported profit" he sees nowhere else.
    const effective = recorded > 0 ? recorded : productCost > 0 ? productCost : productPurchase;
    const source: "RECORDED" | "PRODUCT" | "NONE" =
      recorded > 0 ? "RECORDED" : effective > 0 ? "PRODUCT" : "NONE";

    const costPerPiece = recorded;
    const revenue = toNumber(it.totalPrice);
    const cost = roundMoney(effective * pieces);

    totalRevenue = roundMoney(totalRevenue + revenue);
    totalCost = roundMoney(totalCost + cost);
    // Only a cost frozen on the line at sale time is a fact. A product-card
    // fallback is today's number applied to an old sale, and no cost at all is
    // the sale reading as pure profit — neither belongs in "confirmed".
    if (source === "RECORDED") {
      revenueWithKnownCost = roundMoney(revenueWithKnownCost + revenue);
      profitOnKnownCost = roundMoney(profitOnKnownCost + (revenue - cost));
    } else if (source === "PRODUCT") {
      revenueEstimated = roundMoney(revenueEstimated + revenue);
    } else {
      revenueNoCost = roundMoney(revenueNoCost + revenue);
    }

    const key = it.productId;
    const g = groups.get(key) ?? {
      productId: it.productId,
      productName: it.productName,
      itemNumber: it.itemNumber ?? it.product?.itemNumber ?? null,
      pieces: 0, revenue: 0, costPerPiece: 0, cost: 0, profit: 0, marginPercent: null,
      costSource: source,
      productCostPrice: toNumber(it.product?.costPrice ?? 0),
      productPurchasePrice: toNumber(it.product?.purchasePrice ?? 0),
      lines: [],
    };
    g.pieces += pieces;
    g.revenue = roundMoney(g.revenue + revenue);
    g.cost = roundMoney(g.cost + cost);
    g.lines.push({
      invoiceItemId: it.id,
      invoiceId: it.invoice.id,
      invoiceNumber: it.invoice.invoiceNumber,
      date: it.invoice.date.toISOString(),
      unit: it.unit,
      quantity: it.quantity,
      pieces,
      unitPrice: toNumber(it.unitPrice),
      revenue,
      costPerPiece,
    });
    // A group is only as trustworthy as its weakest line.
    if (source === "NONE") g.costSource = "NONE";
    else if (source === "PRODUCT" && g.costSource === "RECORDED") g.costSource = "PRODUCT";
    groups.set(key, g);
  }

  const all = [...groups.values()].map((g) => {
    g.profit = roundMoney(g.revenue - g.cost);
    g.costPerPiece = g.pieces > 0 ? roundMoney(g.cost / g.pieces) : 0;
    // A line with no cost has an UNKNOWN margin, not a 100% one. Reporting it
    // as 100% is exactly the lie this screen exists to expose, so it is left
    // null and shown in its own bucket instead.
    g.marginPercent = g.cost > 0 && g.revenue > 0
      ? roundMoney(((g.revenue - g.cost) / g.revenue) * 100)
      : null;
    return g;
  });

  // Three buckets, because they are three different problems. Lumping the
  // guessed ones in with the unknown ones would send the merchant chasing
  // lines whose profit is roughly right.
  const noCost = all
    .filter((g) => g.costSource === "NONE")
    .sort((a, b) => b.revenue - a.revenue);
  const estimated = all
    .filter((g) => g.costSource === "PRODUCT")
    .sort((a, b) => b.revenue - a.revenue);
  const highMargin = all
    .filter((g) => g.costSource === "RECORDED" && g.marginPercent != null && g.marginPercent >= minMargin)
    .sort((a, b) => (b.marginPercent ?? 0) - (a.marginPercent ?? 0));

  return {
    customer,
    minMarginPercent: minMargin,
    // The headline pair: what the reports currently say, and what is actually
    // knowable. The gap between them is the size of the problem.
    totals: {
      revenue: totalRevenue,
      reportedProfit: roundMoney(totalRevenue - totalCost),
      knownProfit: profitOnKnownCost,
      revenueWithKnownCost,
      /** Revenue whose profit is a guess or a fiction — not recorded at sale time. */
      revenueWithoutCost: roundMoney(totalRevenue - revenueWithKnownCost),
      /** Costed from the product card today, not from the sale. Roughly right. */
      revenueEstimated,
      /** No cost anywhere — the reports read this as pure profit. */
      revenueNoCost,
      /** Margin on the part that is actually knowable. */
      knownMarginPercent: revenueWithKnownCost > 0
        ? roundMoney((profitOnKnownCost / revenueWithKnownCost) * 100)
        : null,
    },
    highMargin,
    noCost,
    estimated,
  };
}

export interface FixCostInput {
  productId: string;
  /** Per PIECE, the same unit invoice lines store. */
  costPerPiece: number;
  /**
   * INVOICE — one line. CUSTOMER — every zero-cost line of this product for
   * this customer. ALL — every zero-cost line of this product, anywhere.
   */
  scope: "INVOICE" | "CUSTOMER" | "ALL";
  invoiceItemId?: string;
  customerId?: string;
  /** Also write it onto the product card, so the next sale is right by itself. */
  updateProduct?: boolean;
}

/**
 * Fill in a cost that was never recorded.
 *
 * Only ever fills BLANKS — a line that already carries a cost is left alone
 * even when it falls inside the chosen scope. Overwriting a real recorded cost
 * with today's guess would destroy correct history to fix an incorrect one,
 * and the merchant asked for precise work.
 *
 * Loyalty points are deliberately untouched. A zero-cost line earned zero
 * points at the time, and Invoice.loyaltyPointsEarned is the frozen figure
 * that cancel/delete subtracts back off verbatim — recomputing it here would
 * break that reversal and leave balances that can never be unwound.
 */
export async function fixInvoiceLineCost(input: FixCostInput, userId: string) {
  const costPerPiece = Number(input.costPerPiece);
  if (!Number.isFinite(costPerPiece) || costPerPiece <= 0) {
    throw new AppError("سعر الشراء لازم يكون رقم أكبر من صفر", 400, "INVALID_COST");
  }
  const product = await prisma.product.findFirst({
    where: { id: input.productId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!product) throw new AppError("المادة غير موجودة", 404, "PRODUCT_NOT_FOUND");

  const where: Prisma.InvoiceItemWhereInput = {
    productId: input.productId,
    // The blanks-only rule, enforced here rather than trusted from the client.
    costPrice: 0,
    invoice: { type: InvoiceType.SALE },
  };
  if (input.scope === "INVOICE") {
    if (!input.invoiceItemId) throw new AppError("حدد السطر المطلوب", 400, "LINE_REQUIRED");
    where.id = input.invoiceItemId;
  } else if (input.scope === "CUSTOMER") {
    if (!input.customerId) throw new AppError("حدد الزبون", 400, "CUSTOMER_REQUIRED");
    where.invoice = { type: InvoiceType.SALE, customerId: input.customerId };
  }

  const updated = await prisma.invoiceItem.updateMany({ where, data: { costPrice: costPerPiece } });

  if (input.updateProduct) {
    await prisma.product.update({
      where: { id: input.productId },
      data: { costPrice: costPerPiece, purchasePrice: costPerPiece },
    });
  }

  await prisma.auditLog.create({
    data: {
      userId,
      action: "INVOICE_LINE_COST_BACKFILLED",
      entity: "Product",
      recordId: input.productId,
      metadata: {
        productName: product.name,
        costPerPiece,
        scope: input.scope,
        linesUpdated: updated.count,
        customerId: input.customerId ?? null,
        invoiceItemId: input.invoiceItemId ?? null,
        productUpdated: Boolean(input.updateProduct),
      } as Prisma.InputJsonValue,
    },
  });

  return { linesUpdated: updated.count, productUpdated: Boolean(input.updateProduct) };
}
