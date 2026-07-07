/**
 * Integration tests for finalConfirmBatch — the one function in the landed-cost
 * flow allowed to touch Product/stock, via the REAL createProduct/createInvoice
 * services running against a faithful in-memory fake transaction (no real
 * Postgres). Mirrors the pattern in business-journey.test.ts: only
 * warehouse-stock.service (and its lightweight transitive deps) is mocked;
 * everything else under test is the real, unmocked business logic.
 *
 * NOTE: this file must NOT statically import landed-cost-import.service (or
 * anything that transitively imports warehouse-stock.service) at module top
 * level — mock.module() only intercepts imports that happen AFTER it runs, so
 * the module under test is loaded dynamically inside before().
 */
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { InvoiceType, LandedCostBatchStatus, LandedCostItemAction, LandedCostMatchStatus, PaymentType, Unit } from "@prisma/client";

const SHOP = "wh-shop";
const CUST = "cust-supplier";

const stock = new Map<string, number>();
const skey = (p: string, w: string) => `${p}:${w}`;
const stockOf = (p: string, w: string) => stock.get(skey(p, w)) ?? 0;

const customer: any = {
  id: CUST, openingBalance: 0, currentBalance: 0, branchId: SHOP,
  creditLimit: null, deletedAt: null, lastTransactionAt: null, name: "مورّد الشحنة",
};

// A pre-existing product for the LINK_EXISTING scenarios.
const existingProduct: any = {
  id: "prod-existing", name: "منتج موجود", itemNumber: "EX0001", qrCode: "QR-EX0001",
  cartonQrCode: null, imageUrl: null, thumbnailUrl: null, category: null,
  categoryTags: [], typeTags: [], isNewArrival: false, isOffer: false, oldPrice: null,
  openingBalancePcs: 0, cartonsAvailable: 0, pcsPerCarton: 12,
  boxPieces: null, isBoxPiecesManual: false, hiddenUnits: [],
  purchasePrice: 100, salePrice: 200, retailPrice: 0, costPrice: 100,
  expiryDate: null, minStock: 0, storageLocation: null, branchId: SHOP,
  deletedAt: null,
};

const products: any[] = [existingProduct];
const invoices: any[] = [];
const invoiceItems: any[] = [];
const movements: any[] = [];
const appNotifications: any[] = [];
const auditLogs: any[] = [];
const batches: any[] = [];
const counters = new Map<string, number>();
let invSeq = 0, itemSeq = 0, prodSeq = 0;

function withInvoiceItems(inv: any) {
  return {
    ...inv,
    customer: { ...customer },
    items: invoiceItems.filter((i) => i.invoiceId === inv.id).map((it) => ({ ...it, product: products.find((p) => p.id === it.productId) })),
  };
}

// ── Faithful stock-engine mock (same shape as business-journey.test.ts) ─────
mock.module("./warehouse-stock.service", {
  exports: {
    ensureLegacyWarehouseStock: async () => {},
    syncProductTotalStock: async () => {},
    resolveShopWarehouseId: async () => SHOP,
    resolveWarehouseId: async (_tx: any, id?: string | null) => id ?? SHOP,
    adjustWarehouseStock: async (_tx: any, { productId, warehouseId, deltaPieces, allowNegative }: any) => {
      const before = stockOf(productId, warehouseId);
      const after = before + deltaPieces;
      if (after < 0 && !allowNegative) {
        const err: any = new Error("Insufficient stock");
        err.statusCode = 400; err.code = "INSUFFICIENT_STOCK";
        throw err;
      }
      stock.set(skey(productId, warehouseId), after);
      return { balanceBefore: before, balanceAfter: after };
    },
    upsertWarehouseStock: async (_tx: any, { productId, warehouseId, quantityPieces }: any) => {
      stock.set(skey(productId, warehouseId), quantityPieces);
      return {};
    },
  },
});
mock.module("./approval.service", { exports: { approvalRequestTypes: {}, createPendingApproval: async () => ({}) } });
mock.module("./settings.service", { exports: { getSettings: async () => ({}) } });
mock.module("./whatsapp.service", { exports: { sendWhatsAppText: async () => {} } });

const tx: any = {
  $queryRaw: async () => [],

  counter: {
    upsert: async ({ where, create }: any) => {
      const v = (counters.get(where.key) ?? create.value - 1) + 1;
      counters.set(where.key, v);
      return { key: where.key, value: v };
    },
  },
  customer: {
    findFirst: async ({ where }: any) => (where?.id && where.id !== customer.id ? null : { ...customer }),
    update: async ({ data }: any) => { Object.assign(customer, data); return { ...customer }; },
  },
  product: {
    findUnique: async ({ where }: any) => products.find((p) => p.id === where.id || p.itemNumber === where.itemNumber) ?? null,
    findUniqueOrThrow: async ({ where }: any) => {
      const p = products.find((x) => x.id === where.id);
      if (!p) throw new Error(`[fake] product ${where.id} missing`);
      return { ...p, warehouseStocks: [] };
    },
    findFirst: async ({ where }: any) => products.find((p) => p.id === where.id && (where.deletedAt !== null || p.deletedAt == null)) ?? null,
    findMany: async ({ where }: any) => (where.id.in as string[]).map((id) => products.find((p) => p.id === id)).filter(Boolean).map((p) => ({ ...p })),
    create: async ({ data }: any) => {
      const p = { id: `prod-new-${++prodSeq}`, deletedAt: null, ...data };
      products.push(p);
      return { ...p };
    },
    update: async ({ where, data }: any) => {
      const p = products.find((x) => x.id === where.id);
      if (!p) throw new Error(`[fake] product ${where.id} missing`);
      Object.assign(p, data);
      return { ...p };
    },
  },
  branch: {
    count: async () => 1,
    findMany: async ({ where }: any) => (where.id.in as string[]).filter((id) => id === SHOP).map((id) => ({ id, name: id })),
    findUnique: async ({ where }: any) => ({ name: where.id }),
  },
  invoice: {
    findUnique: async ({ where }: any) => {
      const inv = invoices.find((i) => i.id === where.id);
      return inv ? withInvoiceItems(inv) : null;
    },
    findFirst: async ({ where }: any) => invoices.find((i) => i.customerId === where.customerId && i.status === "ACTIVE") ?? null,
    create: async ({ data }: any) => {
      const inv = { id: `inv-${++invSeq}`, invoiceNumber: `PINV-${invSeq}`, status: "ACTIVE", archivedAt: null, ...data };
      invoices.push(inv);
      return withInvoiceItems(inv);
    },
    update: async ({ where, data }: any) => {
      const inv = invoices.find((i) => i.id === where.id);
      const { items, customer: _c, ...rest } = data;
      Object.assign(inv, rest);
      return withInvoiceItems(inv);
    },
    aggregate: async () => ({ _sum: { remainingAmount: 0 } }),
  },
  invoiceItem: {
    create: async ({ data }: any) => {
      const item = { id: `it-${++itemSeq}`, ...data };
      invoiceItems.push(item);
      return item;
    },
  },
  stockMovement: {
    create: async ({ data }: any) => { movements.push({ id: `mv-${movements.length + 1}`, ...data }); return data; },
    createMany: async ({ data }: any) => { for (const d of data) movements.push({ id: `mv-${movements.length + 1}`, ...d }); return { count: data.length }; },
  },
  productWarehouseStock: {
    findUnique: async ({ where }: any) => {
      const { productId, warehouseId } = where.productId_warehouseId;
      const q = stock.get(skey(productId, warehouseId));
      return q === undefined ? null : { quantityPieces: q };
    },
    aggregate: async ({ where }: any) => {
      const pid = where.productId;
      const sum = [...stock.entries()].filter(([k]) => k.startsWith(`${pid}:`)).reduce((s, [, v]) => s + v, 0);
      return { _sum: { quantityPieces: sum } };
    },
  },
  couponRedemption: { deleteMany: async () => ({ count: 0 }), create: async () => ({}) },
  pendingApproval: { create: async () => ({}) },
  paymentVoucher: { aggregate: async () => ({ _sum: { amount: 0 } }), findFirst: async () => null },
  appNotification: {
    findFirst: async () => null,
    create: async ({ data }: any) => { const n = { id: `an-${appNotifications.length + 1}`, ...data }; appNotifications.push(n); return n; },
    update: async ({ where, data }: any) => { const n = appNotifications.find((x) => x.id === where.id); Object.assign(n, data); return n; },
  },
  auditLog: { create: async ({ data }: any) => { auditLogs.push(data); return data; } },
  landedCostImportBatch: {
    findUnique: async ({ where, include }: any) => {
      const b = batches.find((x) => x.id === where.id);
      if (!b) return null;
      if (include?.items) return { ...b };
      return { status: b.status };
    },
    updateMany: async ({ where, data }: any) => {
      const b = batches.find((x) => x.id === where.id);
      if (!b) return { count: 0 };
      if (where.status?.notIn && where.status.notIn.includes(b.status)) return { count: 0 };
      Object.assign(b, data);
      return { count: 1 };
    },
    update: async ({ where, data }: any) => {
      const b = batches.find((x) => x.id === where.id);
      Object.assign(b, data);
      return { ...b };
    },
  },
};

function makeBatch(overrides: Partial<{ id: string; status: string; items: any[] }>) {
  const b = { id: overrides.id ?? `batch-${batches.length + 1}`, status: overrides.status ?? LandedCostBatchStatus.REVIEWING_ITEMS, invoiceNumber: null, items: overrides.items ?? [] };
  batches.push(b);
  return b;
}

function baseItem(overrides: Partial<any>) {
  return {
    id: `li-${Math.random().toString(36).slice(2)}`,
    itemCode: "X1", productName: "صنف", quantity: 10, cartonCount: null,
    purchasePrice: 100, allocatedExtraCost: 0, landedCostPerUnit: 100, landedCostPerCarton: null,
    suggestedSalePrice: null, confirmedSalePrice: null, expectedProfit: null,
    matchStatus: LandedCostMatchStatus.MATCHED, action: LandedCostItemAction.LINK_EXISTING,
    productId: null, newProductDraft: null,
    ...overrides,
  };
}

let finalConfirmBatch: Function;

describe("finalConfirmBatch — real createProduct/createInvoice against a fake tx", () => {
  before(async () => {
    ({ finalConfirmBatch } = await import("./landed-cost-import.service"));
  });

  it("LINK_EXISTING path: adds stock via the real purchase invoice and OVERWRITES cost/purchase price directly (not WAC-blended)", async () => {
    stock.set(skey(existingProduct.id, SHOP), 0);
    const batch = makeBatch({ items: [baseItem({ productId: existingProduct.id, quantity: 20, purchasePrice: 150, landedCostPerUnit: 180 })] });

    const summary = await finalConfirmBatch(batch.id, { supplierCustomerId: CUST, warehouseId: SHOP, paymentType: PaymentType.CREDIT, paidAmount: 0 }, "user-1", "Admin", tx);

    assert.equal(summary.linkedCount, 1);
    assert.equal(summary.createdCount, 0);
    assert.equal(summary.skippedCount, 0);
    assert.equal(summary.totalStockAdded, 20);
    assert.equal(stockOf(existingProduct.id, SHOP), 20, "stock must land in the selected warehouse");
    // Direct overwrite, not WAC blend — costPrice/purchasePrice become exactly the landed values.
    assert.equal(Number(existingProduct.costPrice), 180);
    assert.equal(Number(existingProduct.purchasePrice), 150);
    assert.equal(batch.status, LandedCostBatchStatus.PURCHASE_INVOICE_CREATED);
    assert.ok(batch.purchaseInvoiceId);
    assert.ok(auditLogs.some((a) => a.action === "LANDED_COST_APPLY" && a.recordId === batch.id));
    assert.ok(auditLogs.some((a) => a.action === "LANDED_COST_PRODUCT_COST_UPDATED" && a.recordId === existingProduct.id));
  });

  it("CREATE_NEW path: creates the product with ZERO opening stock, then the purchase invoice adds the real stock", async () => {
    const draft = { name: "منتج جديد من الشحنة", itemCode: "NEWX1" };
    const batch = makeBatch({ items: [baseItem({ matchStatus: LandedCostMatchStatus.NOT_FOUND, action: LandedCostItemAction.CREATE_NEW, productId: null, quantity: 15, purchasePrice: 80, landedCostPerUnit: 95, confirmedSalePrice: 150, newProductDraft: draft })] });

    const summary = await finalConfirmBatch(batch.id, { supplierCustomerId: CUST, warehouseId: SHOP, paidAmount: 0 }, "user-1", "Admin", tx);

    assert.equal(summary.createdCount, 1);
    assert.equal(summary.linkedCount, 0);
    const created = products.find((p) => p.itemNumber === "NEWX1");
    assert.ok(created, "new product must have been created");
    assert.equal(Number(created.costPrice), 95, "new product costPrice = landed cost");
    assert.equal(Number(created.purchasePrice), 80, "new product purchasePrice = excel purchase price");
    assert.equal(Number(created.salePrice), 150, "new product salePrice = user-confirmed price");
    assert.equal(Number(created.openingBalancePcs), 0, "createProduct itself must add ZERO stock — the invoice adds it");
    assert.equal(stockOf(created.id, SHOP), 15, "stock arrives only via the purchase invoice line");
  });

  it("SKIP rows are excluded from the invoice entirely and add no stock", async () => {
    const before = stockOf(existingProduct.id, SHOP);
    const batch = makeBatch({
      items: [
        baseItem({ productId: existingProduct.id, quantity: 5, action: LandedCostItemAction.LINK_EXISTING }),
        baseItem({ productId: null, quantity: 999, action: LandedCostItemAction.SKIP, matchStatus: LandedCostMatchStatus.NOT_FOUND }),
      ],
    });

    const summary = await finalConfirmBatch(batch.id, { supplierCustomerId: CUST, warehouseId: SHOP, paidAmount: 0 }, "user-1", "Admin", tx);

    assert.equal(summary.skippedCount, 1);
    assert.equal(summary.linkedCount, 1);
    assert.equal(summary.totalStockAdded, 5, "the skipped row's huge quantity must never reach stock");
    assert.equal(stockOf(existingProduct.id, SHOP), before + 5);
  });

  it("blocks final confirm while any item is still PENDING, and touches nothing", async () => {
    const before = stockOf(existingProduct.id, SHOP);
    const batch = makeBatch({ items: [baseItem({ productId: existingProduct.id, action: LandedCostItemAction.LINK_EXISTING }), baseItem({ productId: null, action: LandedCostItemAction.PENDING, matchStatus: LandedCostMatchStatus.NOT_FOUND })] });

    await assert.rejects(
      () => finalConfirmBatch(batch.id, { supplierCustomerId: CUST, warehouseId: SHOP, paidAmount: 0 }, "user-1", "Admin", tx),
      (err: any) => err.code === "UNRESOLVED_ITEMS",
    );
    assert.equal(stockOf(existingProduct.id, SHOP), before, "no stock change when confirm is blocked");
    assert.equal(batch.status, LandedCostBatchStatus.REVIEWING_ITEMS, "batch must stay unresolved, not falsely flip to applied");
  });

  it("rejects a zero/invalid quantity row instead of creating a nonsensical invoice line", async () => {
    const batch = makeBatch({ items: [baseItem({ productId: existingProduct.id, quantity: 0, action: LandedCostItemAction.LINK_EXISTING })] });
    await assert.rejects(
      () => finalConfirmBatch(batch.id, { supplierCustomerId: CUST, warehouseId: SHOP, paidAmount: 0 }, "user-1", "Admin", tx),
      (err: any) => err.code === "INVALID_QUANTITY",
    );
  });

  it("refuses to confirm the same batch twice (idempotency / no double purchase invoice)", async () => {
    const batch = makeBatch({ items: [baseItem({ productId: existingProduct.id, quantity: 3, action: LandedCostItemAction.LINK_EXISTING })] });
    const first = await finalConfirmBatch(batch.id, { supplierCustomerId: CUST, warehouseId: SHOP, paidAmount: 0 }, "user-1", "Admin", tx);
    assert.ok(first.purchaseInvoiceId);

    await assert.rejects(
      () => finalConfirmBatch(batch.id, { supplierCustomerId: CUST, warehouseId: SHOP, paidAmount: 0 }, "user-1", "Admin", tx),
      (err: any) => err.code === "ALREADY_APPLIED",
    );
    const invoicesForBatch = invoices.filter((i) => i.id === batch.purchaseInvoiceId);
    assert.equal(invoicesForBatch.length, 1, "must never create a second purchase invoice for the same batch");
  });

  it("a CANCELLED batch can never be confirmed", async () => {
    const batch = makeBatch({ status: LandedCostBatchStatus.CANCELLED, items: [baseItem({ productId: existingProduct.id, action: LandedCostItemAction.LINK_EXISTING })] });
    await assert.rejects(
      () => finalConfirmBatch(batch.id, { supplierCustomerId: CUST, warehouseId: SHOP, paidAmount: 0 }, "user-1", "Admin", tx),
      (err: any) => err.code === "BATCH_CANCELLED",
    );
  });
});
