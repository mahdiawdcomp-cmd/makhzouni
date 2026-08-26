/* ══════════════════════════════════════════════════════════════════════
   «عروض القائمة» — what an order earns by being big enough.

   A ladder of thresholds on the order subtotal. Reaching one grants free
   delivery, a percentage off, or both; a bigger order simply reaches a
   higher rung. The shop sets the ladder, so a tenant that wants one rung,
   five rungs, or none at all is the same code path.

   Deliberately NOT per-product tiered pricing: the merchant's rule is about
   the whole basket ("وصلت مليون ونص… صارت قائمته مليونين ونص"), and pricing
   each product by quantity would answer a different question.
══════════════════════════════════════════════════════════════════════ */

export type OrderTier = {
  /** Subtotal, in dinars, at which this rung is reached. */
  minTotal: number;
  freeDelivery: boolean;
  /** 0 means the rung grants delivery only. */
  discountPercent: number;
};

export const DEFAULT_ORDER_TIERS: OrderTier[] = [
  { minTotal: 1_500_000, freeDelivery: true, discountPercent: 0 },
  { minTotal: 2_500_000, freeDelivery: true, discountPercent: 5 },
];

/**
 * Clean, ordered rungs. Junk from settings is dropped rather than trusted:
 * a tier with no threshold or a negative percent would otherwise hand out a
 * discount nobody configured.
 */
export function normalizeOrderTiers(tiers: unknown): OrderTier[] {
  if (!Array.isArray(tiers)) return [];
  return tiers
    .map((t) => {
      const row = t as Partial<OrderTier>;
      const minTotal = Math.max(0, Math.round(Number(row?.minTotal) || 0));
      const discountPercent = Math.min(100, Math.max(0, Number(row?.discountPercent) || 0));
      return { minTotal, freeDelivery: row?.freeDelivery === true, discountPercent };
    })
    .filter((t) => t.minTotal > 0 && (t.freeDelivery || t.discountPercent > 0))
    .sort((a, b) => a.minTotal - b.minTotal);
}

export type TierProgress = {
  /** The best rung this subtotal has earned, or null below the first one. */
  reached: OrderTier | null;
  /** The next rung up, or null once the top is reached. */
  next: OrderTier | null;
  /** Dinars still needed for `next`; 0 when there is no next. */
  remaining: number;
  freeDelivery: boolean;
  discountPercent: number;
  /** Dinars off, rounded — what actually lands on the invoice. */
  discountAmount: number;
};

/**
 * What this subtotal has earned, and what one more carton would earn.
 *
 * Benefits are taken from the single highest rung reached rather than summed
 * across rungs: the ladder describes one offer per level, and adding them up
 * would quietly give a 2.5M order the 1.5M discount as well.
 */
export function resolveOrderTier(subtotal: number, tiers: OrderTier[]): TierProgress {
  const total = Math.max(0, Number(subtotal) || 0);
  const ladder = normalizeOrderTiers(tiers);

  let reached: OrderTier | null = null;
  let next: OrderTier | null = null;
  for (const tier of ladder) {
    if (total >= tier.minTotal) reached = tier;
    else { next = tier; break; }
  }

  const discountPercent = reached?.discountPercent ?? 0;
  return {
    reached,
    next,
    remaining: next ? Math.max(0, next.minTotal - total) : 0,
    freeDelivery: reached?.freeDelivery ?? false,
    discountPercent,
    discountAmount: Math.round(total * (discountPercent / 100)),
  };
}

/**
 * Was this order close enough to the next rung to be worth a word about it?
 *
 * "Close" is a share of the gap, not a fixed number of dinars: on a ladder
 * whose rungs are a million apart, 200,000 short is nearly there, while on one
 * with rungs 300,000 apart the same figure means they were not really trying.
 *
 * Orders that already reached the top earn nothing to say, and an order that
 * was never near the first rung is not a near miss — it is a small order, and
 * telling someone they "almost" earned something they were nowhere near reads
 * as a sales pitch rather than a favour.
 */
export function nearMiss(
  subtotal: number,
  tiers: OrderTier[],
  withinPercent = 20,
): { next: OrderTier; remaining: number } | null {
  const progress = resolveOrderTier(subtotal, tiers);
  if (!progress.next) return null;

  const share = Math.min(100, Math.max(1, Number(withinPercent) || 20)) / 100;
  const window = progress.next.minTotal * share;
  if (progress.remaining <= 0 || progress.remaining > window) return null;

  return { next: progress.next, remaining: progress.remaining };
}
