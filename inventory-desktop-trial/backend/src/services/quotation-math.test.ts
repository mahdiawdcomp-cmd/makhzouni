/**
 * Unit tests for the quotation line-item calculation logic.
 * These mirror the roundMoney-based math in quotation.service.ts without
 * requiring a database connection.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { roundMoney } from "../utils/financial";

// ── helpers mirroring quotation.service.ts internals ─────────────────────────

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function unitPriceFor(product: { salePrice: unknown; pcsPerCarton: number }, unit: string): number {
  const price = toNumber(product.salePrice);
  if (unit === "CARTON") return roundMoney(price * product.pcsPerCarton);
  if (unit === "DOZEN") return roundMoney(price * 12);
  return roundMoney(price);
}

function buildQuotation(items: { unitPrice?: number; quantity: number; unit: string; product: { salePrice: unknown; pcsPerCarton: number } }[], discount = 0) {
  let subtotal = 0;
  const lines = items.map((item) => {
    const unitPrice = roundMoney(item.unitPrice ?? unitPriceFor(item.product, item.unit));
    const totalPrice = roundMoney(unitPrice * item.quantity);
    subtotal = roundMoney(subtotal + totalPrice);
    return { unitPrice, quantity: item.quantity, totalPrice };
  });
  const totalAmount = roundMoney(subtotal - discount);
  return { lines, subtotal, discount, totalAmount };
}

// ── toNumber ─────────────────────────────────────────────────────────────────

test("toNumber coerces Prisma Decimal strings to numbers", () => {
  assert.equal(toNumber("1250.75"), 1250.75);
  assert.equal(toNumber("0"), 0);
  assert.equal(toNumber(null), 0);
  assert.equal(toNumber(undefined), 0);
  assert.equal(toNumber(NaN), 0);
  assert.equal(toNumber(Infinity), 0);
});

// ── unitPriceFor ─────────────────────────────────────────────────────────────

test("PIECE unit returns the sale price rounded", () => {
  assert.equal(unitPriceFor({ salePrice: "500.333", pcsPerCarton: 12 }, "PIECE"), 500.33);
});

test("CARTON unit multiplies by pcsPerCarton and rounds", () => {
  assert.equal(unitPriceFor({ salePrice: "500", pcsPerCarton: 24 }, "CARTON"), 12_000);
  assert.equal(unitPriceFor({ salePrice: "333.33", pcsPerCarton: 12 }, "CARTON"), 3999.96);
});

test("DOZEN unit multiplies by 12 regardless of pcsPerCarton", () => {
  assert.equal(unitPriceFor({ salePrice: "250", pcsPerCarton: 100 }, "DOZEN"), 3_000);
});

test("unitPriceFor handles non-finite sale price gracefully", () => {
  assert.equal(unitPriceFor({ salePrice: null, pcsPerCarton: 12 }, "PIECE"), 0);
  assert.equal(unitPriceFor({ salePrice: "NaN", pcsPerCarton: 12 }, "CARTON"), 0);
});

// ── buildQuotation (line-item math) ──────────────────────────────────────────

test("single-item quotation with PIECE unit", () => {
  const q = buildQuotation([
    { quantity: 3, unit: "PIECE", product: { salePrice: "1500", pcsPerCarton: 12 } },
  ]);
  assert.equal(q.lines[0].unitPrice, 1500);
  assert.equal(q.lines[0].totalPrice, 4500);
  assert.equal(q.subtotal, 4500);
  assert.equal(q.totalAmount, 4500);
});

test("multi-item subtotal accumulates without floating-point drift", () => {
  const q = buildQuotation([
    { quantity: 10, unit: "PIECE", product: { salePrice: "0.10", pcsPerCarton: 1 } },
    { quantity: 10, unit: "PIECE", product: { salePrice: "0.20", pcsPerCarton: 1 } },
    { quantity:  5, unit: "PIECE", product: { salePrice: "0.30", pcsPerCarton: 1 } },
  ]);
  // 10*0.10 + 10*0.20 + 5*0.30 = 1.00 + 2.00 + 1.50 = 4.50
  assert.equal(q.subtotal, 4.50);
  assert.equal(q.totalAmount, 4.50);
});

test("discount is subtracted from subtotal", () => {
  const q = buildQuotation(
    [{ quantity: 2, unit: "PIECE", product: { salePrice: "50000", pcsPerCarton: 1 } }],
    5000
  );
  assert.equal(q.subtotal, 100_000);
  assert.equal(q.totalAmount, 95_000);
});

test("discount equal to subtotal gives zero totalAmount", () => {
  const q = buildQuotation(
    [{ quantity: 1, unit: "PIECE", product: { salePrice: "10000", pcsPerCarton: 1 } }],
    10_000
  );
  assert.equal(q.totalAmount, 0);
});

test("explicit unitPrice overrides the product price", () => {
  const q = buildQuotation([
    {
      unitPrice: 999,
      quantity: 2,
      unit: "PIECE",
      product: { salePrice: "1500", pcsPerCarton: 12 },
    },
  ]);
  assert.equal(q.lines[0].unitPrice, 999);
  assert.equal(q.lines[0].totalPrice, 1998);
});

test("CARTON × quantity gives correct total", () => {
  const q = buildQuotation([
    { quantity: 5, unit: "CARTON", product: { salePrice: "500", pcsPerCarton: 24 } },
  ]);
  // unitPrice = 500*24 = 12000, total = 12000*5 = 60000
  assert.equal(q.lines[0].unitPrice, 12_000);
  assert.equal(q.lines[0].totalPrice, 60_000);
  assert.equal(q.subtotal, 60_000);
});

test("large IQD amounts stay exact", () => {
  const q = buildQuotation([
    { quantity: 100, unit: "PIECE", product: { salePrice: "999999.99", pcsPerCarton: 1 } },
  ]);
  assert.equal(q.lines[0].totalPrice, 99_999_999);
  assert.equal(q.subtotal, 99_999_999);
});
