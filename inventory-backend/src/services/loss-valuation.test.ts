/**
 * Damaged-goods / loss valuation (feeds netProfit in getProfitReport) must use
 * the accounting cost: costPrice first, purchasePrice as fallback — NOT the raw
 * purchasePrice (which now means "last purchase price").
 */

import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

// getProfitReport touches the DB; we only import the pure helper, but the module
// pulls in ../config/database at load — stub it so the import resolves cleanly.
mock.module("../config/database", { exports: { default: {} } });

let accountingUnitCost: (p: { costPrice: any; purchasePrice: any }) => number;

describe("loss/damaged valuation uses costPrice first, purchasePrice fallback", () => {
  before(async () => {
    ({ accountingUnitCost } = await import("./report.service"));
  });

  it("5 damaged @ costPrice 250 (not purchasePrice 300) → 1250", () => {
    const unitCost = accountingUnitCost({ costPrice: 250, purchasePrice: 300 });
    assert.equal(unitCost, 250, "uses costPrice");
    assert.equal(5 * unitCost, 1250, "5 × 250 — NOT 5 × 300");
  });

  it("falls back to purchasePrice when costPrice is 0", () => {
    const unitCost = accountingUnitCost({ costPrice: 0, purchasePrice: 300 });
    assert.equal(unitCost, 300, "fallback to purchasePrice");
    assert.equal(5 * unitCost, 1500);
  });
});
