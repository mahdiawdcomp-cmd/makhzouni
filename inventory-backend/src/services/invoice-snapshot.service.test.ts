/**
 * invoice-snapshot.service — the balance PRINTED on an invoice.
 *
 * Editing an old invoice used to leave every later invoice quoting a previous
 * balance that had stopped being true, while the account statement showed the
 * corrected one. The customer held the wrong paper. These tests pin the walk
 * that keeps the two documents saying the same thing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

let invoices: any[];
let vouchers: any[];
let customer: any;
let updates: Array<{ id: string; previousBalance: number; finalBalance: number }>;

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

function inv(over: Partial<any>) {
  return {
    id: "i1", date: day("2026-09-01"), createdAt: day("2026-09-01"),
    type: "SALE", totalAmount: 0, paidAmount: 0,
    previousBalance: -1, finalBalance: -1,   // deliberately wrong, so a resync shows
    ...over,
  };
}

const fakeDb: any = {
  customer: { findUnique: async () => customer },
  invoice: {
    findMany: async () => invoices.map((i) => ({ ...i })),
    update: async ({ where, data }: any) => {
      updates.push({ id: where.id, previousBalance: data.previousBalance, finalBalance: data.finalBalance });
      const row = invoices.find((i) => i.id === where.id);
      Object.assign(row, data);
      return row;
    },
  },
  paymentVoucher: { findMany: async () => vouchers.map((v) => ({ ...v })) },
};

mock.module("../config/database", { exports: { default: fakeDb } });
mock.module("./daily-assistant.service", {
  exports: { assistantTimezone: () => "UTC", dayKeyInTz: (d: Date) => d.toISOString().slice(0, 10) },
});

let svc: typeof import("./invoice-snapshot.service");

const printed = (id: string) => {
  const row = invoices.find((i) => i.id === id);
  return { prev: Number(row.previousBalance), final: Number(row.finalBalance) };
};

describe("invoice-snapshot.service — الرصيد المطبوع على الفاتورة", () => {
  before(async () => { svc = await import("./invoice-snapshot.service"); });

  beforeEach(() => {
    customer = { openingBalance: 0 };
    invoices = [];
    vouchers = [];
    updates = [];
  });

  it("walks the ledger: each invoice gets the balance before it and after it", async () => {
    invoices = [
      inv({ id: "A", totalAmount: 100000, date: day("2026-09-01"), createdAt: day("2026-09-01") }),
      inv({ id: "B", totalAmount: 50000, date: day("2026-09-03"), createdAt: day("2026-09-03") }),
    ];
    await svc.resyncInvoiceSnapshots(fakeDb, "c1");

    assert.deepEqual(printed("A"), { prev: 0, final: 100000 });
    assert.deepEqual(printed("B"), { prev: 100000, final: 150000 });
  });

  it("editing an OLD invoice moves what every later invoice prints", async () => {
    invoices = [
      inv({ id: "A", totalAmount: 100000, date: day("2026-09-01"), createdAt: day("2026-09-01") }),
      inv({ id: "B", totalAmount: 50000, date: day("2026-09-03"), createdAt: day("2026-09-03") }),
    ];
    await svc.resyncInvoiceSnapshots(fakeDb, "c1");

    // A is rewritten from 100,000 to 200,000, as an edit would.
    invoices.find((i) => i.id === "A").totalAmount = 200000;
    await svc.resyncInvoiceSnapshots(fakeDb, "c1");

    assert.deepEqual(printed("A"), { prev: 0, final: 200000 });
    assert.deepEqual(printed("B"), { prev: 200000, final: 250000 }, "the later invoice follows");
  });

  it("an upfront payment lands inside its own invoice, not after the next one", async () => {
    invoices = [inv({ id: "A", totalAmount: 100000, paidAmount: 40000 })];
    await svc.resyncInvoiceSnapshots(fakeDb, "c1");
    assert.deepEqual(printed("A"), { prev: 0, final: 60000 });
  });

  it("a receipt between two invoices is counted before the second one", async () => {
    invoices = [
      inv({ id: "A", totalAmount: 100000, date: day("2026-09-01"), createdAt: day("2026-09-01") }),
      inv({ id: "B", totalAmount: 50000, date: day("2026-09-05"), createdAt: day("2026-09-05") }),
    ];
    vouchers = [{ date: day("2026-09-03"), createdAt: day("2026-09-03"), type: "RECEIPT", amount: 30000 }];
    await svc.resyncInvoiceSnapshots(fakeDb, "c1");

    assert.deepEqual(printed("B"), { prev: 70000, final: 120000 });
  });

  it("a payment voucher pushes the balance the other way", async () => {
    invoices = [inv({ id: "A", totalAmount: 100000, date: day("2026-09-05"), createdAt: day("2026-09-05") })];
    vouchers = [{ date: day("2026-09-01"), createdAt: day("2026-09-01"), type: "PAYMENT", amount: 20000 }];
    await svc.resyncInvoiceSnapshots(fakeDb, "c1");
    assert.deepEqual(printed("A"), { prev: 20000, final: 120000 });
  });

  it("a purchase is the mirror of a sale", async () => {
    invoices = [inv({ id: "P", type: "PURCHASE", totalAmount: 80000, paidAmount: 30000 })];
    await svc.resyncInvoiceSnapshots(fakeDb, "c1");
    // We owe the supplier 50,000, and a debt of ours is a negative balance.
    assert.deepEqual(printed("P"), { prev: 0, final: -50000 });
  });

  it("the opening balance is where the walk starts", async () => {
    customer = { openingBalance: 25000 };
    invoices = [inv({ id: "A", totalAmount: 10000 })];
    await svc.resyncInvoiceSnapshots(fakeDb, "c1");
    assert.deepEqual(printed("A"), { prev: 25000, final: 35000 });
  });

  it("same-day invoices keep the order they were written in", async () => {
    invoices = [
      inv({ id: "A", totalAmount: 10000, date: day("2026-09-01"), createdAt: new Date("2026-09-01T09:00:00Z") }),
      inv({ id: "B", totalAmount: 20000, date: day("2026-09-01"), createdAt: new Date("2026-09-01T15:00:00Z") }),
    ];
    await svc.resyncInvoiceSnapshots(fakeDb, "c1");
    assert.deepEqual(printed("A"), { prev: 0, final: 10000 });
    assert.deepEqual(printed("B"), { prev: 10000, final: 30000 });
  });

  it("rows that are already right are not rewritten", async () => {
    invoices = [inv({ id: "A", totalAmount: 100000 })];
    await svc.resyncInvoiceSnapshots(fakeDb, "c1");
    const firstPass = updates.length;
    updates = [];

    const again = await svc.resyncInvoiceSnapshots(fakeDb, "c1");
    assert.ok(firstPass > 0, "the first pass corrects the deliberately wrong values");
    assert.equal(again, 0);
    assert.equal(updates.length, 0, "a settled ledger writes nothing");
  });

  it("a client that cannot answer is skipped rather than failing the sale", async () => {
    const narrow: any = { invoice: { findMany: async () => [] } };
    assert.equal(await svc.resyncInvoiceSnapshots(narrow, "c1"), 0);
  });

  it("a customer with a huge ledger is left alone — the till must stay fast", async () => {
    invoices = Array.from({ length: 501 }, (_, i) =>
      inv({ id: `x${i}`, totalAmount: 1000, createdAt: new Date(2026, 0, 1, 0, i) }),
    );
    assert.equal(await svc.resyncInvoiceSnapshots(fakeDb, "walk-in"), 0);
    assert.equal(updates.length, 0);
  });
});
