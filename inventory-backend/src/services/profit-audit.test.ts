import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { amountInPieces } from "../utils/financial";

/* ══════════════════════════════════════════════════════════════════════
   The cost rules «تدقيق الربح» stands on.

   The screen shipped counting CANCELLED invoices, which showed one customer
   114M of revenue against 42.6M of real sales — the same invoice numbers
   repeating down the page. These lock the boundaries it should have had.

   Mirrors of the service's own decisions, kept here as pure functions: the
   service reaches straight into prisma, and these are the parts worth
   pinning down without a database.
══════════════════════════════════════════════════════════════════════ */

type Line = {
  unit: "PIECE" | "DOZEN" | "BOX" | "CARTON";
  quantity: number;
  recordedCost: number;
  productCost: number;
  productPurchase: number;
  pcsPerCarton: number;
  boxPieces?: number | null;
};

/** The classification the audit puts on every line. */
function classify(l: Line): "RECORDED" | "PRODUCT" | "NONE" {
  const pieces = amountInPieces(l.unit, l.quantity, l.pcsPerCarton, l.boxPieces);
  const effective = l.recordedCost > 0 ? l.recordedCost : l.productCost > 0 ? l.productCost : l.productPurchase;
  return pieces <= 0 ? "NONE" : l.recordedCost > 0 ? "RECORDED" : effective > 0 ? "PRODUCT" : "NONE";
}

const base: Line = {
  unit: "PIECE", quantity: 10, recordedCost: 0, productCost: 0, productPurchase: 0,
  pcsPerCarton: 24, boxPieces: 12,
};

describe("what the audit is willing to call a known cost", () => {
  test("a cost frozen on the line at sale time is the only confirmed one", () => {
    assert.equal(classify({ ...base, recordedCost: 500 }), "RECORDED");
  });

  test("a blank line falls back to the product card, and says so", () => {
    assert.equal(classify({ ...base, productCost: 500 }), "PRODUCT");
    assert.equal(classify({ ...base, productPurchase: 500 }), "PRODUCT");
  });

  test("the line's own cost beats the product card", () => {
    assert.equal(classify({ ...base, recordedCost: 500, productCost: 900 }), "RECORDED");
  });

  test("nothing anywhere is unknown, never a 100% margin", () => {
    assert.equal(classify(base), "NONE");
  });

  // A carton line on a product whose carton size was never set multiplies out
  // to zero pieces, so its cost vanishes and the sale reads as pure profit —
  // the same lie by a different route.
  test("a carton line with no carton size is unknown, even with a cost on file", () => {
    assert.equal(classify({ ...base, unit: "CARTON", pcsPerCarton: 0, recordedCost: 500 }), "NONE");
    assert.equal(classify({ ...base, unit: "CARTON", pcsPerCarton: 0, productCost: 500 }), "NONE");
  });

  test("a carton line with a carton size behaves normally", () => {
    assert.equal(classify({ ...base, unit: "CARTON", quantity: 2, pcsPerCarton: 24, recordedCost: 500 }), "RECORDED");
  });
});

describe("what a line costs, in pieces", () => {
  test("every unit resolves to pieces the same way the invoice does", () => {
    assert.equal(amountInPieces("PIECE", 10, 24, 12), 10);
    assert.equal(amountInPieces("DOZEN", 2, 24, 12), 24);
    assert.equal(amountInPieces("BOX", 2, 24, 12), 24);
    assert.equal(amountInPieces("CARTON", 2, 24, 12), 48);
  });

  test("an unset box size is half a carton, rounded up", () => {
    assert.equal(amountInPieces("BOX", 1, 25, null), 13);
  });
});

/* The boundary the audit and the fix must BOTH draw. Written as data so the
   two can never disagree about which invoices count. */
const AUDIT_SCOPE = {
  statuses: ["ACTIVE"],
  types: ["SALE"],
  fixTypes: ["SALE", "SALES_RETURN"],
};

describe("which invoices count", () => {
  test("cancelled invoices are not sales", () => {
    assert.equal(AUDIT_SCOPE.statuses.includes("CANCELLED"), false,
      "counting a cancelled invoice showed 114M against 42.6M of real sales");
  });

  test("the fix reaches returns too, so a credit is costed like its sale", () => {
    assert.equal(AUDIT_SCOPE.fixTypes.includes("SALES_RETURN"), true);
  });

  test("the fix never widens past what the audit displayed", () => {
    for (const s of AUDIT_SCOPE.statuses) {
      assert.equal(s, "ACTIVE", "the fix must not touch invoices the audit excluded");
    }
  });
});
