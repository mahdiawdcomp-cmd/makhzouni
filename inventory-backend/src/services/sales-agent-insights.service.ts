/**
 * What the rep should know the moment they pick a customer.
 *
 * Two screens, one source: «يشتريها عادةً» (what to offer again) and the
 * follow-up reasons attached to a customer row. Both are read-only — nothing in
 * this file writes, prices an order, or touches stock. The order path prices
 * itself through `utils/sales-agent-pricing.ts`; the prices shown here come
 * from that same resolver so the rep is not shown one number and billed another.
 */
import { Unit } from "@prisma/client";
import prisma from "../config/database";
import { getSettings } from "./settings.service";
import { resolveShopWarehouseId } from "./warehouse-stock.service";
import { assertOwnCustomer, sellableStock } from "./sales-agent.service";
import { piecesForUnit as piecesFor } from "../utils/catalog-units";
import { shopInclusiveEndKey } from "../utils/shop-day";
import { frequentPurchases, lastPaidPrices, priceChangeFor } from "./sales-agent-history.service";
import { OFFER_ENDING_SOON_DAYS, offerMapForCustomer, offersEndingSoon } from "./sales-agent-offers.service";
import {
  AgentApprovedPriceRow,
  AgentPriceMode,
  priceKey,
  resolveAgentUnitPrice,
} from "../utils/sales-agent-pricing";

/** How many distinct (product, unit) pairs of history to consider. */
const HISTORY_ROWS = 80;
/** How many rows the screen actually gets. */
const DEFAULT_LIMIT = 24;

function normalizeMode(value: unknown): AgentPriceMode {
  return value === "CARTON" ? "CARTON" : "WHOLESALE";
}

/**
 * Is this (product, unit) something the rep can sell RIGHT NOW in this mode?
 *
 * The same three rules the order path enforces, deliberately: a row the rep can
 * tap must be a row `submitAgentOrder` will accept. Distribution is whole
 * cartons with a positive carton price and at least one carton in the shop;
 * wholesale keeps the units the wholesale catalog allows.
 */
function sellableInMode(
  product: {
    pcsPerCarton: number;
    cartonPiecePrice: unknown;
    hiddenUnits: Unit[];
  },
  unit: Unit,
  stock: number,
  mode: AgentPriceMode,
): boolean {
  if (stock <= 0) return false;
  if (mode === "CARTON") {
    if (unit !== Unit.CARTON) return false;
    if (product.hiddenUnits.includes(unit)) return false;
    if (!Number.isInteger(product.pcsPerCarton) || product.pcsPerCarton < 1) return false;
    if (stock < product.pcsPerCarton) return false;
    const cartonPrice = Number(product.cartonPiecePrice);
    return Number.isFinite(cartonPrice) && cartonPrice > 0;
  }
  // Wholesale: PIECE / DOZEN / BOX / CARTON, as the wholesale catalog offers
  // them. Invoice-only hidden units do not restrict wholesale orders — the same
  // rule `submitAgentOrder` applies.
  return [Unit.PIECE, Unit.DOZEN, Unit.BOX, Unit.CARTON].includes(unit);
}

/**
 * Turn an average into a quantity to put in the cart.
 *
 * The rounding rule, stated so it can be tested: **round half up** on the
 * average, then floor at 1, then cap at the whole units the shop can actually
 * supply. So 4, 6, 8 → average 6 → 6; and 4, 5 → average 4.5 → 5.
 *
 * The cap is «لا تقترح أكثر من المتوفر». When the shop holds less than one
 * whole unit (5 pieces against a dozen) the cap would be zero, which is not a
 * suggestion at all — the suggestion stays 1 and the available quantity is
 * shown beside it, because a shortage never blocks a sale in this shop. The
 * row is marked `stockCapped` whenever the cap changed the number.
 */
function suggestQuantity(
  average: number,
  unit: Unit,
  product: { pcsPerCarton: number; boxPieces?: number | null },
  stock: number,
): { quantity: number; stockCapped: boolean } {
  const rounded = Math.max(1, Math.round(Number.isFinite(average) ? average : 1));
  const perUnit = Math.max(1, piecesFor(unit, 1, product.pcsPerCarton, product.boxPieces));
  const cap = Math.floor(Math.max(0, stock) / perUnit);
  if (cap <= 0) return { quantity: 1, stockCapped: false };
  return { quantity: Math.min(rounded, cap), stockCapped: cap < rounded };
}

export type FrequentProductRow = {
  productId: string;
  productName: string;
  itemNumber: string | null;
  unit: Unit;
  times: number;
  /**
   * What to put in the cart: the average of the last three purchases, rounded,
   * floored at 1 and capped by what the shop actually holds.
   *
   * Deliberately NOT «the last quantity» any more — one unusual basket used to
   * become "the usual", which is how a rep ends up offering 20 cartons because
   * of one big order last winter.
   */
  suggestedQuantity: number;
  /** The un-rounded average, so the screen can explain the suggestion. */
  averageQuantity: number;
  /** 1, 2 or 3 — how many purchases the average is built from. */
  averageSampleSize: number;
  /** False when the average had to fall back to other price baskets. */
  averageMatchesPriceMode: boolean;
  /** True when the suggestion was reduced to fit the available stock. */
  stockCapped: boolean;
  lastPurchaseAt: Date;
  availableStock: number;
  pcsPerCarton: number;
  boxPieces: number | null;
  hasImage: boolean;
  currentPrice: number;
  catalogPrice: number;
  priceSource: "APPROVED_REQUEST" | "OFFER" | "CATALOG";
  offer?: { id: string; endsAt: Date; endsOnDate: string; note: string | null };
  priceChange?: {
    previousPrice: number;
    currentPrice: number;
    difference: number;
    percent: number;
    direction: "UP" | "DOWN";
    lastPurchaseAt: Date;
  };
};

/**
 * «يشتريها عادةً» — the products this customer buys, ready to re-add.
 *
 * Ordering comes from real invoices (frequency, then recency). What is dropped:
 * anything out of stock in المحل, and anything not sellable in the current
 * price mode. The historical price is NEVER offered as today's price — it is
 * shown only as the «كان بـ» side of the change note.
 */
export async function frequentProductsForCustomer(
  agentId: string,
  customerId: string,
  opts?: { priceMode?: unknown; limit?: number; lookbackDays?: number; now?: Date },
): Promise<{ priceMode: AgentPriceMode; products: FrequentProductRow[] }> {
  const customer = await assertOwnCustomer(agentId, customerId);
  const mode = normalizeMode(opts?.priceMode);
  const limit = Math.min(Math.max(1, opts?.limit ?? DEFAULT_LIMIT), 60);
  const now = opts?.now ?? new Date();

  const history = await frequentPurchases({
    customerId: customer.id,
    priceMode: mode,
    limit: HISTORY_ROWS,
    lookbackDays: opts?.lookbackDays,
  });
  if (history.length === 0) return { priceMode: mode, products: [] };

  const productIds = [...new Set(history.map((row) => row.productId))];
  const [settings, shopWarehouseId, products, offers, previousPrices, approvedRows] = await Promise.all([
    getSettings().catch(() => null),
    resolveShopWarehouseId(prisma).catch(() => null),
    prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
      // Cost and profit never leave the server for a rep: explicit select, so a
      // new column cannot start shipping to a rep's phone by accident.
      select: {
        id: true,
        itemNumber: true,
        name: true,
        salePrice: true,
        cartonPiecePrice: true,
        pcsPerCarton: true,
        boxPieces: true,
        hiddenUnits: true,
        thumbnailUrl: true,
        openingBalancePcs: true,
        cartonsAvailable: true,
        warehouseStocks: { select: { quantityPieces: true, warehouseId: true } },
      },
    }),
    offerMapForCustomer(customer.id, productIds, now, mode),
    lastPaidPrices({ customerId: customer.id, productIds }),
    prisma.salesAgentPriceRequest.findMany({
      where: {
        salesAgentId: agentId,
        customerId: customer.id,
        status: "APPROVED",
        consumedAt: null,
        productId: { in: productIds },
        product: { deletedAt: null },
      },
      select: { id: true, productId: true, unit: true, requestedPrice: true },
    }),
  ]);

  const fullCartonOnly = Boolean(settings?.catalogFullCartonOnly);
  const productById = new Map(products.map((p) => [p.id, p]));
  const approvedPrices = new Map<string, AgentApprovedPriceRow>(
    approvedRows.map((row) => [
      priceKey(row.productId, row.unit),
      { id: row.id, productId: row.productId, unit: row.unit, price: Number(row.requestedPrice) },
    ]),
  );

  const rows: FrequentProductRow[] = [];
  for (const entry of history) {
    if (rows.length >= limit) break;
    const product = productById.get(entry.productId);
    // Deleted since it was sold — a row the rep taps would fail at submit.
    if (!product) continue;
    const stock = sellableStock(product, shopWarehouseId);
    // The merchant's one global «الكارتون الكامل فقط» switch governs what the
    // shop sells, so it governs this list too — same as the catalog grid.
    if (fullCartonOnly && !(product.pcsPerCarton >= 1 && stock >= product.pcsPerCarton)) continue;
    if (!sellableInMode(product, entry.unit, stock, mode)) continue;

    const resolved = resolveAgentUnitPrice({
      product: {
        id: product.id,
        salePrice: product.salePrice,
        cartonPiecePrice: product.cartonPiecePrice,
        pcsPerCarton: product.pcsPerCarton,
        boxPieces: product.boxPieces,
      },
      unit: entry.unit,
      priceMode: mode,
      now,
      approvedPrices,
      offers,
    });
    if (resolved.unitPrice <= 0) continue;

    const change = priceChangeFor(previousPrices.get(priceKey(product.id, entry.unit)), resolved.unitPrice, mode);
    const suggestion = suggestQuantity(entry.averageQuantity, entry.unit, product, stock);

    rows.push({
      productId: product.id,
      productName: product.name,
      itemNumber: product.itemNumber,
      unit: entry.unit,
      times: entry.times,
      suggestedQuantity: suggestion.quantity,
      averageQuantity: entry.averageQuantity,
      averageSampleSize: entry.averageSampleSize,
      averageMatchesPriceMode: entry.averageMatchesPriceMode,
      stockCapped: suggestion.stockCapped,
      lastPurchaseAt: entry.lastPurchaseAt,
      availableStock: stock,
      pcsPerCarton: product.pcsPerCarton,
      boxPieces: product.boxPieces,
      // Images are fetched a screenful at a time through the existing thumbnail
      // endpoint; inlining them here would be megabytes on mobile data.
      hasImage: Boolean(product.thumbnailUrl),
      currentPrice: resolved.unitPrice,
      catalogPrice: resolved.catalogPrice,
      priceSource: resolved.source,
      offer: resolved.offer
        ? {
            id: resolved.offer.id,
            endsAt: resolved.offer.endsAt,
            endsOnDate: shopInclusiveEndKey(resolved.offer.endsAt),
            note: resolved.offer.note,
          }
        : undefined,
      priceChange: change ?? undefined,
    });
  }

  return { priceMode: mode, products: rows };
}

/**
 * Today's price for a whole cart, with the change note against what the
 * customer last paid.
 *
 * The rep's cart lines are priced by the order preview; this is the lighter
 * read the catalog uses while browsing, so a price alert can appear as lines
 * are added without posting a whole order for review.
 */
export async function priceNotesForCustomer(
  agentId: string,
  customerId: string,
  input: { priceMode?: unknown; lines: Array<{ productId: string; unit: Unit }> },
) {
  const customer = await assertOwnCustomer(agentId, customerId);
  const mode = normalizeMode(input.priceMode);
  const lines = (input.lines ?? []).slice(0, 200).filter((line) => line && typeof line.productId === "string");
  if (lines.length === 0) return { priceMode: mode, notes: [] };

  const productIds = [...new Set(lines.map((line) => line.productId))];
  const now = new Date();
  const [products, offers, previousPrices, approvedRows] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
      select: {
        id: true,
        name: true,
        salePrice: true,
        cartonPiecePrice: true,
        pcsPerCarton: true,
        boxPieces: true,
      },
    }),
    offerMapForCustomer(customer.id, productIds, now, mode),
    lastPaidPrices({ customerId: customer.id, productIds }),
    prisma.salesAgentPriceRequest.findMany({
      where: {
        salesAgentId: agentId,
        customerId: customer.id,
        status: "APPROVED",
        consumedAt: null,
        productId: { in: productIds },
        product: { deletedAt: null },
      },
      select: { id: true, productId: true, unit: true, requestedPrice: true },
    }),
  ]);

  const productById = new Map(products.map((p) => [p.id, p]));
  const approvedPrices = new Map<string, AgentApprovedPriceRow>(
    approvedRows.map((row) => [
      priceKey(row.productId, row.unit),
      { id: row.id, productId: row.productId, unit: row.unit, price: Number(row.requestedPrice) },
    ]),
  );

  const notes = lines.flatMap((line) => {
    const product = productById.get(line.productId);
    if (!product || !Object.values(Unit).includes(line.unit)) return [];
    const resolved = resolveAgentUnitPrice({
      product: {
        id: product.id,
        salePrice: product.salePrice,
        cartonPiecePrice: product.cartonPiecePrice,
        pcsPerCarton: product.pcsPerCarton,
        boxPieces: product.boxPieces,
      },
      unit: line.unit,
      priceMode: mode,
      now,
      approvedPrices,
      offers,
    });
    const change = priceChangeFor(previousPrices.get(priceKey(product.id, line.unit)), resolved.unitPrice, mode);
    return [{
      productId: product.id,
      productName: product.name,
      unit: line.unit,
      currentPrice: resolved.unitPrice,
      catalogPrice: resolved.catalogPrice,
      priceSource: resolved.source,
      offer: resolved.offer
        ? {
            id: resolved.offer.id,
            endsAt: resolved.offer.endsAt,
            discountType: resolved.offer.discountType,
            discountPercent: resolved.offer.discountPercent,
            note: resolved.offer.note,
          }
        : undefined,
      priceChange: change ?? undefined,
    }];
  });

  return { priceMode: mode, notes };
}

export type FollowUpReasonCode =
  | "NEVER_BOUGHT"
  | "QUIET"
  | "BALANCE"
  | "ORDER_PENDING"
  | "ORDER_REJECTED"
  | "OFFER_ENDING";

export type FollowUpReason = { code: FollowUpReasonCode; label: string; detail?: string };

/**
 * The reasons a rep should call on a customer, for one page of customers.
 *
 * Built from three extra reads for the WHOLE page, never one per customer. The
 * wording is deliberately careful: a positive balance is «عليه رصيد», not
 * «متأخر بالدفع» — nothing in this system records a due date, so calling it
 * overdue would be inventing a fact.
 */
export async function followUpReasonsFor(opts: {
  agentId: string;
  customers: Array<{ id: string; currentBalance: number; lastSaleAt: Date | null; daysSinceLastSale: number | null }>;
  quietDays: number;
  offerWarningDays?: number;
  now?: Date;
}): Promise<Map<string, FollowUpReason[]>> {
  const result = new Map<string, FollowUpReason[]>();
  if (opts.customers.length === 0) return result;
  const now = opts.now ?? new Date();
  const customerIds = opts.customers.map((c) => c.id);

  // `PendingApproval.customerId` is a real column now, which is what lets the
  // customers query itself filter on it. Rows written before that column
  // existed and never backfilled (a dangling id, say) are still matched from
  // the JSON payload here, so an old order still shows as a reason.
  const [recentOrders, endingOffers] = await Promise.all([
    prisma.pendingApproval.findMany({
      where: {
        requestedBy: opts.agentId,
        requestType: "CATALOG_ORDER",
        status: { in: ["PENDING", "REJECTED"] },
        OR: [{ customerId: { in: customerIds } }, { customerId: null }],
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, status: true, createdAt: true, customerId: true, requestData: true },
    }),
    offersEndingSoon({
      agentScope: opts.agentId,
      withinDays: opts.offerWarningDays ?? OFFER_ENDING_SOON_DAYS,
      customerIds,
      now,
    }),
  ]);

  const orderByCustomer = new Map<string, { status: string; createdAt: Date }>();
  for (const order of recentOrders) {
    const data = (order.requestData ?? {}) as { customerId?: unknown };
    const id = order.customerId ?? (typeof data.customerId === "string" ? data.customerId : null);
    if (!id || !customerIds.includes(id)) continue;
    // Newest first from the query, so the first one seen is the one to report.
    if (!orderByCustomer.has(id)) orderByCustomer.set(id, { status: order.status, createdAt: order.createdAt });
  }

  const day = 86_400_000;
  for (const customer of opts.customers) {
    const reasons: FollowUpReason[] = [];
    if (customer.lastSaleAt === null) {
      reasons.push({ code: "NEVER_BOUGHT", label: "ما اشترى ولا مرة" });
    } else if ((customer.daysSinceLastSale ?? 0) >= opts.quietDays) {
      reasons.push({
        code: "QUIET",
        label: "ما اشترى من مدة",
        detail: `آخر شراء قبل ${customer.daysSinceLastSale} يوم`,
      });
    }
    if (customer.currentBalance > 0) {
      // NOT «متأخر»: no due date is recorded anywhere in this system.
      reasons.push({ code: "BALANCE", label: "عليه رصيد" });
    }
    const order = orderByCustomer.get(customer.id);
    if (order?.status === "PENDING") {
      reasons.push({ code: "ORDER_PENDING", label: "عنده طلب بانتظار الموافقة" });
    } else if (order?.status === "REJECTED") {
      reasons.push({ code: "ORDER_REJECTED", label: "عنده طلب مرفوض يحتاج معالجة" });
    }
    const offer = endingOffers.get(customer.id);
    if (offer) {
      const days = Math.max(0, Math.ceil((offer.firstEndsAt.getTime() - now.getTime()) / day));
      reasons.push({
        code: "OFFER_ENDING",
        label: "عنده عرض خاص قرب ينتهي",
        detail: days <= 1 ? "ينتهي اليوم أو باچر" : `ينتهي بعد ${days} يوم`,
      });
    }
    if (reasons.length > 0) result.set(customer.id, reasons);
  }

  return result;
}
