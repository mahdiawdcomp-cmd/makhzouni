/**
 * End-to-end BUSINESS JOURNEY — drives the REAL services through one shared
 * in-memory database, performing every operation the operator does by hand:
 *
 *   1. start with a stocked product (100 pcs at المحل)
 *   2. SALE invoice  (10 pcs)        → stock ↓, customer debt ↑
 *   3. PURCHASE invoice (5 cartons)  → stock ↑, balance flips to "we owe"
 *   4. RECEIPT voucher               → balance moves toward zero
 *   5. EDIT the voucher              → balance recomputed
 *   6. DELETE the voucher            → balance restored
 *   7. TRANSFER 20 pcs المحل→مخزن    → stock conserved, just relocated
 *   8. CANCEL the sale invoice       → sold stock returns, debt reversed
 *
 * The stock engine (warehouse-stock.service) is module-mocked with a faithful
 * in-memory map that blocks overdraws; every other table is a real-shaped fake.
 * The invoice / voucher / transfer services themselves are UNMOCKED — this is
 * exactly what the running server executes when the user clicks the buttons on
 * web or Android (both call the same API).
 */

import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { InvoiceType, Unit, VoucherType } from "@prisma/client";

// ── Identifiers ───────────────────────────────────────────────────────────────
const SHOP = "wh-shop";
const DEPOT = "wh-depot";
const PROD = "prod-1";
const CUST = "cust-1";

// ── Shared in-memory store ────────────────────────────────────────────────────
const stock = new Map<string, number>(); // `${productId}:${warehouseId}` → pieces
const skey = (p: string, w: string) => `${p}:${w}`;
const stockOf = (w: string) => stock.get(skey(PROD, w)) ?? 0;
const totalStock = () =>
  [...stock.entries()].filter(([k]) => k.startsWith(`${PROD}:`)).reduce((s, [, v]) => s + v, 0);

const customer: any = {
  id: CUST, openingBalance: 0, currentBalance: 0, branchId: SHOP,
  creditLimit: null, deletedAt: null, lastTransactionAt: null, name: "زبون",
};
const product: any = {
  id: PROD, name: "منتج", itemNumber: "AB0001", pcsPerCarton: 12,
  salePrice: 1000, purchasePrice: 600, costPrice: 0, branchId: SHOP, deletedAt: null,
};

const invoices: any[] = [];
const vouchers: any[] = [];
const movements: any[] = [];
const counters = new Map<string, number>();
let invSeq = 0, itemSeq = 0, vSeq = 0;

const bal = () => customer.currentBalance;

// ── Faithful stock-engine mock ────────────────────────────────────────────────
mock.module("./warehouse-stock.service", {
  exports: {
    ensureLegacyWarehouseStock: async () => {},
    syncProductTotalStock: async () => {},
    resolveShopWarehouseId: async () => SHOP,
    resolveWarehouseId: async (_tx: any, id?: string | null) => id ?? SHOP,
    adjustWarehouseStock: async (_tx: any, { productId, warehouseId, deltaPieces, allowNegative }: any) => {
      const before = stock.get(skey(productId, warehouseId)) ?? 0;
      const after = before + deltaPieces;
      if (after < 0 && !allowNegative) {
        const err: any = new Error("Insufficient stock");
        err.statusCode = 400; err.code = "INSUFFICIENT_STOCK";
        throw err;
      }
      stock.set(skey(productId, warehouseId), after);
      return { balanceBefore: before, balanceAfter: after };
    },
  },
});
// transfer.service transitive imports — stubbed.
mock.module("./approval.service", { exports: { approvalRequestTypes: {}, createPendingApproval: async () => ({}) } });
mock.module("./settings.service", { exports: { getSettings: async () => ({}) } });
mock.module("./whatsapp.service", { exports: { sendWhatsAppText: async () => {} } });

// ── Helpers to augment include-shapes ─────────────────────────────────────────
function withItems(inv: any) {
  return {
    ...inv,
    customer: { ...customer },
    creator: null,
    items: inv.items.map((it: any) => ({ ...it, product: { ...product }, warehouse: { id: it.warehouseId, name: it.warehouseId } })),
  };
}

// ── Single shared transaction client (no $transaction — services get db directly) ─
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
    findFirst: async ({ where }: any) => {
      if (where?.id && where.id !== customer.id) return null;
      if (where?.deletedAt === null && customer.deletedAt != null) return null;
      return { ...customer };
    },
    update: async ({ data }: any) => {
      if (data.currentBalance !== undefined) customer.currentBalance = data.currentBalance;
      if (data.lastTransactionAt !== undefined) customer.lastTransactionAt = data.lastTransactionAt;
      return { ...customer };
    },
  },

  product: {
    findUnique: async ({ where }: any) => (where.id === product.id ? { ...product } : null),
    findMany: async ({ where }: any) =>
      (where.id.in as string[]).filter((id) => id === product.id).map(() => ({ ...product })),
    update: async ({ where, data }: any) => {
      if (where.id === product.id) Object.assign(product, data);
      return { ...product };
    },
  },

  branch: {
    findMany: async ({ where }: any) =>
      (where.id.in as string[]).filter((id) => id === SHOP || id === DEPOT).map((id) => ({ id, name: id })),
    findUnique: async ({ where }: any) => ({ name: where.id }),
  },

  invoice: {
    findUnique: async ({ where }: any) => {
      let inv = null;
      if (where.id) inv = invoices.find((i) => i.id === where.id);
      else if (where.invoiceNumber) inv = invoices.find((i) => i.invoiceNumber === where.invoiceNumber);
      else if (where.clientRequestId) inv = invoices.find((i) => i.clientRequestId === where.clientRequestId);
      return inv ? withItems(inv) : null;
    },
    findFirst: async ({ where }: any) =>
      invoices.find((i) => i.customerId === where.customerId && i.status === "ACTIVE") ?? null,
    create: async ({ data }: any) => {
      const inv = { id: `inv-${++invSeq}`, status: "ACTIVE", archivedAt: null, items: [], ...data };
      invoices.push(inv);
      return withItems(inv);
    },
    update: async ({ where, data }: any) => {
      const inv = invoices.find((i) => i.id === where.id);
      if (!inv) throw new Error(`[fake] invoice ${where.id} missing`);
      const { items, customer: _c, creator: _cr, ...rest } = data;
      Object.assign(inv, rest);
      return withItems(inv);
    },
    aggregate: async ({ where }: any) => {
      const want = where.type;
      const sum = invoices
        .filter((i) => i.customerId === where.customerId && i.status === where.status)
        .filter((i) => (typeof want === "string" ? i.type === want : (want?.in ?? []).includes(i.type)))
        .reduce((s, i) => s + Number(i.remainingAmount), 0);
      return { _sum: { remainingAmount: sum } };
    },
  },

  invoiceItem: {
    create: async ({ data }: any) => {
      const inv = invoices.find((i) => i.id === data.invoiceId);
      const item = { id: `it-${++itemSeq}`, ...data };
      inv.items.push(item);
      return item;
    },
  },

  stockMovement: {
    create: async ({ data }: any) => { movements.push({ id: `mv-${movements.length + 1}`, ...data }); return data; },
    createMany: async ({ data }: any) => { for (const d of data) movements.push({ id: `mv-${movements.length + 1}`, ...d }); return { count: data.length }; },
    deleteMany: async ({ where }: any) => {
      for (let i = movements.length - 1; i >= 0; i--) if (movements[i].invoiceId === where.invoiceId) movements.splice(i, 1);
      return { count: 0 };
    },
  },

  // Sale pre-check reads the warehouse row directly off the tx; back it with the same stock map.
  productWarehouseStock: {
    findUnique: async ({ where }: any) => {
      const { productId, warehouseId } = where.productId_warehouseId;
      const q = stock.get(skey(productId, warehouseId));
      return q === undefined ? null : { quantityPieces: q };
    },
    // WAC needs the product's total pieces across all warehouses before a purchase.
    aggregate: async ({ where }: any) => {
      const pid = where.productId;
      const sum = [...stock.entries()]
        .filter(([k]) => k.startsWith(`${pid}:`))
        .reduce((s, [, v]) => s + v, 0);
      return { _sum: { quantityPieces: sum } };
    },
  },

  couponRedemption: { deleteMany: async () => ({ count: 0 }), create: async () => ({}) },
  pendingApproval: { create: async () => ({}) },

  paymentVoucher: {
    create: async ({ data }: any) => {
      const v = { id: `v-${++vSeq}`, archivedAt: null, cancelledAt: null, deletedBy: null, deleteReason: null, ...data };
      vouchers.push(v);
      return { ...v, customer: { ...customer }, creator: null };
    },
    findUnique: async ({ where }: any) => { const v = vouchers.find((x) => x.id === where.id); return v ? { ...v } : null; },
    findFirst: async ({ where }: any) => {
      if (where?.voucherNumber !== undefined) { const v = vouchers.find((x) => x.voucherNumber === where.voucherNumber); return v ? { id: v.id } : null; }
      const m = vouchers.filter((x) =>
        (where.customerId === undefined || x.customerId === where.customerId) &&
        (where.archivedAt !== null || x.archivedAt == null) &&
        (where.cancelledAt !== null || x.cancelledAt == null));
      return m.length ? { ...m[m.length - 1] } : null;
    },
    update: async ({ where, data }: any) => {
      const v = vouchers.find((x) => x.id === where.id);
      for (const k of ["amount", "date", "notes", "description", "archivedAt", "cancelledAt", "deletedBy", "deleteReason"]) if (data[k] !== undefined) v[k] = data[k];
      if (data.customer?.connect?.id) v.customerId = data.customer.connect.id;
      return { ...v, customer: { ...customer }, creator: null };
    },
    aggregate: async ({ where }: any) => {
      const sum = vouchers
        .filter((x) =>
          x.customerId === where.customerId && x.type === where.type &&
          (where.archivedAt !== null || x.archivedAt == null) &&
          (where.cancelledAt !== null || x.cancelledAt == null))
        .reduce((s, x) => s + Number(x.amount), 0);
      return { _sum: { amount: sum } };
    },
  },

  inventoryTransfer: {
    create: async ({ data }: any) => ({ id: "trf-1", ...data }),
    findUniqueOrThrow: async ({ where }: any) => ({ id: where.id, items: [] }),
  },
};

// ── Services under test (real) ────────────────────────────────────────────────
let createInvoice: Function, cancelInvoice: Function;
let createVoucher: Function, updateVoucher: Function, deleteVoucher: Function;
let executeTransferWithin: Function;

let saleId = "", voucherId = "";

describe("end-to-end business journey (real services, shared in-memory DB)", () => {
  before(async () => {
    ({ createInvoice, cancelInvoice } = await import("./invoice.service"));
    ({ createVoucher, updateVoucher, deleteVoucher } = await import("./voucher.service"));
    ({ executeTransferWithin } = await import("./transfer.service"));
    stock.set(skey(PROD, SHOP), 100);
    stock.set(skey(PROD, DEPOT), 0);
  });

  it("opens with 100 pcs in stock and a zero balance", () => {
    assert.equal(stockOf(SHOP), 100);
    assert.equal(bal(), 0);
  });

  it("SALE of 10 pcs drops stock to 90 and puts the customer 10,000 in debt", async () => {
    const inv = await createInvoice(
      { customerId: CUST, type: InvoiceType.SALE, discount: 0, tax: 0, paidAmount: 0,
        items: [{ productId: PROD, unit: Unit.PIECE, quantity: 10 }] },
      "user-1", tx);
    saleId = inv.id;
    assert.equal(inv.subtotal, 10_000, "10 × 1000");
    assert.equal(inv.remainingAmount, 10_000, "unpaid → full credit");
    assert.equal(stockOf(SHOP), 90, "stock 100 → 90");
    assert.equal(bal(), 10_000, "customer owes us 10,000");
  });

  it("PURCHASE of 5 cartons adds 60 pcs and flips the balance to −26,000 (we owe)", async () => {
    const inv = await createInvoice(
      { customerId: CUST, type: InvoiceType.PURCHASE, discount: 0, tax: 0, paidAmount: 0,
        items: [{ productId: PROD, unit: Unit.CARTON, quantity: 5 }] },
      "user-1", tx);
    assert.equal(inv.subtotal, 36_000, "5 × (600 × 12)");
    assert.equal(stockOf(SHOP), 150, "90 + 60");
    assert.equal(bal(), -26_000, "10,000 sale − 36,000 purchase");
  });

  it("RECEIPT voucher of 4,000 moves the balance to −30,000", async () => {
    const v = await createVoucher({ customerId: CUST, amount: 4_000, type: VoucherType.RECEIPT }, "user-1", tx);
    voucherId = v.id;
    assert.equal(bal(), -30_000, "10,000 − 36,000 − 4,000");
  });

  it("EDITING the voucher to 6,000 recomputes the balance to −32,000", async () => {
    await updateVoucher(voucherId, { amount: 6_000 }, tx);
    assert.equal(bal(), -32_000, "10,000 − 36,000 − 6,000");
  });

  it("DELETING the voucher restores the balance to −26,000", async () => {
    await deleteVoucher(voucherId, tx, "user-1", "تصحيح");
    assert.equal(bal(), -26_000, "voucher excluded → back to sale − purchase");
  });

  it("TRANSFER of 20 pcs المحل→مخزن relocates stock without changing the total", async () => {
    const total0 = totalStock();
    await executeTransferWithin(tx,
      { fromBranchId: SHOP, toBranchId: DEPOT, items: [{ productId: PROD, quantity: 20, unit: Unit.PIECE }] },
      "user-1", false);
    assert.equal(stockOf(SHOP), 130, "150 − 20");
    assert.equal(stockOf(DEPOT), 20, "0 + 20");
    assert.equal(totalStock(), total0, "total conserved across warehouses");
  });

  it("CANCELLING the sale returns the 10 sold pcs and reverses the debt", async () => {
    await cancelInvoice(saleId, tx);
    assert.equal(stockOf(SHOP), 140, "130 + 10 returned");
    assert.equal(bal(), -36_000, "sale removed → only the 36,000 purchase remains");
  });

  it("final ledger is internally consistent (stock + balance)", () => {
    // المحل 140 + مخزن 20 = 160 = 100 start − 10 sold + 60 bought + 10 sale-cancelled
    assert.equal(totalStock(), 160, "every stock movement accounted for");
    assert.equal(stockOf(SHOP) + stockOf(DEPOT), 160);
  });
});

// ── Weighted-Average Cost on PURCHASE ─────────────────────────────────────────
// Reuses the same faithful in-memory harness above. Verifies the exact example
// the operator asked for: 10 pcs @ cost 200, then buy 10 pcs @ 300 → costPrice
// must become the weighted average 250, and purchasePrice the latest unit cost 300.
describe("purchase weighted-average cost", () => {
  let createInvoice: Function;

  before(async () => {
    ({ createInvoice } = await import("./invoice.service"));
    // Reset the shared product + stock to a clean 10-pcs-at-200 starting point.
    stock.clear();
    stock.set(skey(PROD, SHOP), 10);
    product.pcsPerCarton = 12;
    product.costPrice = 200;
    product.purchasePrice = 200;
    product.salePrice = 1000;
  });

  it("buying 10 pcs @ 300 averages costPrice to 250 and sets purchasePrice to 300", async () => {
    await createInvoice(
      {
        customerId: CUST,
        type: InvoiceType.PURCHASE,
        discount: 0,
        tax: 0,
        paidAmount: 0,
        items: [{ productId: PROD, unit: Unit.PIECE, quantity: 10, unitPrice: 300 }],
      },
      "user-1",
      tx
    );
    // (10×200 + 10×300) / 20 = 250
    assert.equal(Number(product.costPrice), 250, "weighted-average cost");
    // latest purchase unit cost (per piece)
    assert.equal(Number(product.purchasePrice), 300, "purchasePrice = last purchase price");
    assert.equal(totalStock(), 20, "10 existing + 10 bought");
  });

  it("a SECOND purchase keeps averaging against the new running cost", async () => {
    // Now: 20 pcs @ 250. Buy 20 more @ 350 → (20×250 + 20×350)/40 = 300.
    await createInvoice(
      {
        customerId: CUST,
        type: InvoiceType.PURCHASE,
        discount: 0,
        tax: 0,
        paidAmount: 0,
        items: [{ productId: PROD, unit: Unit.PIECE, quantity: 20, unitPrice: 350 }],
      },
      "user-1",
      tx
    );
    assert.equal(Number(product.costPrice), 300, "(20×250 + 20×350)/40 = 300");
    assert.equal(Number(product.purchasePrice), 350, "purchasePrice = last purchase price");
  });
});
