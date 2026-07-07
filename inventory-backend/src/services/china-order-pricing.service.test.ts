/**
 * Unit tests for the fixed "China Order Pricing" template — parse + formula.
 *
 * Formula per carton (worked example used throughout):
 *   unitPriceCny=10, piecesPerCarton=72, cnyPerUsd=7.2, officePercent=3,
 *   cartonCbm=0.2, cbmPriceUsd=170, usdToIqd=1400
 *   X = 10×72 = 720 CNY
 *   Y = 720/7.2 = 100 USD
 *   Z = 100 + 3% = 103 USD
 *   V = 0.2×170 = 34 USD
 *   A = 103+34 = 137 USD
 *   N = 137/72 = 1.9028 USD
 *   H = 1.9028×1400 = 2663.89 IQD
 */
import assert from "node:assert/strict";
import test from "node:test";
import { utils, write } from "xlsx";
import { LandedCostMatchStatus } from "@prisma/client";
import {
  buildChinaOrderTemplate,
  computeChinaPricing,
  parseChinaOrderExcel,
  priceChinaRow,
  type ChinaOrderRow,
  type ChinaPricingParams,
} from "./china-order-pricing.service";

const PARAMS: ChinaPricingParams = { cbmPriceUsd: 170, officePercent: 3, cnyPerUsd: 7.2, usdToIqd: 1400 };

function row(partial: Partial<ChinaOrderRow> = {}): ChinaOrderRow {
  return { itemNumber: "P1", image: "", cartonCount: 10, piecesPerCarton: 72, unitPriceCny: 10, cartonCbm: 0.2, ...partial };
}

function fakeDb(products: { id: string; name: string; itemNumber: string; salePrice: number; purchasePrice: number; imageUrl: string | null; thumbnailUrl: string | null }[]) {
  return {
    product: {
      findMany: async ({ where }: { where: { itemNumber: { in: string[] } } }) =>
        products.filter((p) => where.itemNumber.in.includes(p.itemNumber)),
    },
  } as unknown as typeof import("../config/database").default;
}

function xlsxBuffer(headerRow: string[], dataRows: (string | number)[][]): Buffer {
  const ws = utils.aoa_to_sheet([headerRow, ...dataRows]);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "sheet1");
  return write(wb, { type: "buffer", bookType: "xlsx" });
}

// ── Formula accuracy ─────────────────────────────────────────────────────────

test("priceChinaRow computes X, Y, Z, V, A, N, H exactly per the spec", () => {
  const { X, Y, Z, V, A, N, H } = priceChinaRow(row(), PARAMS);
  assert.equal(X, 720);                       // 10 × 72
  assert.equal(Y, 100);                       // 720 ÷ 7.2
  assert.equal(Z, 103);                       // 100 + 3%
  assert.ok(Math.abs(V - 34) < 1e-9);         // 0.2 × 170
  assert.ok(Math.abs(A - 137) < 1e-9);        // 103 + 34
  assert.ok(Math.abs(N - 137 / 72) < 1e-9);   // per piece USD
  assert.ok(Math.abs(H - (137 / 72) * 1400) < 1e-6); // per piece IQD
});

test("office percent applies ONLY to the goods value Y — never to the CBM shipping V", () => {
  const withOffice = priceChinaRow(row(), { ...PARAMS, officePercent: 10 });
  const noOffice = priceChinaRow(row(), { ...PARAMS, officePercent: 0 });
  // V identical regardless of office percent…
  assert.equal(withOffice.V, noOffice.V);
  // …and the entire difference in A equals exactly 10% of Y.
  assert.ok(Math.abs((withOffice.A - noOffice.A) - noOffice.Y * 0.10) < 1e-9);
});

test("CBM shipping cost = cartonCbm × cbmPriceUsd, independent of goods value", () => {
  const cheapGoods = priceChinaRow(row({ unitPriceCny: 1 }), PARAMS);
  const pricyGoods = priceChinaRow(row({ unitPriceCny: 500 }), PARAMS);
  assert.equal(cheapGoods.V, pricyGoods.V);
  assert.ok(Math.abs(cheapGoods.V - 0.2 * 170) < 1e-9);
});

test("computeChinaPricing totals: totalPieces, totalCartons, totalOrderCostUsd/Iqd", async () => {
  const rows = [row({ itemNumber: "A", cartonCount: 10 }), row({ itemNumber: "B", cartonCount: 5 })];
  const result = await computeChinaPricing(rows, PARAMS, fakeDb([]));
  assert.equal(result.totalCartons, 15);
  assert.equal(result.totalPieces, 15 * 72);
  // A = 137 per carton for both rows → 15 × 137 = 2055 USD
  assert.equal(result.totalOrderCostUsd, 2055);
  assert.equal(result.totalOrderCostIqd, 2055 * 1400);
});

test("rejects missing exchange rates and negative inputs", async () => {
  await assert.rejects(() => computeChinaPricing([row()], { ...PARAMS, cnyPerUsd: 0 }, fakeDb([])), (e: any) => e.code === "CNY_RATE_REQUIRED");
  await assert.rejects(() => computeChinaPricing([row()], { ...PARAMS, usdToIqd: 0 }, fakeDb([])), (e: any) => e.code === "IQD_RATE_REQUIRED");
  await assert.rejects(() => computeChinaPricing([row()], { ...PARAMS, officePercent: -1 }, fakeDb([])), (e: any) => e.code === "INVALID_OFFICE_PERCENT");
  await assert.rejects(() => computeChinaPricing([row({ piecesPerCarton: 0 })], PARAMS, fakeDb([])), (e: any) => e.code === "INVALID_ROW");
});

// ── Matching (same rules as the shared review flow) ─────────────────────────

test("matched product by itemNumber links + suggests a margin-preserving IQD sale price", async () => {
  const result = await computeChinaPricing([row({ itemNumber: "X1" })], PARAMS,
    fakeDb([{ id: "prod-x", name: "منتج", itemNumber: "X1", salePrice: 1500, purchasePrice: 1000, imageUrl: null, thumbnailUrl: null }]));
  const it = result.items[0];
  assert.equal(it.matchStatus, LandedCostMatchStatus.MATCHED);
  assert.equal(it.productId, "prod-x");
  // margin ratio 1.5× on the new IQD unit cost H
  assert.ok(Math.abs(it.suggestedSalePrice! - Math.round(it.unitCostIqd * 1.5 * 100) / 100) < 0.02);
});

test("duplicate itemNumber within the file is AMBIGUOUS; unknown is NOT_FOUND", async () => {
  const result = await computeChinaPricing(
    [row({ itemNumber: "DUP" }), row({ itemNumber: "DUP" }), row({ itemNumber: "MISSING" })],
    PARAMS, fakeDb([]));
  assert.equal(result.items[0].matchStatus, LandedCostMatchStatus.AMBIGUOUS);
  assert.equal(result.items[1].matchStatus, LandedCostMatchStatus.AMBIGUOUS);
  assert.equal(result.items[2].matchStatus, LandedCostMatchStatus.NOT_FOUND);
  assert.equal(result.ambiguousCount, 2);
  assert.equal(result.notFoundCount, 1);
});

// ── Fixed-template parsing ───────────────────────────────────────────────────

test("parseChinaOrderExcel reads the fixed English headers in order", () => {
  const buf = xlsxBuffer(
    ["itemNumber", "image", "cartonCount", "piecesPerCarton", "unitPriceCny", "cartonCbm"],
    [["P001", "", 10, 72, 3.5, 0.2]],
  );
  const rows = parseChinaOrderExcel(buf);
  assert.deepEqual(rows[0], { itemNumber: "P001", image: "", cartonCount: 10, piecesPerCarton: 72, unitPriceCny: 3.5, cartonCbm: 0.2 });
});

test("parseChinaOrderExcel accepts the Arabic header equivalents", () => {
  const buf = xlsxBuffer(
    ["رقم المادة", "الصورة", "عدد الكراتين", "قطع بالكارتون", "سعر القطعة يوان", "حجم الكارتون"],
    [["P002", "", 4, 24, 12, 0.15]],
  );
  const rows = parseChinaOrderExcel(buf);
  assert.equal(rows[0].itemNumber, "P002");
  assert.equal(rows[0].cartonCount, 4);
  assert.equal(rows[0].piecesPerCarton, 24);
  assert.equal(rows[0].unitPriceCny, 12);
  assert.equal(rows[0].cartonCbm, 0.15);
});

test("buildChinaOrderTemplate round-trips through parseChinaOrderExcel", () => {
  const rows = parseChinaOrderExcel(buildChinaOrderTemplate());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemNumber, "P00001");
  assert.equal(rows[0].cartonCount, 10);
  assert.equal(rows[0].piecesPerCarton, 72);
  assert.equal(rows[0].unitPriceCny, 3.5);
  assert.equal(rows[0].cartonCbm, 0.2);
});
