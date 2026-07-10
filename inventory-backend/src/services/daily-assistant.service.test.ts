/**
 * «المساعد الذكي اليومي» (Daily Smart Assistant) — pure-logic unit tests.
 *
 * These exercise the REAL exported decision kernels of daily-assistant.service
 * (not mirrors), plus the shared profit/permission helpers they reuse, using
 * in-memory fixtures only. Nothing here touches the database.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSISTANT_CONFIG,
  aggregateByProduct,
  bucketStopped,
  buildSuggestions,
  classifyNewCustomers,
  dayKeyInTz,
  detectSpikeForProduct,
  frozenCapitalValue,
  hasValidCost,
  isProductOldEnoughToSleep,
  isSleeping,
  marginPercent,
  pairsFromInvoices,
  reorderForProduct,
  zonedDayRange,
} from "./daily-assistant.service";
import { canViewProfitReports } from "../middleware/permission.middleware";

// ── Fixture factory for a profit-shaped invoice item ──────────────────────────
function item(opts: {
  productId: string; name: string; unit?: "PIECE" | "CARTON" | "DOZEN" | "BOX";
  quantity: number; totalPrice: number; costPrice?: number;
  productCost?: number; purchasePrice?: number; pcsPerCarton?: number;
  subtotal?: number; totalAmount?: number;
}): any {
  const subtotal = opts.subtotal ?? opts.totalPrice;
  return {
    productId: opts.productId,
    productName: opts.name,
    unit: opts.unit ?? "PIECE",
    quantity: opts.quantity,
    totalPrice: opts.totalPrice,
    costPrice: opts.costPrice ?? 0,
    product: {
      costPrice: opts.productCost ?? 0,
      purchasePrice: opts.purchasePrice ?? 0,
      pcsPerCarton: opts.pcsPerCarton ?? 1,
      boxPieces: null,
    },
    invoice: { subtotal, totalAmount: opts.totalAmount ?? subtotal, date: new Date() },
  };
}

// ── #2 SALES_RETURN handling + #3 profit = revenue − cost ─────────────────────
test("aggregate: SALES_RETURN subtracts from revenue/pieces/cost", () => {
  const sales = [item({ productId: "p1", name: "A", quantity: 10, totalPrice: 1000, productCost: 40 })];
  const returns = [item({ productId: "p1", name: "A", quantity: 3, totalPrice: 300, productCost: 40 })];
  const agg = aggregateByProduct(sales, returns).get("p1")!;
  assert.equal(agg.pieces, 7);            // 10 − 3
  assert.equal(agg.revenue, 700);         // 1000 − 300
  assert.equal(agg.cost, 40 * 7);         // net 7 pcs × 40
  assert.equal(Math.round(agg.revenue - agg.cost), 420);
});

// ── #5 top selling uses unified pieces (carton → pcs) ─────────────────────────
test("aggregate: CARTON quantity converts to pieces via pcsPerCarton", () => {
  const agg = aggregateByProduct(
    [item({ productId: "p1", name: "A", unit: "CARTON", quantity: 2, totalPrice: 500, pcsPerCarton: 12, productCost: 10 })],
    [],
  ).get("p1")!;
  assert.equal(agg.pieces, 24);
});

// ── #6 low margin incl. negative profit + missing cost exclusion ──────────────
test("marginPercent: negative when cost exceeds revenue", () => {
  assert.equal(marginPercent(1000, 1200), -20);
  assert.equal(marginPercent(0, 100), null); // no revenue → undefined margin
});

test("hasValidCost: false only when every cost source is zero", () => {
  assert.equal(hasValidCost({ costPrice: 0, purchasePrice: 0 }), false);
  assert.equal(hasValidCost({ costPrice: 0, purchasePrice: 5 }), true);
  assert.equal(hasValidCost({ costPrice: 3, purchasePrice: 0 }), true);
});

// ── #4 new customer = first-ever SALE today, excluding suppliers/prior buyers ──
test("classifyNewCustomers: excludes prior buyers and non-eligible", () => {
  const today = ["c1", "c2", "c3"];
  const prior = new Set(["c2"]);           // c2 bought before → not new
  const eligible = new Set(["c1", "c2"]);  // c3 is supplier/deleted → excluded
  assert.deepEqual(classifyNewCustomers(today, prior, eligible), ["c1"]);
});

// ── #7 last real sale + #8 new product excluded from sleeping ─────────────────
test("isSleeping: product with stock and no sale ever is sleeping", () => {
  const cutoff = new Date("2026-05-11");
  assert.equal(isSleeping(20, null, cutoff), true);               // never sold
  assert.equal(isSleeping(20, new Date("2026-01-01"), cutoff), true);  // old sale
  assert.equal(isSleeping(20, new Date("2026-06-01"), cutoff), false); // recent sale
  assert.equal(isSleeping(0, null, cutoff), false);              // no stock
});

test("isProductOldEnoughToSleep: younger-than-window product is skipped", () => {
  const cutoff = new Date("2026-05-11");
  assert.equal(isProductOldEnoughToSleep(new Date("2026-06-20"), cutoff), false);
  assert.equal(isProductOldEnoughToSleep(new Date("2026-01-01"), cutoff), true);
});

// ── #9 frozen capital uses accounting cost (costPrice → purchasePrice) ────────
test("frozenCapitalValue: costPrice preferred, else purchasePrice", () => {
  assert.equal(frozenCapitalValue(10, { costPrice: 40, purchasePrice: 50 }), 400);
  assert.equal(frozenCapitalValue(10, { costPrice: 0, purchasePrice: 50 }), 500);
});

// ── #10 sell rate/days left + #11 carton rounding ─────────────────────────────
test("reorderForProduct: computes rate, days-left and carton rounding", () => {
  // 60 pcs sold over 30d → 2/day; stock 5 → 2.5 days left → urgent
  const r = reorderForProduct({
    productId: "p1", name: "A", itemNumber: "100",
    netSoldPieces: 60, stock: 5, minStock: 3, pcsPerCarton: 12,
  })!;
  assert.equal(r.dailyRate, 2);
  assert.equal(r.daysLeft, 2);                 // floor(5/2)
  assert.equal(r.suggestedPieces, 55);         // ceil(2*30 − 5)
  assert.equal(r.suggestedCartons, 5);         // ceil(55/12)
});

test("reorderForProduct: no demand → null (never guesses)", () => {
  assert.equal(reorderForProduct({ productId: "p", name: "A", itemNumber: "1", netSoldPieces: 0, stock: 0, minStock: 5, pcsPerCarton: 1 }), null);
});

test("reorderForProduct: well-stocked & above min → null", () => {
  assert.equal(reorderForProduct({ productId: "p", name: "A", itemNumber: "1", netSoldPieces: 30, stock: 500, minStock: 5, pcsPerCarton: 1 }), null);
});

// ── #12 spike detection + false-positive guards ───────────────────────────────
test("detectSpikeForProduct: fires when day ≥ 2× avg with enough active days", () => {
  const days = new Map<string, number>([
    ["2026-07-09", 20], // comparison day
    ["d1", 3], ["d2", 3], ["d3", 3], ["d4", 3], ["d5", 3], // 5 active base days, avg small
  ]);
  const hit = detectSpikeForProduct(days, "2026-07-09");
  assert.ok(hit);
  assert.equal(hit!.comparisonDayQty, 20);
});

test("detectSpikeForProduct: below min qty → null", () => {
  const days = new Map([["2026-07-09", 2], ["d1", 1]]);
  assert.equal(detectSpikeForProduct(days, "2026-07-09"), null);
});

test("detectSpikeForProduct: too few active base days → null (false-positive guard)", () => {
  const days = new Map([["2026-07-09", 20], ["d1", 10], ["d2", 10]]); // only 2 active days
  assert.equal(detectSpikeForProduct(days, "2026-07-09"), null);
});

// ── #13 incomplete/today day never counts as spike ────────────────────────────
test("detectSpikeForProduct: a spike on a NON-comparison day is ignored", () => {
  const days = new Map<string, number>([
    ["2026-07-09", 2],   // comparison day is quiet
    ["2026-07-10", 99],  // today's partial surge — must NOT trigger
    ["d1", 1], ["d2", 1], ["d3", 1], ["d4", 1], ["d5", 1],
  ]);
  assert.equal(detectSpikeForProduct(days, "2026-07-09"), null);
});

// ── #15 stopped 30/60 with no duplication ─────────────────────────────────────
test("bucketStopped: each customer in exactly one bucket (60+ priority)", () => {
  const cutoff30 = new Date("2026-06-10");
  const cutoff60 = new Date("2026-05-11");
  const rows = [
    { id: "a", lastTransactionAt: new Date("2026-06-01") }, // 30 bucket
    { id: "b", lastTransactionAt: new Date("2026-04-01") }, // 60 bucket
    { id: "c", lastTransactionAt: new Date("2026-07-01") }, // still active → neither
  ];
  const { stopped30, stopped60 } = bucketStopped(rows, cutoff30, cutoff60);
  assert.deepEqual(stopped30.map((r) => r.id), ["a"]);
  assert.deepEqual(stopped60.map((r) => r.id), ["b"]);
});

// ── #17 no A+B / B+A duplication + #18 no self-pair ───────────────────────────
test("pairsFromInvoices: canonical unordered pairs, no self-pairs", () => {
  const { pairCount } = pairsFromInvoices([
    ["A", "B"],
    ["B", "A"],       // same unordered pair
    ["A", "A", "B"],  // dup product within invoice collapses, no A+A
  ]);
  assert.equal(pairCount.size, 1);
  assert.equal(pairCount.get("A|B"), 3);
  assert.equal(pairCount.get("A|A"), undefined);
});

test("pairsFromInvoices: caps huge invoices to avoid combinatorial blow-up", () => {
  const many = Array.from({ length: 120 }, (_, i) => `p${i}`);
  const { cappedInvoices } = pairsFromInvoices([many], ASSISTANT_CONFIG.BASKET_MAX_ITEMS_PER_INVOICE);
  assert.equal(cappedInvoices, 1);
});

// ── #19 / #20 permission gating (profit visibility) ───────────────────────────
test("canViewProfitReports: VIEW_REPORTS grants, HIDE_PROFIT_REPORTS revokes", () => {
  assert.equal(canViewProfitReports({ permissions: ["VIEW_REPORTS"] } as any), true);
  assert.equal(canViewProfitReports({ permissions: ["VIEW_REPORTS", "HIDE_PROFIT_REPORTS"] } as any), false);
  assert.equal(canViewProfitReports({ permissions: [] } as any), false);
  assert.equal(canViewProfitReports(undefined), false);
});

// ── #23 timezone day boundaries do not slip under UTC ─────────────────────────
test("zonedDayRange: 23:30 Baghdad belongs to the same local day", () => {
  const { start, end } = zonedDayRange("2026-07-10", "Asia/Baghdad");
  // Baghdad is UTC+3 → local midnight = 21:00 UTC previous day.
  assert.equal(start.toISOString(), "2026-07-09T21:00:00.000Z");
  assert.equal(end.toISOString(), "2026-07-10T20:59:59.999Z");
  // A sale at 23:30 local (20:30 UTC) maps back to 2026-07-10.
  const lateSale = new Date("2026-07-10T20:30:00.000Z");
  assert.equal(dayKeyInTz(lateSale, "Asia/Baghdad"), "2026-07-10");
  assert.ok(lateSale >= start && lateSale <= end);
});

// ── Rule engine: 3–5 suggestions, prioritised, deduped ────────────────────────
test("buildSuggestions: caps at 5, sorts by priority, dedupes a product", () => {
  const suggestions = buildSuggestions({
    reorder: [
      { productId: "p1", name: "Urgent", daysLeft: 2, suggestedPieces: 10, suggestedCartons: 1, currentStock: 1, minStock: 5 },
    ],
    spike: [{ productId: "p1", name: "Urgent", comparisonDayQty: 9, dailyAverage: 2, risePercent: 300, comparisonDay: "2026-07-09" }],
    sleeping: [{ productId: "p9", name: "Dead", currentStock: 100, daysIdle: 90, capitalValue: 5000, itemNumber: "9", imageUrl: null, lastSaleAt: null }],
    debtors: [{ id: "c1", name: "Debtor", balance: 90000, daysLate: 45 }],
    tasks: { preparations: { count: 1 }, transfers: { count: 0 }, approvals: { count: 2 } },
    stopped60: [{ id: "c9", name: "Gone", daysStopped: 70 }],
    lowMargin: [{ productId: "p5", name: "Thin", margin: -5 }],
  });
  assert.ok(suggestions.length >= 3 && suggestions.length <= 5);
  // sorted ascending by priority
  for (let i = 1; i < suggestions.length; i++) {
    assert.ok(suggestions[i].priority >= suggestions[i - 1].priority);
  }
  // p1 (reorder-urgent) must not also appear as a spike suggestion
  const p1 = suggestions.filter((s) => s.relatedEntityId === "p1");
  assert.equal(p1.length, 1);
});
