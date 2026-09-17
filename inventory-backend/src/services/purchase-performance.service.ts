/**
 * «أداء المشتريات» — how each purchase (a China order or an ordinary purchase
 * invoice) is actually selling, so the merchant knows what to order again.
 *
 * Every purchase line is a "lot": N pieces bought at a known cost on a known day.
 * Sales are not tracked per physical piece — that needs batch bookkeeping the
 * shop does not do. Instead each sale is SHARED between the lots of that product
 * that were already bought and still have pieces left, in proportion to what
 * each has left. A lot that is used up drops out and the next sales go to the
 * others. Returns give pieces back to the lots that sold them, in the same
 * proportion. It is an estimate, and deliberately a simple one.
 *
 * Profit uses the lot's OWN cost — the price on that purchase line (or the
 * landed cost for a China order) — never the product's current cost, which a
 * later purchase has already averaged over.
 *
 * Speed and profit are graded RELATIVE to every other lot (thirds), so "fast"
 * means fast for this shop, and the grades move by themselves as the shop does.
 */
import { InvoiceStatus, InvoiceType } from "@prisma/client";
import prisma from "../config/database";
import { amountInPieces } from "../utils/financial";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A lot younger than this with nothing sold yet is new, not stagnant. */
export const NEW_LOT_DAYS = 7;

export type PurchaseSource = "CHINA" | "REGULAR";
export type Level = "HIGH" | "MEDIUM" | "LOW";
export type PerformanceCategory =
  | "BEST"
  | "HIGH_PROFIT_MEDIUM"
  | "HIGH_PROFIT_SLOW"
  | "FAST_LOW_PROFIT"
  | "BALANCED"
  | "STAGNANT"
  | "NEW"
  | "OTHER";

export interface LotInput {
  lotId: string;
  invoiceId: string;
  invoiceNumber: string;
  supplierName: string;
  date: Date;
  source: PurchaseSource;
  productId: string;
  productName: string;
  itemNumber: string;
  thumbnailUrl: string | null;
  pcsPerCarton: number;
  /** Current wholesale piece price — only used to estimate the margin of a lot that has sold nothing. */
  salePrice: number;
  orderedPieces: number;
  costPerPiece: number;
}

export interface SaleEvent {
  productId: string;
  date: Date;
  /** Positive for a sale, negative for a return. */
  pieces: number;
  /** Net revenue after the invoice-level discount; negative for a return. */
  revenue: number;
}

interface LotState extends LotInput {
  sold: number;
  revenue: number;
  lastSaleAt: Date | null;
}

/** Shares every sale and return between the lots that were open at that moment. */
export function allocateSales(lots: LotInput[], events: SaleEvent[]): { states: LotState[]; unattributedPieces: number } {
  const states: LotState[] = lots.map((lot) => ({ ...lot, sold: 0, revenue: 0, lastSaleAt: null }));
  const byProduct = new Map<string, LotState[]>();
  for (const state of states) {
    const list = byProduct.get(state.productId) ?? [];
    list.push(state);
    byProduct.set(state.productId, list);
  }

  let unattributedPieces = 0;
  const ordered = [...events].sort((a, b) => a.date.getTime() - b.date.getTime());

  for (const event of ordered) {
    const productLots = byProduct.get(event.productId);
    if (!productLots || event.pieces === 0) continue;
    // Only goods that had already been bought can have been sold.
    const open = productLots.filter((lot) => lot.date.getTime() <= event.date.getTime());

    if (event.pieces > 0) {
      const withStock = open.filter((lot) => lot.orderedPieces - lot.sold > 1e-9);
      const available = withStock.reduce((sum, lot) => sum + (lot.orderedPieces - lot.sold), 0);
      if (available <= 0) {
        unattributedPieces += event.pieces;
        continue;
      }
      // More sold than these lots hold: fill them up, the rest came from stock
      // bought outside any recorded purchase (opening balance, older data).
      const attributed = Math.min(event.pieces, available);
      unattributedPieces += event.pieces - attributed;
      const revenuePerPiece = event.revenue / event.pieces;
      for (const lot of withStock) {
        const share = attributed * ((lot.orderedPieces - lot.sold) / available);
        lot.sold += share;
        lot.revenue += share * revenuePerPiece;
        lot.lastSaleAt = event.date;
      }
    } else {
      const returned = -event.pieces;
      const sellers = open.filter((lot) => lot.sold > 1e-9);
      const soldTotal = sellers.reduce((sum, lot) => sum + lot.sold, 0);
      if (soldTotal <= 0) continue;
      const given = Math.min(returned, soldTotal);
      const revenuePerPiece = event.revenue / event.pieces; // both negative → positive
      for (const lot of sellers) {
        const share = given * (lot.sold / soldTotal);
        lot.sold -= share;
        lot.revenue -= share * revenuePerPiece;
      }
    }
  }

  return { states, unattributedPieces };
}

/**
 * Where `value` sits among `sorted` (ascending), 0 (lowest) … 1 (highest). Ties
 * share the average of their positions so equal lots grade equally. A value that
 * is not in the list is placed where it would fall.
 */
function positionAmong(sorted: number[], value: number): number {
  if (sorted.length === 0) return 0.5;
  if (sorted.length === 1) return value > sorted[0] ? 1 : value < sorted[0] ? 0 : 0.5;
  let below = 0;
  let equal = 0;
  for (const item of sorted) {
    if (item < value) below += 1;
    else if (item === value) equal += 1;
  }
  const position = equal > 0 ? below + (equal - 1) / 2 : below - 0.5;
  return Math.min(1, Math.max(0, position / (sorted.length - 1)));
}

const levelOf = (p: number): Level => (p >= 2 / 3 ? "HIGH" : p >= 1 / 3 ? "MEDIUM" : "LOW");

const round = (value: number, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export interface LotPerformance {
  lotId: string;
  invoiceId: string;
  invoiceNumber: string;
  supplierName: string;
  date: string;
  source: PurchaseSource;
  productId: string;
  productName: string;
  itemNumber: string;
  thumbnailUrl: string | null;
  pcsPerCarton: number;
  orderedPieces: number;
  soldPieces: number;
  remainingPieces: number;
  soldPercent: number;
  daysActive: number;
  soldOut: boolean;
  piecesPerDay: number;
  /** Estimated days until the rest is gone at the current pace; null when nothing sells. */
  daysToSellOut: number | null;
  costPerPiece: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  /** True when nothing has sold yet and the margin comes from the current sale price. */
  marginIsExpected: boolean;
  speedLevel: Level;
  profitLevel: Level;
  category: PerformanceCategory;
  score: number;
}

export function gradeLots(states: LotState[], now: Date): LotPerformance[] {
  const base = states.map((lot) => {
    const sold = Math.max(0, lot.sold);
    const soldOut = sold >= lot.orderedPieces - 1e-6;
    const end = soldOut && lot.lastSaleAt ? lot.lastSaleAt : now;
    const daysActive = Math.max(1, (end.getTime() - lot.date.getTime()) / DAY_MS);
    const soldShare = lot.orderedPieces > 0 ? sold / lot.orderedPieces : 0;
    const piecesPerDay = sold / daysActive;
    const cost = sold * lot.costPerPiece;
    const profit = lot.revenue - cost;
    const hasSales = sold > 1e-6 && lot.revenue > 0;
    const margin = hasSales
      ? (profit / lot.revenue) * 100
      : lot.salePrice > 0
        ? ((lot.salePrice - lot.costPerPiece) / lot.salePrice) * 100
        : 0;
    const isNew = !hasSales && daysActive < NEW_LOT_DAYS;
    return {
      lot, sold, soldOut, daysActive, soldShare, piecesPerDay, cost, profit, hasSales, margin, isNew,
      // Share of the order sold per day: comparable between a 10-carton and a 500-carton order.
      speed: soldShare / daysActive,
    };
  });

  // Grades are set by the lots that actually SELL. A lot that sold nothing is
  // stagnant whatever its margin, and letting its hoped-for margin into the
  // ranking pushed real sellers down — the best seller in the shop came out as
  // "low profit" because two unsold lots promised more on paper.
  const sellers = base.filter((row) => row.hasSales);
  const speeds = sellers.map((row) => row.speed).sort((a, b) => a - b);
  const margins = sellers.map((row) => row.margin).sort((a, b) => a - b);
  const rank = new Map(base.map((row) => [row, {
    speed: row.hasSales ? positionAmong(speeds, row.speed) : 0,
    margin: positionAmong(margins, row.margin),
  }]));

  return base.map((row) => {
    const r = rank.get(row) ?? { speed: 0, margin: 0.5 };
    const speedLevel: Level = row.hasSales ? levelOf(r.speed) : "LOW";
    const profitLevel = levelOf(r.margin);

    let category: PerformanceCategory;
    if (row.isNew) category = "NEW";
    else if (!row.hasSales) category = "STAGNANT";
    else if (speedLevel === "HIGH" && profitLevel === "HIGH") category = "BEST";
    else if (profitLevel === "HIGH" && speedLevel === "MEDIUM") category = "HIGH_PROFIT_MEDIUM";
    else if (profitLevel === "HIGH" && speedLevel === "LOW") category = "HIGH_PROFIT_SLOW";
    else if (speedLevel === "HIGH") category = "FAST_LOW_PROFIT";
    else if (speedLevel === "LOW" && profitLevel === "LOW") category = "STAGNANT";
    else if (speedLevel === "MEDIUM" && profitLevel === "MEDIUM") category = "BALANCED";
    else category = "OTHER";

    const remaining = Math.max(0, row.lot.orderedPieces - row.sold);
    return {
      lotId: row.lot.lotId,
      invoiceId: row.lot.invoiceId,
      invoiceNumber: row.lot.invoiceNumber,
      supplierName: row.lot.supplierName,
      date: row.lot.date.toISOString(),
      source: row.lot.source,
      productId: row.lot.productId,
      productName: row.lot.productName,
      itemNumber: row.lot.itemNumber,
      thumbnailUrl: row.lot.thumbnailUrl,
      pcsPerCarton: row.lot.pcsPerCarton,
      orderedPieces: round(row.lot.orderedPieces),
      soldPieces: round(row.sold),
      remainingPieces: round(remaining),
      soldPercent: round(row.soldShare * 100, 1),
      daysActive: Math.floor(row.daysActive),
      soldOut: row.soldOut,
      piecesPerDay: round(row.piecesPerDay, 1),
      daysToSellOut: !row.soldOut && row.piecesPerDay > 0 ? Math.ceil(remaining / row.piecesPerDay) : null,
      costPerPiece: round(row.lot.costPerPiece),
      revenue: round(row.lot.revenue),
      cost: round(row.cost),
      profit: round(row.profit),
      margin: round(row.margin, 1),
      marginIsExpected: !row.hasSales,
      speedLevel,
      profitLevel,
      category,
      // Equal weight to pace and margin — the default order of the page.
      score: row.isNew ? -1 : round((r.speed + r.margin) * 50, 1),
    };
  });
}

export async function getPurchasePerformance(query: {
  invoiceId?: string;
  source?: PurchaseSource;
  category?: PerformanceCategory;
}) {
  const purchases = await prisma.invoice.findMany({
    where: { type: InvoiceType.PURCHASE, status: InvoiceStatus.ACTIVE, archivedAt: null },
    select: {
      id: true,
      invoiceNumber: true,
      date: true,
      subtotal: true,
      totalAmount: true,
      customer: { select: { name: true } },
      landedCostBatches: {
        select: { items: { select: { productId: true, landedCostPerUnit: true } } },
      },
      items: {
        select: {
          id: true,
          productId: true,
          productName: true,
          itemNumber: true,
          unit: true,
          quantity: true,
          unitPrice: true,
          product: {
            select: { pcsPerCarton: true, boxPieces: true, salePrice: true, thumbnailUrl: true, deletedAt: true },
          },
        },
      },
    },
  });

  const lots: LotInput[] = [];
  for (const invoice of purchases) {
    const subtotal = Number(invoice.subtotal);
    // A supplier discount lowers what every piece really cost.
    const discountRatio = subtotal > 0 ? Number(invoice.totalAmount) / subtotal : 1;
    const landed = new Map<string, number>();
    for (const batch of invoice.landedCostBatches) {
      for (const item of batch.items) {
        const value = Number(item.landedCostPerUnit);
        if (item.productId && value > 0) landed.set(item.productId, value);
      }
    }
    const source: PurchaseSource = invoice.landedCostBatches.length > 0 ? "CHINA" : "REGULAR";

    for (const item of invoice.items) {
      if (item.product.deletedAt) continue;
      const pieces = amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton, item.product.boxPieces);
      if (pieces <= 0) continue;
      const paidPerPiece = (Number(item.unitPrice) * item.quantity * discountRatio) / pieces;
      lots.push({
        lotId: item.id,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        supplierName: invoice.customer.name,
        date: invoice.date,
        source,
        productId: item.productId,
        productName: item.productName,
        itemNumber: item.itemNumber ?? "",
        thumbnailUrl: item.product.thumbnailUrl,
        pcsPerCarton: item.product.pcsPerCarton,
        salePrice: Number(item.product.salePrice),
        orderedPieces: pieces,
        // A China order's real cost includes shipping and clearance.
        costPerPiece: landed.get(item.productId) ?? paidPerPiece,
      });
    }
  }

  const productIds = [...new Set(lots.map((lot) => lot.productId))];
  const earliest = lots.reduce<Date | null>((min, lot) => (!min || lot.date < min ? lot.date : min), null);

  const saleItems = productIds.length && earliest
    ? await prisma.invoiceItem.findMany({
        where: {
          productId: { in: productIds },
          invoice: {
            type: { in: [InvoiceType.SALE, InvoiceType.SALES_RETURN] },
            status: InvoiceStatus.ACTIVE,
            archivedAt: null,
            date: { gte: earliest },
          },
        },
        select: {
          productId: true,
          unit: true,
          quantity: true,
          totalPrice: true,
          product: { select: { pcsPerCarton: true, boxPieces: true } },
          invoice: { select: { type: true, date: true, subtotal: true, totalAmount: true } },
        },
      })
    : [];

  const events: SaleEvent[] = saleItems.map((item) => {
    const sign = item.invoice.type === InvoiceType.SALES_RETURN ? -1 : 1;
    const subtotal = Number(item.invoice.subtotal);
    const ratio = subtotal > 0 ? Number(item.invoice.totalAmount) / subtotal : 0;
    return {
      productId: item.productId,
      date: item.invoice.date,
      pieces: sign * amountInPieces(item.unit, item.quantity, item.product.pcsPerCarton, item.product.boxPieces),
      revenue: sign * Number(item.totalPrice) * ratio,
    };
  });

  const { states } = allocateSales(lots, events);
  // Graded over EVERY lot, then filtered — a line's grade inside one invoice
  // still means "compared with the whole shop".
  const all = gradeLots(states, new Date());

  const rows = all
    .filter((row) => (query.invoiceId ? row.invoiceId === query.invoiceId : true))
    .filter((row) => (query.source ? row.source === query.source : true))
    .filter((row) => (query.category ? row.category === query.category : true))
    .sort((a, b) => b.score - a.score);

  // Per-order roll-up, for the list of orders.
  const orders = new Map<string, {
    invoiceId: string; invoiceNumber: string; supplierName: string; date: string; source: PurchaseSource;
    lines: number; orderedPieces: number; soldPieces: number; revenue: number; profit: number;
    best: number; stagnant: number;
  }>();
  for (const row of all) {
    if (query.invoiceId && row.invoiceId !== query.invoiceId) continue;
    if (query.source && row.source !== query.source) continue;
    const order = orders.get(row.invoiceId) ?? {
      invoiceId: row.invoiceId, invoiceNumber: row.invoiceNumber, supplierName: row.supplierName,
      date: row.date, source: row.source, lines: 0, orderedPieces: 0, soldPieces: 0, revenue: 0, profit: 0,
      best: 0, stagnant: 0,
    };
    order.lines += 1;
    order.orderedPieces += row.orderedPieces;
    order.soldPieces += row.soldPieces;
    order.revenue += row.revenue;
    order.profit += row.profit;
    if (row.category === "BEST") order.best += 1;
    if (row.category === "STAGNANT") order.stagnant += 1;
    orders.set(row.invoiceId, order);
  }

  const categoryCounts: Record<string, number> = {};
  for (const row of all) {
    if (query.invoiceId && row.invoiceId !== query.invoiceId) continue;
    if (query.source && row.source !== query.source) continue;
    categoryCounts[row.category] = (categoryCounts[row.category] ?? 0) + 1;
  }

  return {
    rows,
    orders: [...orders.values()]
      .map((order) => ({
        ...order,
        soldPercent: order.orderedPieces > 0 ? round((order.soldPieces / order.orderedPieces) * 100, 1) : 0,
        margin: order.revenue > 0 ? round((order.profit / order.revenue) * 100, 1) : 0,
      }))
      .sort((a, b) => b.date.localeCompare(a.date)),
    categoryCounts,
  };
}
