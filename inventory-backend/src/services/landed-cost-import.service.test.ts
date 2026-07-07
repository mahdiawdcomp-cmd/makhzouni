/**
 * Unit tests for the landed-cost import allocation math and product matching.
 * Uses an injected fake `db` (no real Prisma/Postgres connection) — mirrors
 * the fake-tx-mock pattern used elsewhere in this test suite.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { utils, write } from "xlsx";
import { LandedCostAllocationMethod, LandedCostBatchStatus, LandedCostItemAction, LandedCostMatchStatus } from "@prisma/client";
import { buildLandedCostTemplate, cancelBatch, computeLandedCostPreview, createBatchFromPreview, parseLandedCostExcel, setItemDecision, type ParsedLandedCostRow } from "./landed-cost-import.service";

function xlsxBuffer(headerRow: string[], dataRows: (string | number)[][]): Buffer {
  const ws = utils.aoa_to_sheet([headerRow, ...dataRows]);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "sheet1");
  return write(wb, { type: "buffer", bookType: "xlsx" });
}

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

// ── setItemDecision / cancelBatch — plain DB calls, no createProduct/createInvoice ──

function fakeReviewDb(overrides: { batchStatus?: LandedCostBatchStatus; existingProduct?: { id: string } | null } = {}) {
  const batch = { id: "batch-1", status: overrides.batchStatus ?? LandedCostBatchStatus.DRAFT_PRICED };
  const item = { id: "item-1", batchId: "batch-1", productId: null as string | null, confirmedSalePrice: null as number | null, newProductDraft: null };
  const auditLogs: any[] = [];
  const updatedBatches: string[] = [];
  return {
    db: {
      landedCostImportBatch: {
        findUnique: async ({ where }: any) => (where.id === batch.id ? { ...batch } : null),
        update: async ({ where, data }: any) => { if (data.status) { batch.status = data.status; updatedBatches.push(data.status); } return { ...batch, ...data }; },
      },
      landedCostImportItem: {
        findFirst: async ({ where }: any) => (where.id === item.id && where.batchId === batch.id ? { ...item } : null),
        update: async ({ where, data }: any) => { Object.assign(item, data); return { ...item }; },
      },
      product: {
        findFirst: async ({ where }: any) => (overrides.existingProduct && where.id === overrides.existingProduct.id ? { ...overrides.existingProduct } : null),
      },
      auditLog: { create: async ({ data }: any) => { auditLogs.push(data); return data; } },
    } as unknown as typeof import("../config/database").default,
    item, batch, auditLogs, updatedBatches,
  };
}

function hasCode(code: string) {
  return (err: unknown) => (err as { code?: string })?.code === code;
}

test("setItemDecision LINK_EXISTING requires a productId", async () => {
  const { db } = fakeReviewDb();
  await assert.rejects(
    () => setItemDecision("batch-1", "item-1", { action: LandedCostItemAction.LINK_EXISTING }, db),
    hasCode("PRODUCT_REQUIRED"),
  );
});

test("setItemDecision LINK_EXISTING rejects a productId that doesn't exist (or is deleted)", async () => {
  const { db } = fakeReviewDb({ existingProduct: null });
  await assert.rejects(
    () => setItemDecision("batch-1", "item-1", { action: LandedCostItemAction.LINK_EXISTING, productId: "ghost-product" }, db),
    hasCode("PRODUCT_NOT_FOUND"),
  );
});

test("setItemDecision LINK_EXISTING succeeds and moves the batch to REVIEWING_ITEMS", async () => {
  const { db, updatedBatches } = fakeReviewDb({ existingProduct: { id: "prod-real" } });
  const updated = await setItemDecision("batch-1", "item-1", { action: LandedCostItemAction.LINK_EXISTING, productId: "prod-real" }, db);
  assert.equal(updated.productId, "prod-real");
  assert.equal(updated.action, LandedCostItemAction.LINK_EXISTING);
  assert.ok(updatedBatches.includes(LandedCostBatchStatus.REVIEWING_ITEMS), "batch should transition DRAFT_PRICED -> REVIEWING_ITEMS on first decision");
});

test("setItemDecision CREATE_NEW requires a confirmed sale price", async () => {
  const { db } = fakeReviewDb();
  await assert.rejects(
    () => setItemDecision("batch-1", "item-1", { action: LandedCostItemAction.CREATE_NEW }, db),
    hasCode("SALE_PRICE_REQUIRED"),
  );
});

test("setItemDecision SKIP needs no product and no sale price", async () => {
  const { db } = fakeReviewDb();
  const updated = await setItemDecision("batch-1", "item-1", { action: LandedCostItemAction.SKIP }, db);
  assert.equal(updated.action, LandedCostItemAction.SKIP);
});

test("setItemDecision refuses to edit a batch that already became a purchase invoice", async () => {
  const { db } = fakeReviewDb({ batchStatus: LandedCostBatchStatus.PURCHASE_INVOICE_CREATED });
  await assert.rejects(
    () => setItemDecision("batch-1", "item-1", { action: LandedCostItemAction.SKIP }, db),
    hasCode("BATCH_LOCKED"),
  );
});

test("cancelBatch refuses to cancel a batch that already became a purchase invoice", async () => {
  const { db } = fakeReviewDb({ batchStatus: LandedCostBatchStatus.PURCHASE_INVOICE_CREATED });
  await assert.rejects(() => cancelBatch("batch-1", "user-1", db), hasCode("BATCH_LOCKED"));
});

test("cancelBatch marks a draft batch CANCELLED and writes an audit log entry", async () => {
  const { db, batch, auditLogs } = fakeReviewDb({ batchStatus: LandedCostBatchStatus.DRAFT_PRICED });
  await cancelBatch("batch-1", "user-1", db);
  assert.equal(batch.status, LandedCostBatchStatus.CANCELLED);
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0].action, "LANDED_COST_CANCELLED");
});

// ── parseLandedCostExcel — real xlsx buffers, no mocking ────────────────────

test("parseLandedCostExcel reads Arabic headers correctly", () => {
  const buf = xlsxBuffer(
    ["كود الصنف", "اسم المادة", "الكمية", "عدد الكراتين", "سعر الشراء", "المورد", "رقم الفاتورة"],
    [["P001", "شامبو", 120, 10, 3500, "شركة التوريد", "INV-1001"]],
  );
  const { rows, totalRows } = parseLandedCostExcel(buf);
  assert.equal(totalRows, 1);
  assert.deepEqual(rows[0], {
    itemCode: "P001", productName: "شامبو", quantity: 120, cartonCount: 10,
    purchasePrice: 3500, supplier: "شركة التوريد", invoiceNumber: "INV-1001",
    rowExtraCost: 0, hasRowExtraCost: false,
  });
});

test("parseLandedCostExcel also accepts English header fallbacks", () => {
  const buf = xlsxBuffer(
    ["itemCode", "productName", "quantity", "cartonCount", "purchasePrice"],
    [["P002", "Widget", 50, 5, 20]],
  );
  const { rows } = parseLandedCostExcel(buf);
  assert.equal(rows[0].itemCode, "P002");
  assert.equal(rows[0].productName, "Widget");
  assert.equal(rows[0].quantity, 50);
  assert.equal(rows[0].cartonCount, 5);
  assert.equal(rows[0].purchasePrice, 20);
});

test("parseLandedCostExcel detects per-row extra-cost columns when present and non-zero", () => {
  const buf = xlsxBuffer(
    ["itemCode", "productName", "quantity", "purchasePrice", "freight", "customs"],
    [
      ["A1", "Item A", 10, 100, 50, 20], // has its own extra costs
      ["A2", "Item B", 10, 100, "", ""], // no extra costs -> shares the manual pool
    ],
  );
  const { rows } = parseLandedCostExcel(buf);
  assert.equal(rows[0].hasRowExtraCost, true);
  assert.equal(rows[0].rowExtraCost, 70);
  assert.equal(rows[1].hasRowExtraCost, false);
  assert.equal(rows[1].rowExtraCost, 0);
});

test("parseLandedCostExcel rejects an empty file", () => {
  const buf = xlsxBuffer(["itemCode", "productName", "quantity", "purchasePrice"], []);
  assert.throws(() => parseLandedCostExcel(buf), (err: any) => err.code === "EMPTY_FILE");
});

test("parseLandedCostExcel defaults missing cartonCount to null (not 0)", () => {
  const buf = xlsxBuffer(["itemCode", "productName", "quantity", "purchasePrice"], [["A1", "Item", 10, 100]]);
  const { rows } = parseLandedCostExcel(buf);
  assert.equal(rows[0].cartonCount, null);
});

// ── createBatchFromPreview — batch-level extra-cost totaling + persistence ──

test("createBatchFromPreview sums the manual extra costs into totalExtraCost and persists each item with the right default action", async () => {
  const created: { data: any } = { data: null };
  const fakeDb = {
    landedCostImportBatch: {
      create: async (args: any) => { created.data = args.data; return { id: "new-batch", ...args.data, items: args.data.items.create }; },
    },
  } as unknown as typeof import("../config/database").default;

  const items = [
    { itemCode: "A", productName: "a", quantity: 10, cartonCount: null, purchasePrice: 100, allocatedExtraCost: 10, landedCostPerUnit: 101, landedCostPerCarton: null, suggestedSalePrice: null, expectedProfit: null, matchStatus: LandedCostMatchStatus.MATCHED, productId: "prod-a", matchedProduct: null },
    { itemCode: "B", productName: "b", quantity: 5, cartonCount: null, purchasePrice: 200, allocatedExtraCost: 5, landedCostPerUnit: 201, landedCostPerCarton: null, suggestedSalePrice: null, expectedProfit: null, matchStatus: LandedCostMatchStatus.NOT_FOUND, productId: null, matchedProduct: null },
  ];

  const batch = await createBatchFromPreview(
    { allocationMethod: LandedCostAllocationMethod.BY_VALUE, freight: 100, customs: 50, items },
    "user-1",
    fakeDb,
  );

  assert.equal(batch.totalExtraCost, 150, "freight(100) + customs(50)");
  assert.equal(created.data.status, LandedCostBatchStatus.DRAFT_PRICED);
  assert.equal(created.data.items.create[0].action, LandedCostItemAction.LINK_EXISTING, "MATCHED row defaults to LINK_EXISTING");
  assert.equal(created.data.items.create[1].action, LandedCostItemAction.PENDING, "NOT_FOUND row stays PENDING until reviewed");
});

test("buildLandedCostTemplate produces a file parseLandedCostExcel can read back", () => {
  const buf = buildLandedCostTemplate();
  const { rows } = parseLandedCostExcel(buf);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemCode, "P00001");
  assert.equal(rows[0].quantity, 120);
  assert.equal(rows[0].cartonCount, 10);
  assert.equal(rows[0].purchasePrice, 3500);
});
