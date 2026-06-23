import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lossUnitToPieces } from "./loss-math";

// A stock loss only ever REMOVES stock. These tests lock the rule that a loss can
// never raise stock (negative qty), never corrupt it (NaN/Infinity), and always
// converts cartons/dozens to pieces correctly.
describe("lossUnitToPieces — conversion", () => {
  it("converts cartons using pcsPerCarton, dozens by 12, pieces as-is", () => {
    assert.equal(lossUnitToPieces("CARTON", 2, 240), 480);
    assert.equal(lossUnitToPieces("DOZEN", 3, 240), 36);
    assert.equal(lossUnitToPieces("PIECE", 7, 240), 7);
  });

  it("falls back to pcsPerCarton=1 when the product has a bad pcsPerCarton", () => {
    assert.equal(lossUnitToPieces("CARTON", 5, 0), 5);
    assert.equal(lossUnitToPieces("CARTON", 5, -10), 5);
    assert.equal(lossUnitToPieces("CARTON", 5, Number.NaN), 5);
  });
});

describe("lossUnitToPieces — rejects non-positive / non-finite quantities", () => {
  for (const bad of [0, -1, -240, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    it(`throws INVALID_LOSS_QUANTITY for quantity = ${bad}`, () => {
      assert.throws(
        () => lossUnitToPieces("PIECE", bad as number, 240),
        /INVALID_LOSS_QUANTITY|موجب/
      );
    });
  }

  it("throws for a non-number quantity", () => {
    assert.throws(
      () => lossUnitToPieces("PIECE", "5" as unknown as number, 240),
      /INVALID_LOSS_QUANTITY|موجب/
    );
  });
});

describe("lossUnitToPieces — rejects unknown units", () => {
  it("throws INVALID_LOSS_UNIT for an unrecognised unit", () => {
    assert.throws(
      () => lossUnitToPieces("BOX" as unknown as "PIECE", 3, 240),
      /INVALID_LOSS_UNIT|وحدة/
    );
  });
});
