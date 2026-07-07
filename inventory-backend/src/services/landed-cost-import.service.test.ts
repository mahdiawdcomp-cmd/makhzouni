/**
 * Unit tests for the landed-cost import allocation math and product matching.
 * Uses an injected fake `db` (no real Prisma/Postgres connection) — mirrors
 * the fake-tx-mock pattern used elsewhere in this test suite.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { LandedCostAllocationMethod, LandedCostMatchStatus } from "@prisma/client";
import { computeLandedCostPreview, type ParsedLandedCostRow } from "./landed-cost-import.service";

function row(partial: Partial<ParsedLandedCostRow>): ParsedLandedCostRow {
  return {
    itemCode: "P1",
    productName: "Item",
    quantity: 10,
    cartonCount: null,
    purchasePrice: 100,
    supplier: "",
    invoiceNumber: "",
    rowExtraCost: 0,
    hasRowExtraCost: false,
    ...partial,
  };
}

function fakeDb(products: { id: string; name: string; itemNumber: string; salePrice: number; purchasePrice: number; imageUrl: string | null; thumbnailUrl: string | null }[]) {
  return {
    product: {
      findMany: async ({ where }: { where: { itemNumber: { in: string[] } } }) =>
        products.filter((p) => where.itemNumber.in.includes(p.itemNumber)),
    },
  } as unknown as typeof import("../config/database").default;
}

test("BY_VALUE allocates extra cost proportionally to line purchase value", async () => {
  const rows = [
    row({ itemCode: "A", quantity: 10, purchasePrice: 100 }), // value 1000
    row({ itemCode: "B", quantity: 10, purchasePrice: 300 }), // value 3000
  ];
  const { items } = await computeLandedCostPreview(
    { rows, allocationMethod: LandedCostAllocationMethod.BY_VALUE, manualExtraCosts: { freight: 400 } },
    fakeDb([])
  );
  // total value 4000; A gets 1/4 of 400 = 100, B gets 3/4 = 300
  assert.equal(items[0].allocatedExtraCost, 100);
  assert.equal(items[1].allocatedExtraCost, 300);
  assert.equal(items[0].landedCostPerUnit, 110); // 100 + 100/10
  assert.equal(items[1].landedCostPerUnit, 330); // 300 + 300/10
});

test("BY_QUANTITY allocates extra cost proportionally to piece quantity", async () => {
  const rows = [
    row({ itemCode: "A", quantity: 10, purchasePrice: 100 }),
    row({ itemCode: "B", quantity: 30, purchasePrice: 100 }),
  ];
  const { items } = await computeLandedCostPreview(
    { rows, allocationMethod: LandedCostAllocationMethod.BY_QUANTITY, manualExtraCosts: { freight: 400 } },
    fakeDb([])
  );
  assert.equal(items[0].allocatedExtraCost, 100); // 10/40 of 400
  assert.equal(items[1].allocatedExtraCost, 300); // 30/40 of 400
});

test("BY_CARTON allocates extra cost proportionally to carton count", async () => {
  const rows = [
    row({ itemCode: "A", quantity: 10, cartonCount: 1, purchasePrice: 100 }),
    row({ itemCode: "B", quantity: 10, cartonCount: 3, purchasePrice: 100 }),
  ];
  const { items } = await computeLandedCostPreview(
    { rows, allocationMethod: LandedCostAllocationMethod.BY_CARTON, manualExtraCosts: { customs: 400 } },
    fakeDb([])
  );
  assert.equal(items[0].allocatedExtraCost, 100); // 1/4
  assert.equal(items[1].allocatedExtraCost, 300); // 3/4
  assert.equal(items[1].landedCostPerCarton, roundTo2(items[1].landedCostPerUnit * (10 / 3)));
});

function roundTo2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

test("a row with its own per-row extra-cost columns is costed directly, not from the pool", async () => {
  const rows = [
    row({ itemCode: "A", quantity: 10, purchasePrice: 100, hasRowExtraCost: true, rowExtraCost: 50 }),
    row({ itemCode: "B", quantity: 10, purchasePrice: 100 }), // shares the manual pool alone
  ];
  const { items } = await computeLandedCostPreview(
    { rows, allocationMethod: LandedCostAllocationMethod.BY_QUANTITY, manualExtraCosts: { freight: 200 } },
    fakeDb([])
  );
  assert.equal(items[0].allocatedExtraCost, 50); // its own value, untouched by the pool
  assert.equal(items[1].allocatedExtraCost, 200); // gets the WHOLE pool since it's the only pool-sharing row
});

test("duplicate item codes within the same file are marked AMBIGUOUS", async () => {
  const rows = [
    row({ itemCode: "DUP", productName: "First" }),
    row({ itemCode: "DUP", productName: "Second" }),
    row({ itemCode: "UNIQUE" }),
  ];
  const { items } = await computeLandedCostPreview(
    { rows, allocationMethod: LandedCostAllocationMethod.BY_VALUE, manualExtraCosts: {} },
    fakeDb([{ id: "prod-1", name: "x", itemNumber: "DUP", salePrice: 150, purchasePrice: 100, imageUrl: null, thumbnailUrl: null }])
  );
  assert.equal(items[0].matchStatus, LandedCostMatchStatus.AMBIGUOUS);
  assert.equal(items[1].matchStatus, LandedCostMatchStatus.AMBIGUOUS);
  assert.equal(items[0].productId, null, "ambiguous rows must not auto-link a product");
});

test("a matched product suggests a sale price that preserves its current margin ratio", async () => {
  const rows = [row({ itemCode: "X", quantity: 1, purchasePrice: 220 })];
  const { items } = await computeLandedCostPreview(
    { rows, allocationMethod: LandedCostAllocationMethod.BY_VALUE, manualExtraCosts: {} },
    fakeDb([{ id: "prod-x", name: "x", itemNumber: "X", salePrice: 150, purchasePrice: 100, imageUrl: null, thumbnailUrl: null }])
  );
  // old margin: 150/100 = 1.5x purchase price. New landed cost 220 -> suggested 330.
  assert.equal(items[0].matchStatus, LandedCostMatchStatus.MATCHED);
  assert.equal(items[0].productId, "prod-x");
  assert.equal(items[0].suggestedSalePrice, 330);
  assert.equal(items[0].expectedProfit, roundTo2(330 - items[0].landedCostPerUnit));
});

test("an item code with no DB match is NOT_FOUND with no suggested sale price", async () => {
  const rows = [row({ itemCode: "MISSING" })];
  const { items } = await computeLandedCostPreview(
    { rows, allocationMethod: LandedCostAllocationMethod.BY_VALUE, manualExtraCosts: {} },
    fakeDb([])
  );
  assert.equal(items[0].matchStatus, LandedCostMatchStatus.NOT_FOUND);
  assert.equal(items[0].productId, null);
  assert.equal(items[0].suggestedSalePrice, null);
});
