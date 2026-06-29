import { InvoiceStatus, InvoiceType, Prisma, Unit } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { amountInPieces, roundMoney } from "../utils/financial";

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

function itemCostPrice(item: {
  unit: Unit;
  quantity: number;
  costPrice: DecimalLike;
  product: { costPrice: DecimalLike; purchasePrice: DecimalLike; pcsPerCarton: number };
}) {
  // Use the snapshot costPrice if non-zero, else fall back to product.costPrice, else purchasePrice
  const snapshotCost = toNumber(item.costPrice);
  const productCost = toNumber(item.product.costPrice);
  const purchaseCost = toNumber(item.product.purchasePrice);
  const baseCost = snapshotCost > 0 ? snapshotCost : productCost > 0 ? productCost : purchaseCost;
  if (item.unit === Unit.CARTON) return baseCost * item.product.pcsPerCarton * item.quantity;
  if (item.unit === Unit.DOZEN) return baseCost * 12 * item.quantity;
  return baseCost * item.quantity;
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
        product: { select: { pcsPerCarton: true } },
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
        product: { select: { pcsPerCarton: true } },
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
    current.quantitySold += amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton);
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
    current.quantitySold -= amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton);
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
        product: { select: { pcsPerCarton: true } },
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
        (sum, item) => sum + amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton),
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
    orderBy: { itemNumber: "asc" },
  });

  const rows = products.map((product) => {
    const quantity = currentStock(product);
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
    prisma.product.findMany({ where: { deletedAt: null } }),
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
        product: { select: { pcsPerCarton: true } },
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
        product: { select: { pcsPerCarton: true } },
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
    (p) => currentStock(p) >= 0 && currentStock(p) <= p.minStock
  );
  const lowStockNames = lowStockItems.slice(0, 3).map((p) => p.name);

  const topProductMap = new Map<string, { name: string; quantity: number }>();
  for (const item of topItemsToday) {
    const cur = topProductMap.get(item.productId) ?? { name: item.productName, quantity: 0 };
    cur.quantity += amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton);
    topProductMap.set(item.productId, cur);
  }
  for (const item of topReturnItemsToday) {
    const cur = topProductMap.get(item.productId) ?? { name: item.productName, quantity: 0 };
    cur.quantity -= amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton);
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
      include: { product: true, invoice: { select: { date: true, subtotal: true, totalAmount: true } } },
    }),
    prisma.invoiceItem.findMany({
      where: {
        invoice: {
          status: InvoiceStatus.ACTIVE,
          type: InvoiceType.SALES_RETURN,
          ...(df ? { date: df } : {}),
        },
      },
      include: { product: true, invoice: { select: { date: true, subtotal: true, totalAmount: true } } },
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
      qty: existing.qty + amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton),
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
      qty: existing.qty - amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton),
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
        product: { select: { costPrice: true, purchasePrice: true, pcsPerCarton: true } },
      },
    }),
    prisma.paymentVoucher.findMany({
      where: {
        type: "EXPENSE",
        cancelledAt: null,
        ...(df ? { date: df } : {}),
      },
      select: { amount: true },
    }),
  ]);

  const lossesTotal = Math.round(
    lossItems.reduce((s, item) => {
      const pcs = amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton);
      // Prefer the frozen snapshot stockLossItem.costPrice (cost at loss time);
      // fall back to the live accounting cost (costPrice → purchasePrice) only
      // when the snapshot is missing/zero. Same freeze model as sale invoices.
      const snapshot = toNumber(item.costPrice);
      const unitCost = snapshot > 0 ? snapshot : accountingUnitCost(item.product);
      return s + pcs * unitCost;
    }, 0),
  );
  const expensesTotal = Math.round(
    expenseVouchers.reduce((s, v) => s + toNumber(v.amount), 0),
  );
  const netProfit = Math.round(totalProfit - lossesTotal - expensesTotal);

  return {
    periods: periodData,
    topProducts,
    summary: {
      totalRevenue: Math.round(totalRevenue),
      totalCost: Math.round(totalCost),
      totalProfit: Math.round(totalProfit),
      lossesTotal,
      expensesTotal,
      netProfit,
      avgMargin: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0,
    },
  };
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
    product: true,
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
      const qty = amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton) * sign;

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
    // Opening-balance debt (no matching invoice) goes to 90+ bucket
    if (invoicedTotal === 0 && balance > 0) b.days90 = balance;

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
