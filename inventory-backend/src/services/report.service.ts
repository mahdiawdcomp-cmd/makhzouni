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
