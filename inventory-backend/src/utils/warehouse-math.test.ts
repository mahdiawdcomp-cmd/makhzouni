import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { amountInPieces } from "./financial";
import {
  distributionTotal,
  requestExceedsStock,
  validateDistribution,
} from "./warehouse-math";

// These tests cover the warehouse decision-rules that drive product creation,
// transfers, and sales. The DB-moving orchestration itself was verified live
// on production (distribute 20/80 → transfer 30 → 50/50; sale blocked when
// المحل is empty); here we lock the pure rules those flows depend on.

// ── 1. Create product with a VALID distribution ──────────────────────────────
describe("product opening-stock distribution", () => {
  it("accepts a distribution whose sum equals the total quantity", () => {
    const entries = [
      { warehouseId: "shop", pieces: 20 },
      { warehouseId: "abbasiya", pieces: 80 },
    ];
    const result = validateDistribution(entries, 100);
    assert.equal(distributionTotal(result), 100);
    assert.equal(result.length, 2);
  });

  it("drops zero/negative entries but still validates the positive sum", () => {
    const entries = [
      { warehouseId: "shop", pieces: 100 },
      { warehouseId: "abbasiya", pieces: 0 },
    ];
    const result = validateDistribution(entries, 100);
    assert.equal(result.length, 1);
    assert.equal(result[0].warehouseId, "shop");
  });

  // ── 2. Reject a distribution that does NOT equal the total ──────────────────
  it("rejects a distribution whose sum is less than the total", () => {
    assert.throws(
      () => validateDistribution([{ warehouseId: "shop", pieces: 50 }], 100),
      /DISTRIBUTION_MISMATCH|التوزيع/
    );
  });

  it("rejects a distribution whose sum is more than the total", () => {
    assert.throws(
      () => validateDistribution(
        [{ warehouseId: "shop", pieces: 60 }, { warehouseId: "abbasiya", pieces: 60 }],
        100
      ),
      /DISTRIBUTION_MISMATCH|التوزيع/
    );
  });
});

// ── unit → pieces conversion (used by transfer + sale stock math) ────────────
describe("unit to pieces conversion", () => {
  it("converts cartons using pcsPerCarton, dozens by 12, pieces as-is", () => {
    assert.equal(amountInPieces("CARTON", 1, 240), 240);
    assert.equal(amountInPieces("CARTON", 2, 240), 480);
    assert.equal(amountInPieces("DOZEN", 1, 240), 12);
    assert.equal(amountInPieces("PIECE", 7, 240), 7);
  });
});

// ── 3 & 6. Over-stock detection (transfer warning + sale block) ──────────────
describe("requestExceedsStock", () => {
  it("flags a transfer/sale that asks for more than is available", () => {
    // 1 carton (=240 pcs) requested but only 100 available
    assert.equal(requestExceedsStock("CARTON", 1, 240, 100), true);
    // 30 pcs requested, 80 available → fine
    assert.equal(requestExceedsStock("PIECE", 30, 10, 80), false);
    // exactly equal → not exceeding
    assert.equal(requestExceedsStock("PIECE", 50, 10, 50), false);
  });

  it("blocks a sale when المحل holds fewer pieces than requested", () => {
    // المحل has 0 → any positive sale is blocked
    assert.equal(requestExceedsStock("PIECE", 5, 10, 0), true);
    // المحل has 4, selling 5 → blocked
    assert.equal(requestExceedsStock("PIECE", 5, 10, 4), true);
    // المحل has 10, selling 5 → allowed
    assert.equal(requestExceedsStock("PIECE", 5, 10, 10), false);
  });
});
