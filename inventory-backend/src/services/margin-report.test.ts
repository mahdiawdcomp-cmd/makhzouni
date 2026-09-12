/**
 * هامش الربح لكل مادة ولكل زبون — the maths, not the plumbing.
 *
 * Three things must hold or the report misleads:
 *  - a sales return subtracts from BOTH revenue and cost,
 *  - an invoice-level discount reduces line revenue proportionally,
 *  - revenue earned on a product with no known cost is reported as such
 *    instead of silently counting as pure profit.
 */
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

type Row = Record<string, any>;
let saleItems: Row[] = [];
let returnItems: Row[] = [];

mock.module("../config/database", {
  exports: {
    default: {
      invoiceItem: {
        findMany: async ({ where }: any) =>
          (where.invoice.type === "SALE" ? saleItems : returnItems).map((r) => ({ ...r })),
      },
    },
  },
});

let getMarginReport: (q: { from?: string; to?: string }) => Promise<any>;

function line(over: Row = {}): Row {
  return {
    invoiceId: "inv-1",
    productId: "p1",
    productName: "دبس",
    itemNumber: "AB0001",
    unit: "PIECE",
    quantity: 10,
    totalPrice: 10_000,
    costPrice: 600,
    product: { costPrice: 600, purchasePrice: 600, pcsPerCarton: 12, boxPieces: null },
    invoice: {
      date: new Date("2026-09-01T09:00:00.000Z"),
      subtotal: 10_000,
      totalAmount: 10_000,
      customerId: "c1",
      customer: { name: "أبو علي", phone: "07700000000" },
    },
    ...over,
  };
}

describe("تقرير الهوامش", () => {
  before(async () => {
    ({ getMarginReport } = await import("./report.service"));
  });

  it("يحسب الربح والهامش لكل مادة ولكل زبون", async () => {
    saleItems = [line()];
    returnItems = [];

    const report = await getMarginReport({});
    const product = report.products[0];
    assert.equal(product.revenue, 10_000);
    assert.equal(product.cost, 6_000, "10 قطع × 600");
    assert.equal(product.profit, 4_000);
    assert.equal(product.margin, 40);
    assert.equal(product.qty, 10);

    const customer = report.customers[0];
    assert.equal(customer.name, "أبو علي");
    assert.equal(customer.profit, 4_000);
    assert.equal(customer.invoices, 1);
    assert.equal(report.totals.profit, 4_000);
  });

  it("المرتجع ينقص الإيراد والكلفة سوة", async () => {
    saleItems = [line()];
    returnItems = [line({ invoiceId: "inv-2", quantity: 4, totalPrice: 4_000 })];

    const report = await getMarginReport({});
    const product = report.products[0];
    assert.equal(product.revenue, 6_000, "10,000 − 4,000");
    assert.equal(product.cost, 3_600, "6,000 − 2,400");
    assert.equal(product.qty, 6);
    assert.equal(product.profit, 2_400);
  });

  it("خصم الفاتورة ينزّل إيراد السطر بنفس النسبة", async () => {
    // A 10,000 line on an invoice discounted from 10,000 to 9,000 earns 9,000.
    saleItems = [line({ invoice: { ...line().invoice, totalAmount: 9_000 } })];
    returnItems = [];

    const report = await getMarginReport({});
    assert.equal(report.products[0].revenue, 9_000);
    assert.equal(report.products[0].profit, 3_000);
  });

  it("يفضح الإيراد الذي لا كلفة له بدل ما يعدّه ربحاً كاملاً", async () => {
    saleItems = [
      line(),
      line({
        invoiceId: "inv-3",
        productId: "p2",
        productName: "بلا كلفة",
        costPrice: 0,
        product: { costPrice: 0, purchasePrice: 0, pcsPerCarton: 12, boxPieces: null },
      }),
    ];
    returnItems = [];

    const report = await getMarginReport({});
    const blind = report.products.find((p: Row) => p.id === "p2");
    assert.equal(blind.cost, 0);
    assert.equal(blind.revenueWithoutCost, 10_000, "كل إيراد هذا السطر بلا كلفة معروفة");
    assert.equal(report.totals.revenueWithoutCost, 10_000);
    assert.equal(report.totals.costCoverage, 50, "نصف الإيراد فقط عنده كلفة");
    // The good line must NOT be flagged.
    assert.equal(report.products.find((p: Row) => p.id === "p1").revenueWithoutCost, 0);
  });

  it("يجمع زبوناً واحداً عبر عدة فواتير", async () => {
    saleItems = [line(), line({ invoiceId: "inv-9" })];
    returnItems = [];

    const report = await getMarginReport({});
    assert.equal(report.customers.length, 1);
    assert.equal(report.customers[0].invoices, 2);
    assert.equal(report.customers[0].profit, 8_000);
  });
});
