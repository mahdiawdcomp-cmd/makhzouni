import { test } from "node:test";
import assert from "node:assert/strict";
import { Unit } from "@prisma/client";
import { piecePriceFor, assertCartonPrice, assertCatalogUnits } from "./sale-pricing";
import { priceForUnit } from "./catalog-units";
import { createCatalogOrderSchema, createInvoiceSchema, updateProductSchema } from "./schemas";

test("three prices, fallback, and every invoice unit use the selected piece price", () => {
  const p = { salePrice: 1000, retailPrice: 2000, cartonPiecePrice: 750 };
  assert.equal(piecePriceFor(p, "WHOLESALE"), 1000);
  assert.equal(piecePriceFor(p, "RETAIL"), 2000);
  for (const [unit, expected] of [[Unit.PIECE, 750], [Unit.DOZEN, 9000], [Unit.BOX, 18000], [Unit.CARTON, 36000]] as const) {
    assert.equal(priceForUnit(unit, piecePriceFor(p, "CARTON"), 48, 24), expected);
  }
  assert.equal(piecePriceFor({ ...p, cartonPiecePrice: null }, "CARTON"), 1000);
});

test("carton price must be positive and cannot exceed wholesale; equality and clearing are valid", () => {
  for (const price of [null, undefined, 750, 1000]) assert.doesNotThrow(() => assertCartonPrice(1000, price));
  for (const price of [-1, 0, 1001, NaN]) assert.throws(() => assertCartonPrice(1000, price));
  assert.throws(() => assertCartonPrice(700, 750));
});

test("carton catalog rejects smaller units and forged or duplicate samples", () => {
  const item = { productId: "p", unit: "CARTON", quantity: 1 };
  assert.doesNotThrow(() => assertCatalogUnits([item], "CARTON"));
  for (const unit of ["PIECE", "DOZEN", "BOX"]) {
    assert.throws(() => assertCatalogUnits([{ ...item, unit }], "CARTON"));
    assert.doesNotThrow(() => assertCatalogUnits([{ ...item, unit }], "WHOLESALE"));
  }
  const sample = { ...item, unit: "PIECE", isSample: true };
  assert.doesNotThrow(() => assertCatalogUnits([item, sample], "CARTON"));
  assert.throws(() => assertCatalogUnits([{ ...sample, quantity: 2 }], "CARTON"));
  assert.throws(() => assertCatalogUnits([{ ...sample, unit: "CARTON" }], "CARTON"));
  assert.throws(() => assertCatalogUnits([sample, sample], "CARTON"));
});

test("validation preserves the new fields and refuses unknown price modes", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const items = [{ productId: id, unit: "CARTON", quantity: 1 }];
  const order = { query: { access: "a".repeat(24) }, body: { customerName: "test", phone: "123456789", priceMode: "CARTON", items } };
  assert.equal(createCatalogOrderSchema.parse(order).body.priceMode, "CARTON");
  assert.equal(createCatalogOrderSchema.safeParse({ ...order, body: { ...order.body, priceMode: "RETAIL" } }).success, false);
  assert.equal(createInvoiceSchema.parse({ body: { customerId: id, priceMode: "CARTON", items } }).body.priceMode, "CARTON");
  assert.equal(updateProductSchema.parse({ params: { id }, body: { cartonPiecePrice: null } }).body.cartonPiecePrice, null);
  assert.equal(updateProductSchema.safeParse({ params: { id }, body: { cartonPiecePrice: 0 } }).success, false);
});
