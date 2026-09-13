/**
 * «تعديل المخزون» — the suggestion is the whole feature, so it is what is tested:
 * it must name a warehouse that can actually spare the goods, never push the
 * source negative, and admit when a transfer cannot fix the product at all.
 */
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

type Row = Record<string, any>;
let products: Row[] = [];

mock.module("../config/database", {
  exports: { default: { product: { findMany: async () => products.map((p) => ({ ...p })) } } },
});

let listProductsWithNegativeStock: () => Promise<any>;

function product(stocks: Array<[string, number]>, pcsPerCarton = 12): Row {
  return {
    id: "p1",
    name: "دبس",
    itemNumber: "AB0001",
    thumbnailUrl: null,
    pcsPerCarton,
    warehouseStocks: stocks.map(([name, qty]) => ({
      warehouseId: `w-${name}`,
      quantityPieces: qty,
      warehouse: { id: `w-${name}`, name },
    })),
  };
}

describe("المواد ذات الرصيد السالب", () => {
  before(async () => {
    ({ listProductsWithNegativeStock } = await import("./product.service"));
  });

  it("يقترح تحويل الناقص بالضبط من المخزن الذي عنده فائض", async () => {
    products = [product([["المحل", 36], ["المخزن", -12]])];

    const { data, unfixableCount } = await listProductsWithNegativeStock();
    assert.equal(data.length, 1);
    assert.equal(data[0].totalPieces, 24);
    assert.equal(data[0].deficitPieces, 12);
    assert.equal(unfixableCount, 0);

    const fix = data[0].suggestions[0];
    assert.equal(fix.fromWarehouseName, "المحل");
    assert.equal(fix.toWarehouseName, "المخزن");
    assert.equal(fix.transferablePieces, 12);
  });

  it("لا يحوّل أكثر مما عند المصدر حتى لا يصير هو السالب", async () => {
    products = [product([["المحل", 5], ["المخزن", -20]])];

    const { data } = await listProductsWithNegativeStock();
    const fix = data[0].suggestions[0];
    assert.equal(fix.neededPieces, 20);
    assert.equal(fix.transferablePieces, 5, "الموجود فقط");
  });

  it("يختار المخزن الأكبر فائضاً حتى يكفي تحويل واحد", async () => {
    products = [product([["صغير", 4], ["كبير", 40], ["المخزن", -10]])];

    const { data } = await listProductsWithNegativeStock();
    const fix = data[0].suggestions[0];
    assert.equal(fix.fromWarehouseName, "كبير");
    assert.equal(fix.transferablePieces, 10);
  });

  it("يعترف أن المادة السالبة بكل المخازن ما ينفع معها تحويل", async () => {
    products = [product([["المحل", -3], ["المخزن", -7]])];

    const { data, unfixableCount } = await listProductsWithNegativeStock();
    assert.equal(unfixableCount, 1);
    assert.equal(data[0].totalPieces, -10);
    assert.ok(data[0].suggestions.every((s: Row) => s.fromWarehouseId === null));
    assert.ok(data[0].suggestions.every((s: Row) => s.transferablePieces === 0));
  });

  it("يعطي اقتراحاً لكل مخزن سالب على حدة", async () => {
    products = [product([["المحل", 50], ["مخزن أ", -6], ["مخزن ب", -8]])];

    const { data } = await listProductsWithNegativeStock();
    assert.equal(data[0].suggestions.length, 2);
    assert.equal(data[0].deficitPieces, 14);
  });
});
