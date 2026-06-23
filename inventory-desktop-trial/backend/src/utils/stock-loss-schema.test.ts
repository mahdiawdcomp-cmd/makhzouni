import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStockLossSchema, cancelStockLossSchema } from "./schemas";

const WAREHOUSE = "11111111-1111-1111-1111-111111111111";
const PRODUCT = "22222222-2222-2222-2222-222222222222";

function body(items: unknown[], extra: Record<string, unknown> = {}) {
  return { body: { date: "2026-06-19", warehouseId: WAREHOUSE, items, ...extra } };
}

describe("createStockLossSchema", () => {
  it("accepts a valid loss and defaults reason to DAMAGE", () => {
    const parsed = createStockLossSchema.parse(
      body([{ productId: PRODUCT, unit: "PIECE", quantity: 3 }])
    );
    assert.equal(parsed.body.reason, "DAMAGE");
    assert.equal(parsed.body.items[0].quantity, 3);
  });

  it("coerces a numeric-string quantity to a number", () => {
    const parsed = createStockLossSchema.parse(
      body([{ productId: PRODUCT, unit: "CARTON", quantity: "4" }])
    );
    assert.equal(parsed.body.items[0].quantity, 4);
  });

  it("rejects a zero quantity", () => {
    assert.throws(() =>
      createStockLossSchema.parse(body([{ productId: PRODUCT, unit: "PIECE", quantity: 0 }]))
    );
  });

  it("rejects a negative quantity (would otherwise raise stock)", () => {
    assert.throws(() =>
      createStockLossSchema.parse(body([{ productId: PRODUCT, unit: "PIECE", quantity: -5 }]))
    );
  });

  it("rejects a non-integer quantity", () => {
    assert.throws(() =>
      createStockLossSchema.parse(body([{ productId: PRODUCT, unit: "PIECE", quantity: 2.5 }]))
    );
  });

  it("rejects a NaN quantity", () => {
    assert.throws(() =>
      createStockLossSchema.parse(body([{ productId: PRODUCT, unit: "PIECE", quantity: Number.NaN }]))
    );
  });

  it("rejects an unknown unit", () => {
    assert.throws(() =>
      createStockLossSchema.parse(body([{ productId: PRODUCT, unit: "BOX", quantity: 1 }]))
    );
  });

  it("rejects an empty items array", () => {
    assert.throws(() => createStockLossSchema.parse(body([])));
  });

  it("rejects a non-uuid warehouse", () => {
    assert.throws(() =>
      createStockLossSchema.parse({
        body: { date: "2026-06-19", warehouseId: "not-a-uuid", items: [{ productId: PRODUCT, unit: "PIECE", quantity: 1 }] },
      })
    );
  });
});

describe("cancelStockLossSchema", () => {
  it("accepts a uuid id param", () => {
    const parsed = cancelStockLossSchema.parse({ params: { id: PRODUCT } });
    assert.equal(parsed.params.id, PRODUCT);
  });

  it("rejects a non-uuid id param", () => {
    assert.throws(() => cancelStockLossSchema.parse({ params: { id: "123" } }));
  });
});
