/**
 * voucher.service — full lifecycle integration test
 *
 * Exercises the REAL exported voucher functions (no module mocks) against a
 * faithful in-memory fake Db, mirroring the pattern in
 * customer-balance-regression.test.ts. Covers exactly the operations the user
 * relies on day-to-day: create RECEIPT / PAYMENT vouchers, edit a voucher,
 * delete (archive) one, cancel one, restore one — and asserts that the
 * customer balance is recomputed correctly after every step.
 *
 * Sign convention (see utils/financial.calculateCustomerBalance):
 *   balance = opening + salesRemaining − purchasesRemaining − receipts + payments
 *   RECEIPT (we received cash)  → reduces what the customer owes us
 *   PAYMENT (we paid the party) → increases the balance
 * Archived OR cancelled vouchers are excluded from the recompute.
 */

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { VoucherType } from "@prisma/client";

// ── In-memory store ───────────────────────────────────────────────────────────
const CUSTOMER_ID = "cust-1";

let customer: any;
let invoices: any[];
let vouchers: any[];
let counters: Map<string, number>;
let voucherSeq: number;

function voucherActive(v: any) {
  return v.archivedAt == null && v.cancelledAt == null;
}

/** Matches the where-clauses the service actually issues against paymentVoucher.aggregate. */
function voucherMatches(v: any, where: any): boolean {
  if (where.customerId !== undefined && v.customerId !== where.customerId) return false;
  if (where.type !== undefined && v.type !== where.type) return false;
  if (where.archivedAt === null && v.archivedAt != null) return false;
  if (where.cancelledAt === null && v.cancelledAt != null) return false;
  return true;
}

function makeDb(): any {
  return {
    // lockCustomer → SELECT ... FOR UPDATE; irrelevant to logic.
    $queryRaw: async () => [],

    counter: {
      upsert: async ({ where, create }: any) => {
        const key = where.key;
        const next = (counters.get(key) ?? (create.value - 1)) + 1;
        counters.set(key, next);
        return { key, value: next };
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

    invoice: {
      aggregate: async ({ where }: any) => {
        const want = where.type;
        const sum = invoices
          .filter((inv) => inv.status === where.status)
          .filter((inv) =>
            typeof want === "string" ? inv.type === want : (want?.in ?? []).includes(inv.type)
          )
          .reduce((s, inv) => s + inv.remainingAmount, 0);
        return { _sum: { remainingAmount: sum } };
      },
      findFirst: async () =>
        invoices.find((inv) => inv.status === "ACTIVE") ?? null,
    },

    paymentVoucher: {
      create: async ({ data }: any) => {
        const v = {
          id: `v-${++voucherSeq}`,
          archivedAt: null,
          cancelledAt: null,
          deletedBy: null,
          deleteReason: null,
          ...data,
          // Prisma `connect` is never used on create here; customerId is passed directly.
        };
        vouchers.push(v);
        return { ...v, customer: { ...customer }, creator: null };
      },
      findUnique: async ({ where }: any) => {
        const v = vouchers.find((x) => x.id === where.id);
        return v ? { ...v } : null;
      },
      findFirst: async ({ where }: any) => {
        // Uniqueness check during number generation.
        if (where?.voucherNumber !== undefined) {
          const v = vouchers.find((x) => x.voucherNumber === where.voucherNumber);
          return v ? { id: v.id } : null;
        }
        // "last voucher" lookup inside recalc.
        const matches = vouchers.filter((x) => voucherMatches(x, where));
        return matches.length ? { ...matches[matches.length - 1] } : null;
      },
      update: async ({ where, data }: any) => {
        const v = vouchers.find((x) => x.id === where.id);
        if (!v) throw new Error(`[fake] voucher ${where.id} not found`);
        if (data.amount !== undefined) v.amount = data.amount;
        if (data.date !== undefined) v.date = data.date;
        if (data.notes !== undefined) v.notes = data.notes;
        if (data.description !== undefined) v.description = data.description;
        if (data.archivedAt !== undefined) v.archivedAt = data.archivedAt;
        if (data.cancelledAt !== undefined) v.cancelledAt = data.cancelledAt;
        if (data.deletedBy !== undefined) v.deletedBy = data.deletedBy;
        if (data.deleteReason !== undefined) v.deleteReason = data.deleteReason;
        if (data.customer?.connect?.id) v.customerId = data.customer.connect.id;
        return { ...v, customer: { ...customer }, creator: null };
      },
      aggregate: async ({ where }: any) => {
        const sum = vouchers
          .filter((v) => voucherMatches(v, where))
          .reduce((s, v) => s + Number(v.amount), 0);
        return { _sum: { amount: sum } };
      },
    },
  };
}

// ── Functions under test (real, unmocked) ─────────────────────────────────────
let createVoucher: Function;
let updateVoucher: Function;
let deleteVoucher: Function;
let cancelVoucher: Function;
let restoreVoucher: Function;

const balance = () => customer.currentBalance;

describe("voucher.service — full lifecycle + balance", () => {
  before(async () => {
    ({ createVoucher, updateVoucher, deleteVoucher, cancelVoucher, restoreVoucher } =
      await import("./voucher.service"));
  });

  beforeEach(() => {
    // Customer owes us 50,000 from one active SALE invoice; opening 0.
    customer = {
      id: CUSTOMER_ID,
      openingBalance: 0,
      currentBalance: 50_000,
      branchId: "branch-1",
      deletedAt: null,
      lastTransactionAt: null,
    };
    invoices = [
      { id: "inv-1", customerId: CUSTOMER_ID, type: "SALE", status: "ACTIVE", remainingAmount: 50_000, date: new Date("2026-01-01") },
    ];
    vouchers = [];
    counters = new Map();
    voucherSeq = 0;
  });

  it("RECEIPT voucher reduces the customer's debt", async () => {
    const db = makeDb();
    await createVoucher({ customerId: CUSTOMER_ID, amount: 20_000, type: VoucherType.RECEIPT }, "user-1", db);
    // 50,000 − 20,000 = 30,000
    assert.equal(balance(), 30_000);
  });

  it("PAYMENT voucher increases the balance (we paid the party)", async () => {
    const db = makeDb();
    await createVoucher({ customerId: CUSTOMER_ID, amount: 5_000, type: VoucherType.PAYMENT }, "user-1", db);
    // 50,000 + 5,000 = 55,000
    assert.equal(balance(), 55_000);
  });

  it("two receipts stack, editing one re-computes the balance", async () => {
    const db = makeDb();
    const v1 = await createVoucher({ customerId: CUSTOMER_ID, amount: 20_000, type: VoucherType.RECEIPT }, "user-1", db);
    await createVoucher({ customerId: CUSTOMER_ID, amount: 10_000, type: VoucherType.RECEIPT }, "user-1", db);
    assert.equal(balance(), 20_000, "50k − 20k − 10k = 20k");

    await updateVoucher(v1.id, { amount: 25_000 }, db);
    // receipts now 25k + 10k = 35k → 50k − 35k = 15k
    assert.equal(balance(), 15_000, "editing the first receipt to 25k → 15k");
  });

  it("deleting (archiving) a voucher restores the balance it had offset", async () => {
    const db = makeDb();
    const v1 = await createVoucher({ customerId: CUSTOMER_ID, amount: 20_000, type: VoucherType.RECEIPT }, "user-1", db);
    await createVoucher({ customerId: CUSTOMER_ID, amount: 10_000, type: VoucherType.RECEIPT }, "user-1", db);
    assert.equal(balance(), 20_000);

    await deleteVoucher(v1.id, db, "user-1", "خطأ إدخال");
    // v1 archived → only the 10k receipt counts → 50k − 10k = 40k
    assert.equal(balance(), 40_000, "archived voucher excluded from balance");
  });

  it("delete is idempotent and keeps the row (audit-safe)", async () => {
    const db = makeDb();
    const v1 = await createVoucher({ customerId: CUSTOMER_ID, amount: 20_000, type: VoucherType.RECEIPT }, "user-1", db);
    await deleteVoucher(v1.id, db, "user-1", "first");
    const after1 = balance();
    await deleteVoucher(v1.id, db, "user-1", "second"); // no-op
    assert.equal(balance(), after1, "second delete does not change the balance");
    assert.equal(vouchers.length, 1, "row retained, never physically removed");
  });

  it("cancel then restore round-trips the balance", async () => {
    const db = makeDb();
    const v1 = await createVoucher({ customerId: CUSTOMER_ID, amount: 30_000, type: VoucherType.RECEIPT }, "user-1", db);
    assert.equal(balance(), 20_000, "50k − 30k = 20k");

    await cancelVoucher(v1.id, db);
    assert.equal(balance(), 50_000, "cancelled voucher excluded → debt back to 50k");

    await restoreVoucher(v1.id, db);
    assert.equal(balance(), 20_000, "restored voucher re-applied → 20k");
  });

  it("cancelling an already-cancelled voucher is rejected", async () => {
    const db = makeDb();
    const v1 = await createVoucher({ customerId: CUSTOMER_ID, amount: 10_000, type: VoucherType.RECEIPT }, "user-1", db);
    await cancelVoucher(v1.id, db);
    await assert.rejects(
      () => cancelVoucher(v1.id, db),
      (err: any) => err.code === "VOUCHER_ALREADY_CANCELLED"
    );
  });

  it("EXPENSE voucher needs no customer and does not touch a customer balance", async () => {
    const db = makeDb();
    const before = balance();
    const v = await createVoucher({ amount: 7_000, type: VoucherType.EXPENSE, branchId: "branch-1" }, "user-1", db);
    assert.equal(v.customerId, null, "expense voucher has no customer");
    assert.equal(balance(), before, "customer balance untouched by an expense");
  });
});
