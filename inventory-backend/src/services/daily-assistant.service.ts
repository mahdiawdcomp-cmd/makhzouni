// ── «المساعد الذكي اليومي» (Daily Smart Assistant) ────────────────────────────
// A NEW, isolated aggregation layer over the existing report services. It never
// changes the behaviour of any existing report; it only reads and re-combines.
//
// Data is split three ways (see the report/CLAUDE spec):
//   • LIVE      — recomputed on every request (today's sales/profit/debtors/tasks)
//   • DAILY     — heavy indicators computed once each morning and cached in an
//                 AssistantSnapshot row (kind=DAILY_HEAVY, one per local day)
//   • WEEKLY    — the "bought together" basket analysis, computed once a week
//                 (kind=WEEKLY_BASKET)
//
// All money/cost/unit math REUSES the exact helpers the profit & valuation
// reports use (itemCostPrice, invoiceRevenueRatio, accountingUnitCost,
// totalStock, amountInPieces) so numbers can never diverge from the Profit tab.

import { InvoiceStatus, InvoiceType, Prisma } from "@prisma/client";
import prisma from "../config/database";
import { amountInPieces, roundMoney } from "../utils/financial";
import { totalStock } from "../utils/product-stock";
import {
  accountingUnitCost,
  invoiceRevenueRatio,
  itemCostPrice,
  getTopCustomersReport,
} from "./report.service";

// ── Tunable thresholds (constants — no settings screen in V1) ─────────────────
export const ASSISTANT_CONFIG = {
  SLEEPING_DAYS: 60,            // no valid sale in this many days → "sleeping"
  REORDER_RATE_WINDOW: 30,     // completed days used to compute daily sell rate
  REORDER_COVER_DAYS: 30,      // suggested qty covers this many days of demand
  REORDER_URGENT_DAYS: 7,      // days-to-out-of-stock that makes a product urgent
  SPIKE_BASE_WINDOW: 30,       // days before the comparison day used as baseline
  SPIKE_MIN_QTY: 3,            // comparison-day net pieces floor
  SPIKE_MULTIPLIER: 2,         // comparison-day qty ≥ this × daily average
  SPIKE_MIN_ACTIVE_DAYS: 5,    // product must have sold on ≥ this many base days
  BASKET_WINDOW_DAYS: 90,      // history window for bought-together pairs
  BASKET_MAX_ITEMS_PER_INVOICE: 50, // combinatorial-explosion guard per invoice
  BASKET_MIN_PAIR_COUNT: 2,    // ignore pairs seen fewer times than this
  BASKET_TOP_PAIRS: 50,        // store at most this many pairs
  STOPPED_30: 30,
  STOPPED_60: 60,
  TOP_N: 3,                    // items shown per list in the summary
};

const SCHEMA_VERSION = 1;
const DAY_MS = 86_400_000;

export function assistantTimezone(): string {
  return (
    process.env.ASSISTANT_TIMEZONE?.trim() ||
    process.env.KEEP_ALIVE_TIMEZONE?.trim() ||
    "Asia/Baghdad"
  );
}

// ── Timezone-safe day boundaries ─────────────────────────────────────────────
// All "day" windows are computed in the shop timezone so a sale at 23:30 local
// counts for the correct day and the date never slips because the server runs
// in UTC (test #23).

/** Minutes the zone is ahead of UTC at the given instant. */
function tzOffsetMinutes(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour) % 24, Number(map.minute), Number(map.second),
  );
  return (asUTC - date.getTime()) / 60_000;
}

/** UTC instant of local-midnight for the given YYYY-MM-DD in tz. */
function zonedStartOfDay(dateStr: string, tz: string): Date {
  const guess = new Date(`${dateStr}T00:00:00Z`);
  const off = tzOffsetMinutes(guess, tz);
  return new Date(guess.getTime() - off * 60_000);
}

/** [start, end] UTC instants covering the whole local day `dateStr` in tz. */
export function zonedDayRange(dateStr: string, tz: string): { start: Date; end: Date } {
  const start = zonedStartOfDay(dateStr, tz);
  const end = new Date(zonedStartOfDay(addDaysStr(dateStr, 1), tz).getTime() - 1);
  return { start, end };
}

/** Local YYYY-MM-DD key for an instant, in tz (en-CA → ISO-shaped). */
export function dayKeyInTz(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

/** Today's local date string in tz. */
export function todayStr(tz = assistantTimezone()): string {
  return dayKeyInTz(new Date(), tz);
}

export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toNum(v: Prisma.Decimal | number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return Number(v);
}

// Minimal invoice-item include used everywhere profit is computed, matching the
// shape itemCostPrice()/invoiceRevenueRatio() expect.
const profitItemInclude = {
  product: {
    select: { costPrice: true, purchasePrice: true, pcsPerCarton: true, boxPieces: true },
  },
  invoice: { select: { subtotal: true, totalAmount: true, date: true } },
} satisfies Prisma.InvoiceItemInclude;

type ProfitItem = Prisma.InvoiceItemGetPayload<{ include: typeof profitItemInclude }>;

function itemRevenue(item: ProfitItem): number {
  return toNum(item.totalPrice) * invoiceRevenueRatio(item.invoice);
}
function itemCost(item: ProfitItem): number {
  return itemCostPrice({ ...item, product: item.product });
}
function itemPieces(item: ProfitItem): number {
  return amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton, item.product.boxPieces);
}
/** True when a product has at least one usable cost source (else profit is bogus). */
export function hasValidCost(p: { costPrice: unknown; purchasePrice: unknown }): boolean {
  return toNum(p.costPrice as never) > 0 || toNum(p.purchasePrice as never) > 0;
}

// ── Pure decision kernels (unit-tested directly; no DB) ───────────────────────

export function marginPercent(revenue: number, cost: number): number | null {
  if (revenue <= 0) return null;
  return Math.round(((revenue - cost) / revenue) * 100);
}

/** Sleeping = has stock AND (never sold OR last sale older than the cutoff). */
export function isSleeping(stock: number, lastSale: Date | null, cutoff: Date): boolean {
  if (stock <= 0) return false;
  return !lastSale || lastSale < cutoff;
}

/** A brand-new product (younger than the window) is never "sleeping". */
export function isProductOldEnoughToSleep(createdAt: Date, cutoff: Date): boolean {
  return createdAt < cutoff;
}

/** Frozen-capital value = on-hand pieces × the SAME accounting cost inventory
 *  valuation uses (costPrice → purchasePrice), so the two views never disagree. */
export function frozenCapitalValue(
  stock: number, product: { costPrice: unknown; purchasePrice: unknown },
): number {
  return roundMoney(stock * accountingUnitCost(product as any));
}

/** Split stopped customers into 30-day / 60-day buckets, each customer once. */
export function bucketStopped<T extends { lastTransactionAt: Date }>(
  customers: T[], cutoff30: Date, cutoff60: Date,
): { stopped30: T[]; stopped60: T[] } {
  const stopped30: T[] = [];
  const stopped60: T[] = [];
  for (const c of customers) {
    if (c.lastTransactionAt >= cutoff30) continue; // still active
    if (c.lastTransactionAt < cutoff60) stopped60.push(c);
    else stopped30.push(c);
  }
  return { stopped30, stopped60 };
}

/** New customers today = bought today, eligible (not supplier/deleted), no prior SALE. */
export function classifyNewCustomers(
  todayBuyerIds: string[],
  priorBuyerIds: Set<string>,
  eligibleIds: Set<string>,
): string[] {
  return todayBuyerIds.filter((id) => eligibleIds.has(id) && !priorBuyerIds.has(id));
}

export interface ReorderInput {
  productId: string; name: string; itemNumber: string;
  netSoldPieces: number; stock: number; minStock: number; pcsPerCarton: number;
}

/** Reorder math for one product; null when it isn't a candidate / lacks demand. */
export function reorderForProduct(inp: ReorderInput, cfg = ASSISTANT_CONFIG) {
  const netSold = Math.max(0, inp.netSoldPieces);
  const dailyRate = netSold / cfg.REORDER_RATE_WINDOW;
  if (dailyRate <= 0) return null; // no demand signal → don't guess
  const daysLeft = inp.stock / dailyRate;
  const candidate = inp.stock <= inp.minStock || daysLeft <= cfg.REORDER_URGENT_DAYS;
  if (!candidate) return null;
  const suggestedPieces = Math.max(0, Math.ceil(dailyRate * cfg.REORDER_COVER_DAYS - inp.stock));
  if (suggestedPieces <= 0) return null;
  const suggestedCartons = inp.pcsPerCarton > 1 ? Math.ceil(suggestedPieces / inp.pcsPerCarton) : null;
  return {
    productId: inp.productId, name: inp.name, itemNumber: inp.itemNumber,
    currentStock: inp.stock, minStock: inp.minStock,
    dailyRate: Math.round(dailyRate * 100) / 100,
    daysLeft: Number.isFinite(daysLeft) ? Math.floor(daysLeft) : null,
    suggestedPieces, suggestedCartons, pcsPerCarton: inp.pcsPerCarton,
  };
}

/** Spike test for one product's per-day net pieces map. Uses the COMPLETE
 *  comparison day vs the daily average of the base window (excluding it). */
export function detectSpikeForProduct(
  days: Map<string, number>, comparisonDay: string, cfg = ASSISTANT_CONFIG,
) {
  const cmpQty = days.get(comparisonDay) ?? 0;
  if (cmpQty < cfg.SPIKE_MIN_QTY) return null;
  let baseTotal = 0, activeDays = 0;
  for (const [k, v] of days) {
    if (k === comparisonDay) continue;
    if (v > 0) { baseTotal += v; activeDays += 1; }
  }
  if (activeDays < cfg.SPIKE_MIN_ACTIVE_DAYS) return null;
  const avg = baseTotal / cfg.SPIKE_BASE_WINDOW;
  if (avg <= 0 || cmpQty < avg * cfg.SPIKE_MULTIPLIER) return null;
  return {
    comparisonDayQty: cmpQty,
    dailyAverage: Math.round(avg * 100) / 100,
    risePercent: Math.round(((cmpQty - avg) / avg) * 100),
  };
}

/** Count co-occurring product pairs across invoices. Canonical (sorted) keys so
 *  A+B == B+A, never A+A; caps per-invoice product count to avoid explosion. */
export function pairsFromInvoices(
  invoiceProductSets: string[][], maxItems = ASSISTANT_CONFIG.BASKET_MAX_ITEMS_PER_INVOICE,
): { pairCount: Map<string, number>; cappedInvoices: number } {
  const pairCount = new Map<string, number>();
  let cappedInvoices = 0;
  for (const set of invoiceProductSets) {
    let products = Array.from(new Set(set));
    if (products.length < 2) continue;
    if (products.length > maxItems) { products = products.slice(0, maxItems); cappedInvoices += 1; }
    products.sort();
    for (let i = 0; i < products.length; i++) {
      for (let j = i + 1; j < products.length; j++) {
        const key = `${products[i]}|${products[j]}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
    }
  }
  return { pairCount, cappedInvoices };
}

// ── LIVE summary + product/customer/task sections ─────────────────────────────

interface ProductAgg {
  productId: string;
  name: string;
  revenue: number;
  cost: number;
  pieces: number;
  hasCost: boolean;
}

export function aggregateByProduct(saleItems: ProfitItem[], returnItems: ProfitItem[]) {
  const map = new Map<string, ProductAgg>();
  const apply = (items: ProfitItem[], sign: 1 | -1) => {
    for (const it of items) {
      const cur = map.get(it.productId) ?? {
        productId: it.productId, name: it.productName, revenue: 0, cost: 0, pieces: 0,
        hasCost: hasValidCost(it.product),
      };
      cur.revenue += itemRevenue(it) * sign;
      cur.cost += itemCost(it) * sign;
      cur.pieces += itemPieces(it) * sign;
      map.set(it.productId, cur);
    }
  };
  apply(saleItems, 1);
  apply(returnItems, -1);
  return map;
}

async function computeLiveSummary(start: Date, end: Date) {
  const activeSale = { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE, date: { gte: start, lte: end } };
  const activeReturn = { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALES_RETURN, date: { gte: start, lte: end } };

  const [saleAgg, returnAgg, saleItems, returnItems, todayCustomerRows] = await Promise.all([
    prisma.invoice.aggregate({ where: activeSale, _sum: { totalAmount: true }, _count: { id: true } }),
    prisma.invoice.aggregate({ where: activeReturn, _sum: { totalAmount: true } }),
    prisma.invoiceItem.findMany({ where: { invoice: activeSale }, include: profitItemInclude }),
    prisma.invoiceItem.findMany({ where: { invoice: activeReturn }, include: profitItemInclude }),
    // distinct customers who bought (SALE) today
    prisma.invoice.findMany({
      where: activeSale,
      select: { customerId: true },
      distinct: ["customerId"],
    }),
  ]);

  const grossSaleTotal = toNum(saleAgg._sum.totalAmount);
  const returnTotal = toNum(returnAgg._sum.totalAmount);
  const netSales = roundMoney(grossSaleTotal - returnTotal);
  const saleCount = saleAgg._count.id;

  // Gross profit = revenue − COGS, exactly like getProfitReport's totalProfit.
  const revenue = saleItems.reduce((s, i) => s + itemRevenue(i), 0) - returnItems.reduce((s, i) => s + itemRevenue(i), 0);
  const cost = saleItems.reduce((s, i) => s + itemCost(i), 0) - returnItems.reduce((s, i) => s + itemCost(i), 0);
  const profit = roundMoney(revenue - cost);

  // ── New customers today: first-ever valid SALE invoice falls within the day.
  const todayIds = todayCustomerRows.map((r) => r.customerId).filter(Boolean) as string[];
  let newCustomers = 0;
  if (todayIds.length) {
    const [priorRows, eligible] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE,
          date: { lt: start }, customerId: { in: todayIds },
        },
        select: { customerId: true }, distinct: ["customerId"],
      }),
      prisma.customer.findMany({
        where: { id: { in: todayIds }, deletedAt: null, isSupplier: false },
        select: { id: true },
      }),
    ]);
    const priorSet = new Set(priorRows.map((r) => r.customerId));
    const eligibleSet = new Set(eligible.map((c) => c.id));
    newCustomers = classifyNewCustomers(todayIds, priorSet, eligibleSet).length;
  }

  return {
    productAgg: aggregateByProduct(saleItems, returnItems),
    summary: {
      totalSales: netSales,
      totalProfit: profit,
      saleInvoiceCount: saleCount,
      avgInvoiceValue: saleCount > 0 ? roundMoney(grossSaleTotal / saleCount) : 0,
      newCustomers,
    },
  };
}

/** Top products by unified-piece quantity within [start,end]. */
async function topSellingBetween(start: Date, end: Date, limit = ASSISTANT_CONFIG.TOP_N) {
  const [saleItems, returnItems] = await Promise.all([
    prisma.invoiceItem.findMany({
      where: { invoice: { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE, date: { gte: start, lte: end } } },
      include: profitItemInclude,
    }),
    prisma.invoiceItem.findMany({
      where: { invoice: { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALES_RETURN, date: { gte: start, lte: end } } },
      include: profitItemInclude,
    }),
  ]);
  const map = aggregateByProduct(saleItems, returnItems);
  return Array.from(map.values())
    .filter((p) => p.pieces > 0)
    .sort((a, b) => b.pieces - a.pieces)
    .slice(0, limit)
    .map((p) => ({ productId: p.productId, name: p.name, pieces: p.pieces, amount: roundMoney(p.revenue) }));
}

// ── LIVE customer sections ────────────────────────────────────────────────────

async function topDebtors(limit = ASSISTANT_CONFIG.TOP_N) {
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null, isSupplier: false, currentBalance: { gt: 0 } },
    orderBy: { currentBalance: "desc" },
    take: limit,
    select: { id: true, name: true, phone: true, currentBalance: true, lastTransactionAt: true, createdAt: true },
  });
  const now = Date.now();
  return customers.map((c) => {
    const last = c.lastTransactionAt ?? c.createdAt;
    return {
      id: c.id, name: c.name, phone: c.phone,
      balance: toNum(c.currentBalance),
      daysLate: Math.floor((now - last.getTime()) / DAY_MS),
    };
  });
}

async function stoppedCustomers() {
  const cutoff30 = new Date(Date.now() - ASSISTANT_CONFIG.STOPPED_30 * DAY_MS);
  const cutoff60 = new Date(Date.now() - ASSISTANT_CONFIG.STOPPED_60 * DAY_MS);

  const candidates = await prisma.customer.findMany({
    where: {
      deletedAt: null, isSupplier: false,
      lastTransactionAt: { not: null, lt: cutoff30 },
    },
    orderBy: { lastTransactionAt: "asc" },
    select: { id: true, name: true, phone: true, lastTransactionAt: true },
  });
  if (candidates.length === 0) return { stopped30: [], stopped60: [] };

  // Require ≥1 actual SALE (exclude records that only ever had opening balances).
  const withSales = await prisma.invoice.findMany({
    where: {
      status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE,
      customerId: { in: candidates.map((c) => c.id) },
    },
    select: { customerId: true }, distinct: ["customerId"],
  });
  const buyers = new Set(withSales.map((r) => r.customerId));
  const now = Date.now();

  const rows = candidates
    .filter((c) => buyers.has(c.id))
    .map((c) => ({
      id: c.id, name: c.name, phone: c.phone,
      lastTransactionAt: c.lastTransactionAt!,
      daysStopped: Math.floor((now - c.lastTransactionAt!.getTime()) / DAY_MS),
    }));

  // Each customer appears in exactly one bucket (60+ takes priority).
  const { stopped30, stopped60 } = bucketStopped(rows, cutoff30, cutoff60);
  const ser = (r: typeof rows[number]) => ({ ...r, lastTransactionAt: r.lastTransactionAt.toISOString() });
  return { stopped30: stopped30.map(ser), stopped60: stopped60.map(ser) };
}

// ── LIVE pending tasks ────────────────────────────────────────────────────────

async function pendingTasks() {
  const [prepCount, prepTop, transferCount, transferTop, approvalCount, approvalTop] = await Promise.all([
    prisma.orderPreparation.count({ where: { status: "PENDING" } }),
    prisma.orderPreparation.findMany({
      where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: ASSISTANT_CONFIG.TOP_N,
      select: { id: true, customerName: true, createdAt: true },
    }),
    prisma.inventoryTransfer.count({ where: { status: "PENDING" } }),
    prisma.inventoryTransfer.findMany({
      where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: ASSISTANT_CONFIG.TOP_N,
      select: {
        id: true, transferNumber: true, createdAt: true,
        fromBranch: { select: { name: true } }, toBranch: { select: { name: true } },
      },
    }),
    prisma.pendingApproval.count({ where: { status: "PENDING" } }),
    prisma.pendingApproval.findMany({
      where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: ASSISTANT_CONFIG.TOP_N,
      select: { id: true, requestType: true, createdAt: true },
    }),
  ]);

  return {
    preparations: {
      count: prepCount,
      items: prepTop.map((p) => ({ id: p.id, label: p.customerName, createdAt: p.createdAt.toISOString(), actionUrl: "/order-preparations" })),
    },
    transfers: {
      count: transferCount,
      items: transferTop.map((t) => ({
        id: t.id, label: `${t.transferNumber} (${t.fromBranch.name} ← ${t.toBranch.name})`,
        createdAt: t.createdAt.toISOString(), actionUrl: "/transfers",
      })),
    },
    approvals: {
      count: approvalCount,
      items: approvalTop.map((a) => ({ id: a.id, label: a.requestType, createdAt: a.createdAt.toISOString(), actionUrl: "/approvals" })),
    },
  };
}

// ── HEAVY snapshot computation (sleeping / frozen capital / reorder / spike) ───

interface SleepingProduct {
  productId: string;
  name: string;
  itemNumber: string;
  imageUrl: string | null;
  currentStock: number;
  lastSaleAt: string | null;
  daysIdle: number;
  capitalValue: number;
}

/** Last-ever SALE date per product, in ONE set-based raw query (no N+1). */
async function lastSaleDateByProduct(): Promise<Map<string, Date>> {
  const rows = await prisma.$queryRaw<Array<{ product_id: string; last_sale: Date | null }>>`
    SELECT ii.product_id, MAX(i.date) AS last_sale
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.type = 'SALE' AND i.status = 'ACTIVE' AND i.archived_at IS NULL
    GROUP BY ii.product_id
  `;
  const map = new Map<string, Date>();
  for (const r of rows) if (r.last_sale) map.set(r.product_id, new Date(r.last_sale));
  return map;
}

async function computeSleeping(now: Date): Promise<SleepingProduct[]> {
  const ageCutoff = new Date(now.getTime() - ASSISTANT_CONFIG.SLEEPING_DAYS * DAY_MS);
  const [products, lastSaleMap] = await Promise.all([
    prisma.product.findMany({
      where: { deletedAt: null, createdAt: { lt: ageCutoff } }, // brand-new never sleeping
      select: {
        id: true, name: true, itemNumber: true, thumbnailUrl: true,
        openingBalancePcs: true, cartonsAvailable: true, pcsPerCarton: true,
        costPrice: true, purchasePrice: true, createdAt: true,
        warehouseStocks: { select: { quantityPieces: true } },
      },
    }),
    lastSaleDateByProduct(),
  ]);

  const out: SleepingProduct[] = [];
  for (const p of products) {
    const stock = totalStock(p);
    if (stock <= 0) continue;
    if (!isProductOldEnoughToSleep(p.createdAt, ageCutoff)) continue; // defensive
    const lastSale = lastSaleMap.get(p.id) ?? null;
    if (!isSleeping(stock, lastSale, ageCutoff)) continue;
    const idleFrom = lastSale ?? p.createdAt;
    const daysIdle = Math.floor((now.getTime() - idleFrom.getTime()) / DAY_MS);
    out.push({
      productId: p.id, name: p.name, itemNumber: p.itemNumber,
      imageUrl: p.thumbnailUrl ?? null,
      currentStock: stock,
      lastSaleAt: lastSale ? lastSale.toISOString() : null,
      daysIdle,
      capitalValue: frozenCapitalValue(stock, p),
    });
  }
  return out.sort((a, b) => b.daysIdle - a.daysIdle);
}

/** Net pieces sold per product across [start,end] (SALE − SALES_RETURN). */
async function netPiecesByProduct(start: Date, end: Date): Promise<Map<string, number>> {
  const items = await prisma.invoiceItem.findMany({
    where: {
      invoice: {
        status: InvoiceStatus.ACTIVE,
        type: { in: [InvoiceType.SALE, InvoiceType.SALES_RETURN] },
        date: { gte: start, lte: end },
      },
    },
    select: {
      productId: true, unit: true, quantity: true,
      product: { select: { pcsPerCarton: true, boxPieces: true } },
      invoice: { select: { type: true } },
    },
  });
  const map = new Map<string, number>();
  for (const it of items) {
    const pcs = amountInPieces(it.unit, it.quantity, it.product.pcsPerCarton, it.product.boxPieces);
    const sign = it.invoice.type === InvoiceType.SALE ? 1 : -1;
    map.set(it.productId, (map.get(it.productId) ?? 0) + pcs * sign);
  }
  return map;
}

async function computeReorder(todayLocalStart: Date) {
  const windowStart = new Date(todayLocalStart.getTime() - ASSISTANT_CONFIG.REORDER_RATE_WINDOW * DAY_MS);
  // rate window = completed days only → [windowStart, todayLocalStart)
  const [netMap, products] = await Promise.all([
    netPiecesByProduct(windowStart, new Date(todayLocalStart.getTime() - 1)),
    prisma.product.findMany({
      where: { deletedAt: null },
      select: {
        id: true, name: true, itemNumber: true,
        openingBalancePcs: true, cartonsAvailable: true, pcsPerCarton: true, minStock: true,
        warehouseStocks: { select: { quantityPieces: true } },
      },
    }),
  ]);

  const suggestions = products.map((p) =>
    reorderForProduct({
      productId: p.id, name: p.name, itemNumber: p.itemNumber,
      netSoldPieces: netMap.get(p.id) ?? 0,
      stock: totalStock(p), minStock: p.minStock, pcsPerCarton: p.pcsPerCarton,
    }),
  ).filter(Boolean) as Array<NonNullable<ReturnType<typeof reorderForProduct>>>;

  // Priority: fewest days left first, then biggest shortage.
  suggestions.sort((a, b) => {
    const dl = (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9);
    if (dl !== 0) return dl;
    return b.suggestedPieces - a.suggestedPieces;
  });
  return suggestions;
}

async function computeSpike(comparisonDay: string, tz: string) {
  const { start: cmpStart, end: cmpEnd } = zonedDayRange(comparisonDay, tz);
  const baseStart = new Date(cmpStart.getTime() - ASSISTANT_CONFIG.SPIKE_BASE_WINDOW * DAY_MS);

  const items = await prisma.invoiceItem.findMany({
    where: {
      invoice: {
        status: InvoiceStatus.ACTIVE,
        type: { in: [InvoiceType.SALE, InvoiceType.SALES_RETURN] },
        date: { gte: baseStart, lte: cmpEnd },
      },
    },
    select: {
      productId: true, productName: true, unit: true, quantity: true,
      product: { select: { pcsPerCarton: true, boxPieces: true } },
      invoice: { select: { type: true, date: true } },
    },
  });

  // per-product → per-local-day net pieces
  type PerProduct = { name: string; days: Map<string, number> };
  const map = new Map<string, PerProduct>();
  for (const it of items) {
    const pcs = amountInPieces(it.unit, it.quantity, it.product.pcsPerCarton, it.product.boxPieces);
    const sign = it.invoice.type === InvoiceType.SALE ? 1 : -1;
    const key = dayKeyInTz(it.invoice.date, tz);
    const entry = map.get(it.productId) ?? { name: it.productName, days: new Map() };
    entry.days.set(key, (entry.days.get(key) ?? 0) + pcs * sign);
    map.set(it.productId, entry);
  }

  const spikes: any[] = [];
  for (const [productId, { name, days }] of map) {
    const hit = detectSpikeForProduct(days, comparisonDay);
    if (!hit) continue;
    spikes.push({ productId, name, comparisonDay, ...hit });
  }
  spikes.sort((a, b) => b.risePercent - a.risePercent);
  return spikes;
}

// ── WEEKLY basket (bought-together pairs) ─────────────────────────────────────

async function computeBasket() {
  const start = new Date(Date.now() - ASSISTANT_CONFIG.BASKET_WINDOW_DAYS * DAY_MS);
  const rows = await prisma.invoiceItem.findMany({
    where: { invoice: { status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE, date: { gte: start } } },
    select: { invoiceId: true, productId: true },
  });

  // group products per invoice (unique)
  const perInvoice = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = perInvoice.get(r.invoiceId) ?? new Set<string>();
    set.add(r.productId);
    perInvoice.set(r.invoiceId, set);
  }

  const { pairCount, cappedInvoices } = pairsFromInvoices(
    Array.from(perInvoice.values()).map((s) => Array.from(s)),
  );

  const ranked = Array.from(pairCount.entries())
    .filter(([, c]) => c >= ASSISTANT_CONFIG.BASKET_MIN_PAIR_COUNT)
    .sort((a, b) => b[1] - a[1])
    .slice(0, ASSISTANT_CONFIG.BASKET_TOP_PAIRS);

  // resolve names for the products that actually appear in top pairs
  const ids = new Set<string>();
  for (const [key] of ranked) { const [a, b] = key.split("|"); ids.add(a); ids.add(b); }
  const names = ids.size
    ? await prisma.product.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } })
    : [];
  const nameMap = new Map(names.map((n) => [n.id, n.name]));

  const pairs = ranked.map(([key, count]) => {
    const [a, b] = key.split("|");
    return {
      productAId: a, productAName: nameMap.get(a) ?? "—",
      productBId: b, productBName: nameMap.get(b) ?? "—",
      count,
    };
  });

  return { pairs, cappedInvoices, analyzedInvoices: perInvoice.size };
}

// ── Snapshot persistence (idempotent upsert) ──────────────────────────────────

async function upsertSnapshot(kind: string, periodKey: string, data: unknown) {
  const generatedAt = new Date();
  await prisma.assistantSnapshot.upsert({
    where: { kind_periodKey: { kind, periodKey } },
    update: { data: data as Prisma.InputJsonValue, schemaVersion: SCHEMA_VERSION, generatedAt },
    create: { kind, periodKey, data: data as Prisma.InputJsonValue, schemaVersion: SCHEMA_VERSION, generatedAt },
  });
  return generatedAt;
}

interface HeavyData {
  sleeping: SleepingProduct[];
  reorder: any[];
  spike: any[];
  comparisonDay: string;
  builtForDate: string;
}

/** Build (and store) the heavy daily snapshot for `dateStr`. Idempotent. */
export async function buildHeavySnapshot(dateStr = todayStr(), tz = assistantTimezone()): Promise<HeavyData> {
  const { start } = zonedDayRange(dateStr, tz);
  const now = new Date();
  const comparisonDay = addDaysStr(dateStr, -1); // last complete calendar day
  const [sleeping, reorder, spike] = await Promise.all([
    computeSleeping(now),
    computeReorder(start),
    computeSpike(comparisonDay, tz),
  ]);
  const data: HeavyData = { sleeping, reorder, spike, comparisonDay, builtForDate: dateStr };
  await upsertSnapshot("DAILY_HEAVY", dateStr, data);
  return data;
}

/** Build (and store) the weekly basket snapshot. Idempotent per ISO week. */
export async function buildBasketSnapshot(tz = assistantTimezone()): Promise<{ periodKey: string }> {
  const periodKey = isoWeekKey(new Date(), tz);
  const data = await computeBasket();
  await upsertSnapshot("WEEKLY_BASKET", periodKey, data);
  return { periodKey };
}

function isoWeekKey(date: Date, tz: string): string {
  // Cheap, deterministic ISO-week label in tz. Good enough as a period key.
  const local = dayKeyInTz(date, tz);
  const d = new Date(`${local}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// In-memory rate-limit so a hammered manual refresh can't rebuild the heavy
// snapshot on every click (no Queue infra in this project — keep it simple).
let lastHeavyBuildMs = 0;
const HEAVY_REBUILD_COOLDOWN_MS = 2 * 60 * 1000;

async function getOrBuildHeavy(dateStr: string, tz: string, forceRebuild: boolean) {
  const existing = await prisma.assistantSnapshot.findUnique({
    where: { kind_periodKey: { kind: "DAILY_HEAVY", periodKey: dateStr } },
  });

  const canRebuild = Date.now() - lastHeavyBuildMs > HEAVY_REBUILD_COOLDOWN_MS;
  if (!existing || (forceRebuild && canRebuild)) {
    try {
      const data = await buildHeavySnapshot(dateStr, tz);
      lastHeavyBuildMs = Date.now();
      const fresh = await prisma.assistantSnapshot.findUnique({
        where: { kind_periodKey: { kind: "DAILY_HEAVY", periodKey: dateStr } },
      });
      return { data, generatedAt: fresh?.generatedAt ?? new Date(), usingPrevious: false };
    } catch (err) {
      // Build failed — fall back to the most recent valid snapshot if any.
      console.error("[daily-assistant] heavy snapshot build failed", err);
      const latest = await prisma.assistantSnapshot.findFirst({
        where: { kind: "DAILY_HEAVY" }, orderBy: { generatedAt: "desc" },
      });
      if (latest) return { data: latest.data as unknown as HeavyData, generatedAt: latest.generatedAt, usingPrevious: true };
      throw err;
    }
  }

  return {
    data: existing.data as unknown as HeavyData,
    generatedAt: existing.generatedAt,
    usingPrevious: existing.periodKey !== dateStr,
  };
}

async function getBasket() {
  const latest = await prisma.assistantSnapshot.findFirst({
    where: { kind: "WEEKLY_BASKET" }, orderBy: { generatedAt: "desc" },
  });
  if (latest) return { data: latest.data as any, generatedAt: latest.generatedAt };
  // First-ever load: build it once now.
  try {
    await buildBasketSnapshot();
    const fresh = await prisma.assistantSnapshot.findFirst({
      where: { kind: "WEEKLY_BASKET" }, orderBy: { generatedAt: "desc" },
    });
    return { data: (fresh?.data as any) ?? { pairs: [] }, generatedAt: fresh?.generatedAt ?? new Date() };
  } catch (err) {
    console.error("[daily-assistant] basket build failed", err);
    return { data: { pairs: [] }, generatedAt: null };
  }
}

// ── Rule engine: «شنو أسوي اليوم؟» ────────────────────────────────────────────
// Simple, testable, deterministic. Produces 3–5 prioritised suggestions from the
// data already computed. Never executes anything — advice only.

type Suggestion = {
  type: string;
  priority: number;
  title: string;
  description: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  actionUrl: string | null;
};

export function buildSuggestions(input: {
  reorder: any[];
  spike: any[];
  sleeping: SleepingProduct[];
  debtors: Array<{ id: string; name: string; balance: number; daysLate: number }>;
  tasks: { preparations: { count: number }; transfers: { count: number }; approvals: { count: number } };
  stopped60: Array<{ id: string; name: string; daysStopped: number }>;
  lowMargin: Array<{ productId: string; name: string; margin: number }>;
}): Suggestion[] {
  const out: Suggestion[] = [];
  const seenProducts = new Set<string>();
  const seenCustomers = new Set<string>();

  // 1) product expected to run out within 3 days (most urgent)
  for (const r of input.reorder) {
    if (r.daysLeft !== null && r.daysLeft <= 3) {
      if (seenProducts.has(r.productId)) continue;
      seenProducts.add(r.productId);
      out.push({
        type: "REORDER_URGENT", priority: 1,
        title: `«${r.name}» يوشك على النفاد`,
        description: `يكفي ${r.daysLeft} يوم تقريبًا. اقترح طلب ${r.suggestedPieces} قطعة${r.suggestedCartons ? ` (${r.suggestedCartons} كرتون)` : ""}.`,
        relatedEntityType: "product", relatedEntityId: r.productId, actionUrl: `/products/${r.productId}`,
      });
      break;
    }
  }

  // 2) a product at/below minStock
  for (const r of input.reorder) {
    if (r.currentStock <= r.minStock && !seenProducts.has(r.productId)) {
      seenProducts.add(r.productId);
      out.push({
        type: "BELOW_MIN_STOCK", priority: 2,
        title: `«${r.name}» تحت الحد الأدنى`,
        description: `المخزون ${r.currentStock} والحد الأدنى ${r.minStock}. راجع إعادة الطلب.`,
        relatedEntityType: "product", relatedEntityId: r.productId, actionUrl: `/products/${r.productId}`,
      });
      break;
    }
  }

  // 3) high overdue debtor
  const debtor = input.debtors[0];
  if (debtor && debtor.balance > 0) {
    seenCustomers.add(debtor.id);
    out.push({
      type: "DEBT_FOLLOWUP", priority: 2,
      title: `متابعة دين ${debtor.name}`,
      description: `الرصيد ${Math.round(debtor.balance).toLocaleString("en-US")} ومتأخر ${debtor.daysLate} يوم.`,
      relatedEntityType: "customer", relatedEntityId: debtor.id, actionUrl: `/customers/${debtor.id}`,
    });
  }

  // 4) pending approvals / transfers / preparations
  const pendingTotal = input.tasks.approvals.count + input.tasks.transfers.count + input.tasks.preparations.count;
  if (pendingTotal > 0) {
    const parts: string[] = [];
    if (input.tasks.approvals.count) parts.push(`${input.tasks.approvals.count} موافقة`);
    if (input.tasks.transfers.count) parts.push(`${input.tasks.transfers.count} تحويل`);
    if (input.tasks.preparations.count) parts.push(`${input.tasks.preparations.count} تجهيز`);
    out.push({
      type: "PENDING_TASKS", priority: 3,
      title: "لديك مهام معلقة",
      description: `${parts.join("، ")} بانتظار المعالجة.`,
      relatedEntityType: null, relatedEntityId: null,
      actionUrl: input.tasks.approvals.count ? "/approvals" : input.tasks.transfers.count ? "/transfers" : "/order-preparations",
    });
  }

  // 5) sleeping product tying up big capital
  const frozen = [...input.sleeping].sort((a, b) => b.capitalValue - a.capitalValue)[0];
  if (frozen && frozen.capitalValue > 0 && !seenProducts.has(frozen.productId)) {
    seenProducts.add(frozen.productId);
    out.push({
      type: "FROZEN_CAPITAL", priority: 3,
      title: `رأس مال مجمّد في «${frozen.name}»`,
      description: `${frozen.currentStock} قطعة نائمة منذ ${frozen.daysIdle} يوم بقيمة ${Math.round(frozen.capitalValue).toLocaleString("en-US")}.`,
      relatedEntityType: "product", relatedEntityId: frozen.productId, actionUrl: `/products/${frozen.productId}`,
    });
  }

  // 6) sales spike
  const spike = input.spike[0];
  if (spike && !seenProducts.has(spike.productId)) {
    seenProducts.add(spike.productId);
    out.push({
      type: "SALES_SPIKE", priority: 4,
      title: `قفزة مبيعات في «${spike.name}»`,
      description: `بيع ${spike.comparisonDayQty} قطعة يوم ${spike.comparisonDay} (المعدل ${spike.dailyAverage}، +${spike.risePercent}%).`,
      relatedEntityType: "product", relatedEntityId: spike.productId, actionUrl: `/products/${spike.productId}`,
    });
  }

  // 7) important customer who stopped buying
  const stopped = input.stopped60[0];
  if (stopped && !seenCustomers.has(stopped.id)) {
    seenCustomers.add(stopped.id);
    out.push({
      type: "CUSTOMER_STOPPED", priority: 4,
      title: `${stopped.name} توقف عن الشراء`,
      description: `آخر تعامل منذ ${stopped.daysStopped} يوم. تواصل معه.`,
      relatedEntityType: "customer", relatedEntityId: stopped.id, actionUrl: `/customers/${stopped.id}`,
    });
  }

  // 8) review a negative / low-margin product
  const low = input.lowMargin.find((p) => !seenProducts.has(p.productId));
  if (low) {
    seenProducts.add(low.productId);
    out.push({
      type: "LOW_MARGIN", priority: 5,
      title: `راجع هامش «${low.name}»`,
      description: low.margin < 0 ? `يبيع بخسارة (هامش ${low.margin}%). راجع سعر البيع أو الكلفة.` : `هامش الربح منخفض (${low.margin}%).`,
      relatedEntityType: "product", relatedEntityId: low.productId, actionUrl: `/products/${low.productId}`,
    });
  }

  return out.sort((a, b) => a.priority - b.priority).slice(0, 5);
}

// ── Public aggregate endpoint ─────────────────────────────────────────────────

export interface DailyAssistantQuery {
  date?: string;
  refresh?: boolean;
}

export async function getDailyAssistant(query: DailyAssistantQuery = {}) {
  const tz = assistantTimezone();
  const selectedDate = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : todayStr(tz);
  const { start, end } = zonedDayRange(selectedDate, tz);
  const fallbacksUsed: string[] = [];

  // LIVE sections (always fresh)
  const [live, todaySelling, weekSelling, debtors, stopped, tasks, topWeekCustomers] = await Promise.all([
    computeLiveSummary(start, end),
    topSellingBetween(start, end),
    topSellingBetween(new Date(start.getTime() - 6 * DAY_MS), end),
    topDebtors(),
    stoppedCustomers(),
    pendingTasks(),
    getTopCustomersReport({ from: addDaysStr(selectedDate, -6), to: selectedDate, limit: ASSISTANT_CONFIG.TOP_N }),
  ]);

  // derived from live product agg: top-profit + low-margin today
  const products = Array.from(live.productAgg.values());
  const topProfit = products
    .filter((p) => p.pieces > 0)
    .map((p) => ({ productId: p.productId, name: p.name, profit: roundMoney(p.revenue - p.cost) }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, ASSISTANT_CONFIG.TOP_N);

  const sold = products.filter((p) => p.pieces > 0);
  const excludedNoCost = sold.filter((p) => !p.hasCost).length;
  const lowMargin = sold
    .filter((p) => p.hasCost && p.revenue > 0)
    .map((p) => ({
      productId: p.productId, name: p.name,
      margin: marginPercent(p.revenue, p.cost) ?? 0,
      profit: roundMoney(p.revenue - p.cost),
    }))
    .sort((a, b) => a.margin - b.margin)
    .slice(0, ASSISTANT_CONFIG.TOP_N);

  const usingTodayFallback = todaySelling.length === 0;
  if (usingTodayFallback) fallbacksUsed.push("top_selling_last_7_days");

  // HEAVY snapshot (cached) + WEEKLY basket (cached)
  const heavy = await getOrBuildHeavy(selectedDate, tz, !!query.refresh);
  if (heavy.usingPrevious) fallbacksUsed.push("previous_daily_snapshot");
  const basket = await getBasket();

  const suggestions = buildSuggestions({
    reorder: heavy.data.reorder,
    spike: heavy.data.spike,
    sleeping: heavy.data.sleeping,
    debtors: debtors.map((d) => ({ id: d.id, name: d.name, balance: d.balance, daysLate: d.daysLate })),
    tasks,
    stopped60: stopped.stopped60,
    lowMargin,
  });

  const frozenCapital = [...heavy.data.sleeping].sort((a, b) => b.capitalValue - a.capitalValue);

  return {
    meta: {
      selectedDate,
      timezone: tz,
      generatedAt: new Date().toISOString(),
      heavySnapshotGeneratedAt: heavy.generatedAt ? heavy.generatedAt.toISOString() : null,
      basketAnalysisGeneratedAt: basket.generatedAt ? basket.generatedAt.toISOString() : null,
      isUsingPreviousSnapshot: heavy.usingPrevious,
      comparisonDay: heavy.data.comparisonDay,
      fallbacksUsed,
      excludedNoCostCount: excludedNoCost,
    },
    summary: live.summary,
    suggestions,
    products: {
      topSellingToday: todaySelling,
      topSellingLast7Days: usingTodayFallback ? weekSelling : [],
      topProfitToday: topProfit,
      lowMarginToday: lowMargin,
      sleeping: heavy.data.sleeping.slice(0, ASSISTANT_CONFIG.TOP_N),
      sleepingAll: heavy.data.sleeping,
      frozenCapital: frozenCapital.slice(0, ASSISTANT_CONFIG.TOP_N),
      frozenCapitalAll: frozenCapital,
      reorder: heavy.data.reorder.slice(0, ASSISTANT_CONFIG.TOP_N),
      reorderAll: heavy.data.reorder,
      spike: heavy.data.spike,
      basket: basket.data.pairs ?? [],
    },
    customers: {
      topDebtors: debtors,
      topThisWeek: topWeekCustomers,
      stopped30: stopped.stopped30,
      stopped60: stopped.stopped60,
    },
    tasks,
  };
}
