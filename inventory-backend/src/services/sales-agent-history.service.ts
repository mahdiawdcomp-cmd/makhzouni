/**
 * What this customer actually bought, read from real invoices.
 *
 * Two screens need the same source of truth, so it lives here once:
 *  - «يشتريها عادةً» — the products worth offering again, with a suggested
 *    quantity taken from the average of the last three purchases.
 *  - «تغيّر السعر» — what they paid last time, to compare against today.
 *
 * ── What counts as a purchase ───────────────────────────────────────────
 *
 * An ACTIVE, non-archived SALE invoice. Drafts, abandoned carts, pending
 * approvals and cancelled or archived invoices are not purchases.
 *
 * Returns are netted PER ITEM, not per invoice. The first version excluded a
 * whole invoice as soon as anything on it came back, so returning one item out
 * of ten made all ten vanish from «يشتريها عادةً» and from the price note. Now:
 *
 *  - a line with part of it returned stays a purchase, at the NET quantity;
 *  - a line returned in full is not a purchase;
 *  - the other lines of the same invoice are untouched;
 *  - a cancelled or archived return does not count as a return at all;
 *  - several returns against one invoice are summed.
 *
 * ── The one case we refuse to guess ─────────────────────────────────────
 *
 * A return recorded in a DIFFERENT unit from the sale line (a carton returned
 * against a line sold by the dozen) cannot be netted without knowing the
 * carton/box size AS IT WAS on the invoice date. `InvoiceItem` snapshots the
 * name, unit, price and cost — not `pcsPerCarton` — and today's value may have
 * been edited since. So that product on that invoice is dropped instead of
 * being netted with a number we invented. It is a rare shape, and the honest
 * outcome is «no history for this line», never a wrong quantity.
 *
 * Both queries are raw SQL on purpose: each answers in ONE round trip with the
 * aggregate, the netting and the newest row together, which Prisma's `groupBy`
 * cannot do across the invoice relation. The alternative was shipping a
 * customer's invoice history to the browser and folding it there.
 *
 * `$queryRawUnsafe` is used only to splice in the SQL constants defined in this
 * file. Every value that comes from a caller is a bound parameter (`$1`, `$2`,
 * …) and never concatenated into the statement.
 */
import { Unit } from "@prisma/client";
import prisma from "../config/database";

/**
 * Sale lines for one customer, netted against their returns.
 *
 * `$1` is the customer id. Aggregated per (invoice, product, unit) first: one
 * invoice can carry the same product twice in the same unit, and subtracting
 * the return from each line separately would double-count it.
 */
const NETTED_SALE_LINES_SQL = `
  WITH sale_lines AS (
    SELECT
      i."id"                                                  AS invoice_id,
      i."date"                                                AS date,
      i."price_mode"                                          AS price_mode,
      ii."product_id"                                         AS product_id,
      ii."unit"                                               AS unit,
      SUM(ii."quantity")::int                                 AS sold_qty,
      (array_agg(ii."unit_price" ORDER BY ii."id" DESC))[1]   AS unit_price
    FROM "invoices" i
    JOIN "invoice_items" ii ON ii."invoice_id" = i."id"
    WHERE i."customer_id" = $1::uuid
      AND i."type" = 'SALE'
      AND i."status" = 'ACTIVE'
      AND i."archived_at" IS NULL
    GROUP BY i."id", i."date", i."price_mode", ii."product_id", ii."unit"
  ),
  returned AS (
    SELECT
      r."original_invoice_id"  AS invoice_id,
      ri."product_id"          AS product_id,
      ri."unit"                AS unit,
      SUM(ri."quantity")::int  AS returned_qty
    FROM "invoices" r
    JOIN "invoice_items" ri ON ri."invoice_id" = r."id"
    WHERE r."type" = 'SALES_RETURN'
      AND r."status" = 'ACTIVE'
      AND r."archived_at" IS NULL
      AND r."original_invoice_id" IN (SELECT invoice_id FROM sale_lines)
    GROUP BY 1, 2, 3
  ),
  netted AS (
    SELECT
      sl.*,
      GREATEST(sl.sold_qty - COALESCE(rt.returned_qty, 0), 0) AS net_qty,
      EXISTS (
        SELECT 1 FROM returned amb
        WHERE amb.invoice_id = sl.invoice_id
          AND amb.product_id = sl.product_id
          AND amb.unit <> sl.unit
      ) AS unit_mismatch
    FROM sale_lines sl
    LEFT JOIN returned rt
      ON rt.invoice_id = sl.invoice_id
     AND rt.product_id = sl.product_id
     AND rt.unit = sl.unit
  ),
  valid AS (
    SELECT * FROM netted WHERE net_qty > 0 AND NOT unit_mismatch
  )
`;

/** How many recent purchases the suggested quantity averages over. */
export const SUGGESTION_WINDOW = 3;

export type FrequentPurchaseRow = {
  productId: string;
  unit: Unit;
  /** How many valid invoices contained this product in this unit. */
  times: number;
  /** Net quantity across those invoices, in that unit. */
  totalQuantity: number;
  /**
   * Average NET quantity over the last `SUGGESTION_WINDOW` purchases —
   * restricted to the current price basis when the customer has bought in it,
   * otherwise across all baskets. Not rounded here: the caller rounds once,
   * after capping by stock.
   */
  averageQuantity: number;
  /** How many purchases that average is actually built from (1, 2 or 3). */
  averageSampleSize: number;
  /** True when the average came from purchases in the requested price basis. */
  averageMatchesPriceMode: boolean;
  lastPurchaseAt: Date;
  /** The price mode of the most recent purchase, for a like-for-like compare. */
  lastPriceMode: string;
};

type RawFrequentRow = {
  product_id: string;
  unit: Unit;
  times: bigint | number;
  total_quantity: bigint | number;
  avg_qty_mode: string | number | null;
  mode_samples: bigint | number;
  avg_qty_any: string | number | null;
  any_samples: bigint | number;
  last_purchase_at: Date;
  last_price_mode: string;
};

/**
 * The products this customer buys, most-bought and most-recent first.
 *
 * Ranked by frequency first and recency second: a product bought on eight of the
 * last ten visits belongs above one bought once yesterday. `lookbackDays` keeps
 * a customer's ancient history from crowding out what they buy now.
 */
export async function frequentPurchases(opts: {
  customerId: string;
  priceMode: string;
  lookbackDays?: number;
  limit?: number;
}): Promise<FrequentPurchaseRow[]> {
  const lookbackDays = Math.min(Math.max(1, opts.lookbackDays ?? 365), 3650);
  const limit = Math.min(Math.max(1, opts.limit ?? 40), 200);

  const rows = await prisma.$queryRawUnsafe<RawFrequentRow[]>(
    `
    ${NETTED_SALE_LINES_SQL},
    recent AS (
      SELECT v.*,
        ROW_NUMBER() OVER (
          PARTITION BY v.product_id, v.unit ORDER BY v.date DESC, v.invoice_id DESC
        ) AS any_rank,
        ROW_NUMBER() OVER (
          PARTITION BY v.product_id, v.unit, v.price_mode ORDER BY v.date DESC, v.invoice_id DESC
        ) AS mode_rank
      FROM valid v
      WHERE v.date >= NOW() - ($2 || ' days')::interval
    )
    SELECT
      product_id,
      unit,
      COUNT(*)::bigint                                                             AS times,
      SUM(net_qty)::bigint                                                        AS total_quantity,
      AVG(net_qty) FILTER (WHERE price_mode = $4 AND mode_rank <= $5)              AS avg_qty_mode,
      COUNT(*) FILTER (WHERE price_mode = $4 AND mode_rank <= $5)::bigint          AS mode_samples,
      AVG(net_qty) FILTER (WHERE any_rank <= $5)                                   AS avg_qty_any,
      COUNT(*) FILTER (WHERE any_rank <= $5)::bigint                               AS any_samples,
      MAX(date)                                                                    AS last_purchase_at,
      MAX(price_mode) FILTER (WHERE any_rank = 1)                                  AS last_price_mode
    FROM recent
    GROUP BY product_id, unit
    ORDER BY times DESC, last_purchase_at DESC
    LIMIT $3
    `,
    opts.customerId,
    String(lookbackDays),
    limit,
    opts.priceMode,
    SUGGESTION_WINDOW,
  );

  return rows.map((row) => {
    const modeSamples = Number(row.mode_samples);
    const useMode = modeSamples > 0 && row.avg_qty_mode != null;
    return {
      productId: row.product_id,
      unit: row.unit,
      times: Number(row.times),
      totalQuantity: Number(row.total_quantity),
      averageQuantity: Number(useMode ? row.avg_qty_mode : (row.avg_qty_any ?? 0)),
      averageSampleSize: useMode ? modeSamples : Number(row.any_samples),
      averageMatchesPriceMode: useMode,
      lastPurchaseAt: row.last_purchase_at,
      lastPriceMode: row.last_price_mode,
    };
  });
}

export type LastPaidPrice = {
  productId: string;
  unit: Unit;
  unitPrice: number;
  /** NET quantity on that purchase, after returns. */
  quantity: number;
  date: Date;
  /** WHOLESALE / RETAIL / CARTON as recorded on that invoice. */
  priceMode: string;
};

/**
 * What this customer last actually paid, per product and unit — the most recent
 * purchase that still has a positive quantity left after returns.
 *
 * `priceMode` is returned rather than filtered on, because history predates the
 * carton/distribution split: rows written before it exist with WHOLESALE on
 * them. The comparison decides for itself whether the old row is comparable, so
 * a mode mismatch shows as «لا يوجد سعر سابق مطابق» instead of a made-up
 * difference between two different price bases.
 */
export async function lastPaidPrices(opts: {
  customerId: string;
  productIds: string[];
}): Promise<Map<string, LastPaidPrice>> {
  const result = new Map<string, LastPaidPrice>();
  if (opts.productIds.length === 0) return result;

  const rows = await prisma.$queryRawUnsafe<
    { product_id: string; unit: Unit; unit_price: unknown; net_qty: number; date: Date; price_mode: string }[]
  >(
    `
    ${NETTED_SALE_LINES_SQL}
    SELECT DISTINCT ON (v.product_id, v.unit)
      v.product_id, v.unit, v.unit_price, v.net_qty, v.date, v.price_mode
    FROM valid v
    WHERE v.product_id = ANY($2::uuid[])
    ORDER BY v.product_id, v.unit, v.date DESC, v.invoice_id DESC
    `,
    opts.customerId,
    opts.productIds,
  );

  for (const row of rows) {
    result.set(`${row.product_id}:${row.unit}`, {
      productId: row.product_id,
      unit: row.unit,
      unitPrice: Number(row.unit_price),
      quantity: Number(row.net_qty),
      date: row.date,
      priceMode: row.price_mode,
    });
  }
  return result;
}

export type PriceChange = {
  previousPrice: number;
  currentPrice: number;
  /** Positive = dearer than last time. */
  difference: number;
  /** Percent of the previous price, rounded to one decimal. */
  percent: number;
  direction: "UP" | "DOWN";
  lastPurchaseAt: Date;
};

/**
 * Compare today's price with the last one this customer actually paid.
 *
 * Returns null when there is nothing honest to say: no previous purchase, a
 * previous purchase recorded under a different price basis, or an unusable old
 * number. This is information only — no caller may block a sale on it.
 */
export function priceChangeFor(
  previous: LastPaidPrice | undefined,
  currentPrice: number,
  currentPriceMode: string,
): PriceChange | null {
  if (!previous) return null;
  // Comparing a wholesale price against a carton-distribution price is comparing
  // two different things; the screen says "no comparable previous price".
  if (previous.priceMode !== currentPriceMode) return null;
  const prev = previous.unitPrice;
  if (!Number.isFinite(prev) || prev <= 0) return null;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  const difference = Math.round((currentPrice - prev) * 100) / 100;
  if (difference === 0) return null;
  return {
    previousPrice: prev,
    currentPrice,
    difference,
    percent: Math.round((difference / prev) * 1000) / 10,
    direction: difference > 0 ? "UP" : "DOWN",
    lastPurchaseAt: previous.date,
  };
}
