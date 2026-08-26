import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  resolveOrderTier,
  normalizeOrderTiers,
  DEFAULT_ORDER_TIERS,
  type OrderTier,
} from "./orderTiers";

const M = 1_000_000;

describe("resolveOrderTier", () => {
  const tiers = DEFAULT_ORDER_TIERS;

  test("below the first rung earns nothing but knows what is missing", () => {
    const p = resolveOrderTier(1_200_000, tiers);
    assert.equal(p.reached, null);
    assert.equal(p.freeDelivery, false);
    assert.equal(p.discountAmount, 0);
    assert.equal(p.next?.minTotal, 1_500_000);
    assert.equal(p.remaining, 300_000);
  });

  test("exactly on a rung counts as reached", () => {
    const p = resolveOrderTier(1_500_000, tiers);
    assert.equal(p.freeDelivery, true);
    assert.equal(p.discountPercent, 0);
    assert.equal(p.next?.minTotal, 2_500_000);
    assert.equal(p.remaining, 1_000_000);
  });

  test("the second rung adds the discount", () => {
    const p = resolveOrderTier(2 * M + 500_000, tiers);
    assert.equal(p.freeDelivery, true);
    assert.equal(p.discountPercent, 5);
    assert.equal(p.discountAmount, 125_000);
    assert.equal(p.next, null);
    assert.equal(p.remaining, 0);
  });

  // The rungs are levels, not a running total — a 2.5M order gets 5%, never
  // 5% plus whatever the rung below it granted.
  test("benefits come from the highest rung only, never summed", () => {
    const ladder: OrderTier[] = [
      { minTotal: 1 * M, freeDelivery: true, discountPercent: 3 },
      { minTotal: 2 * M, freeDelivery: true, discountPercent: 5 },
    ];
    const p = resolveOrderTier(2 * M, ladder);
    assert.equal(p.discountPercent, 5);
    assert.equal(p.discountAmount, 100_000);
  });

  test("an empty ladder grants nothing and promises nothing", () => {
    const p = resolveOrderTier(9 * M, []);
    assert.equal(p.reached, null);
    assert.equal(p.next, null);
    assert.equal(p.remaining, 0);
    assert.equal(p.discountAmount, 0);
  });

  test("an unsorted ladder still resolves by value", () => {
    const ladder: OrderTier[] = [
      { minTotal: 2 * M, freeDelivery: true, discountPercent: 5 },
      { minTotal: 1 * M, freeDelivery: true, discountPercent: 0 },
    ];
    assert.equal(resolveOrderTier(1_200_000, ladder).discountPercent, 0);
    assert.equal(resolveOrderTier(2 * M, ladder).discountPercent, 5);
  });

  test("an empty cart is below everything", () => {
    const p = resolveOrderTier(0, tiers);
    assert.equal(p.reached, null);
    assert.equal(p.remaining, 1_500_000);
  });

  test("rounds the discount to whole dinars", () => {
    const ladder: OrderTier[] = [{ minTotal: 1, freeDelivery: false, discountPercent: 5 }];
    assert.equal(resolveOrderTier(1_000_001, ladder).discountAmount, 50_000);
  });
});

describe("normalizeOrderTiers", () => {
  test("drops rungs that grant nothing", () => {
    const out = normalizeOrderTiers([{ minTotal: 1 * M, freeDelivery: false, discountPercent: 0 }]);
    assert.equal(out.length, 0);
  });

  test("drops rungs with no threshold", () => {
    const out = normalizeOrderTiers([{ minTotal: 0, freeDelivery: true, discountPercent: 5 }]);
    assert.equal(out.length, 0);
  });

  test("clamps a nonsense percent instead of trusting it", () => {
    const out = normalizeOrderTiers([{ minTotal: 1 * M, freeDelivery: false, discountPercent: 900 }]);
    assert.equal(out[0].discountPercent, 100);
    const neg = normalizeOrderTiers([{ minTotal: 1 * M, freeDelivery: true, discountPercent: -5 }]);
    assert.equal(neg[0].discountPercent, 0);
  });

  test("survives junk from settings", () => {
    assert.deepEqual(normalizeOrderTiers(null), []);
    assert.deepEqual(normalizeOrderTiers("nope"), []);
    assert.deepEqual(normalizeOrderTiers([{}, { minTotal: "x" }]), []);
  });

  test("sorts the ladder by threshold", () => {
    const out = normalizeOrderTiers([
      { minTotal: 3 * M, freeDelivery: true, discountPercent: 0 },
      { minTotal: 1 * M, freeDelivery: true, discountPercent: 0 },
    ]);
    assert.deepEqual(out.map((t) => t.minTotal), [1 * M, 3 * M]);
  });
});

/* The invoice applies the coupon and the earned tier together; these guard the
   arithmetic the two of them share. */
describe("a tier discount alongside a coupon", () => {
  const M = 1_000_000;

  test("the tier is a plain amount the invoice can add to a coupon", () => {
    const p = resolveOrderTier(2 * M, [
      { minTotal: 2 * M, freeDelivery: true, discountPercent: 5 },
    ]);
    // 100,000 off, and a 10% coupon on the same order is another 200,000 —
    // 300,000 total, which is still well inside the subtotal.
    assert.equal(p.discountAmount, 100_000);
    assert.ok(p.discountAmount + 0.1 * 2 * M < 2 * M);
  });

  test("even a 100% rung cannot exceed the subtotal on its own", () => {
    const p = resolveOrderTier(2 * M, [
      { minTotal: 1, freeDelivery: false, discountPercent: 100 },
    ]);
    assert.equal(p.discountAmount, 2 * M);
  });
});
