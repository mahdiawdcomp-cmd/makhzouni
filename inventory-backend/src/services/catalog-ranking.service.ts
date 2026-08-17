import prisma from "../config/database";

/* ══════════════════════════════════════════════════════════════════════
   Catalog ranking signals — how many of each product actually sold, and
   how it was rated. Feeds the "الأكثر مبيعاً" / "الأعلى تقييماً" sort
   options; both are computed for the whole grid in two grouped queries
   rather than per product.
══════════════════════════════════════════════════════════════════════ */

/** Only count sales from the recent past: a product that sold well two years
 *  ago is not what a shopper means by "best selling" today. */
const SOLD_WINDOW_DAYS = 90;

export type RankingSignals = {
  soldByProduct: Map<string, number>;
  ratingByProduct: Map<string, { average: number; count: number }>;
};

export async function getCatalogRankingSignals(): Promise<RankingSignals> {
  const since = new Date(Date.now() - SOLD_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [sold, ratings] = await Promise.all([
    // Units sold. CANCELLED invoices are excluded, and so are returns — a
    // returned line should not keep inflating the product's rank.
    prisma.invoiceItem.groupBy({
      by: ["productId"],
      where: {
        invoice: { type: "SALE", status: "ACTIVE", createdAt: { gte: since } },
      },
      _sum: { quantity: true },
    }),
    prisma.catalogProductReview.groupBy({
      by: ["productId"],
      where: { status: "APPROVED" },
      _avg: { rating: true },
      _count: { rating: true },
    }),
  ]);

  const soldByProduct = new Map<string, number>();
  for (const row of sold) soldByProduct.set(row.productId, row._sum.quantity ?? 0);

  const ratingByProduct = new Map<string, { average: number; count: number }>();
  for (const row of ratings) {
    ratingByProduct.set(row.productId, {
      average: Math.round((row._avg.rating ?? 0) * 10) / 10,
      count: row._count.rating,
    });
  }

  return { soldByProduct, ratingByProduct };
}

/** Attach the signals to a mapped catalog product row. */
export function withRanking<T extends { id: string }>(product: T, signals: RankingSignals) {
  const rating = signals.ratingByProduct.get(product.id);
  return {
    ...product,
    soldCount: signals.soldByProduct.get(product.id) ?? 0,
    ratingAvg: rating?.average ?? null,
    ratingCount: rating?.count ?? 0,
  };
}
