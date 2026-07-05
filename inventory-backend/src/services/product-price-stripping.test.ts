import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { serializeProduct } from "./product.service";
import { hideAllPricesFor } from "../controllers/products.controller";
import { UserRole } from "@prisma/client";

const baseProduct = {
  id: "p1",
  name: "مادة تجريبية",
  openingBalancePcs: 5,
  cartonsAvailable: 2,
  pcsPerCarton: 10,
  purchasePrice: 1000,
  salePrice: 1500,
  retailPrice: 1600,
  costPrice: 950,
  oldPrice: 1700,
  warehouseStocks: [
    { quantityPieces: 25, warehouseId: "w1" },
    { quantityPieces: 10, warehouseId: "w2" },
  ],
};

function user(role: UserRole, permissions: string[]): Express.User {
  return { id: "u1", name: "u", username: "u", role, permissions } as Express.User;
}

describe("serializeProduct price stripping", () => {
  test("default (admin path) keeps all price fields", () => {
    const out = serializeProduct({ ...baseProduct }) as Record<string, unknown>;
    assert.equal(out.salePrice, 1500);
    assert.equal(out.purchasePrice, 1000);
    assert.equal(out.costPrice, 950);
    assert.equal(out.currentStock, 35);
  });

  test("hidePurchasePrice strips purchase/cost but keeps salePrice", () => {
    const out = serializeProduct({ ...baseProduct }, undefined, true) as Record<string, unknown>;
    assert.equal("purchasePrice" in out, false);
    assert.equal("costPrice" in out, false);
    assert.equal(out.salePrice, 1500);
  });

  test("hideAllPrices strips EVERY money field, keeps stock and identity", () => {
    const out = serializeProduct({ ...baseProduct }, undefined, false, true) as Record<string, unknown>;
    for (const field of ["salePrice", "purchasePrice", "retailPrice", "costPrice", "oldPrice"]) {
      assert.equal(field in out, false, `${field} must be stripped`);
    }
    assert.equal(out.name, "مادة تجريبية");
    assert.equal(out.currentStock, 35);
    assert.ok(Array.isArray(out.warehouseStocks), "per-warehouse stock stays visible");
  });

  test("hideAllPrices wins even when hidePurchasePrice is false", () => {
    const out = serializeProduct({ ...baseProduct }, undefined, false, true) as Record<string, unknown>;
    assert.equal("salePrice" in out, false);
  });
});

describe("hideAllPricesFor", () => {
  test("ADMIN never restricted, even with the permission set", () => {
    assert.equal(hideAllPricesFor(user(UserRole.ADMIN, ["VIEW_WITHOUT_PRICES"])), false);
  });
  test("STAFF with VIEW_WITHOUT_PRICES is restricted", () => {
    assert.equal(hideAllPricesFor(user(UserRole.STAFF, ["VIEW_WITHOUT_PRICES", "REQUEST_TRANSFER"])), true);
  });
  test("STAFF without the permission is not restricted", () => {
    assert.equal(hideAllPricesFor(user(UserRole.STAFF, ["REQUEST_TRANSFER"])), false);
  });
  test("unauthenticated is not restricted (auth middleware rejects earlier)", () => {
    assert.equal(hideAllPricesFor(undefined), false);
  });
});
