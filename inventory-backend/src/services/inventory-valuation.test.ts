/**
 * Inventory valuation must value stock at the ACCOUNTING cost:
 *   unitCost = costPrice > 0 ? costPrice : purchasePrice
 * (same rule as branch.service.ts). purchasePrice now means "last purchase
 * price" and must NOT drive the valuation total.
 */

import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

// ── Fake DB: getInventoryValuationReport only reads prisma.product.findMany ────
const products: any[] = [];
const fakePrisma = {
  product: {
    findMany: async () => products.map((p) => ({ ...p })),
  },
};
mock.module("../config/database", { exports: { default: fakePrisma } });

let getInventoryValuationReport: Function;

describe("inventory valuation uses costPrice first, purchasePrice as fallback", () => {
  before(async () => {
    ({ getInventoryValuationReport } = await import("./report.service"));
  });

  it("values 20 pcs @ costPrice 250 (not purchasePrice 300) → 5000", async () => {
    products.length = 0;
    products.push({
      id: "p1", itemNumber: "AB0001", name: "ماء", category: null,
      // currentStock = openingBalancePcs + cartonsAvailable × pcsPerCarton = 20
      openingBalancePcs: 20, cartonsAvailable: 0, pcsPerCarton: 1,
      costPrice: 250, purchasePrice: 300, salePrice: 400,
    });

    const report = await getInventoryValuationReport();
    const row = report.products[0];
    assert.equal(row.currentStock, 20);
    assert.equal(row.costPrice, 250, "unit cost used = costPrice");
    assert.equal(row.purchaseValue, 5000, "20 × 250 — NOT 20 × 300");
    assert.equal(report.totals.purchaseValue, 5000);
  });

  it("falls back to purchasePrice when costPrice is 0", async () => {
    products.length = 0;
    products.push({
      id: "p2", itemNumber: "AB0002", name: "علبة", category: null,
      openingBalancePcs: 10, cartonsAvailable: 0, pcsPerCarton: 1,
      costPrice: 0, purchasePrice: 300, salePrice: 500,
    });

    const report = await getInventoryValuationReport();
    const row = report.products[0];
    assert.equal(row.costPrice, 300, "fallback to purchasePrice");
    assert.equal(row.purchaseValue, 3000, "10 × 300 fallback");
  });
});
