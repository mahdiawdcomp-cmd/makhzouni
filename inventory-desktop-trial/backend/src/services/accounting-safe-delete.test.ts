import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// Verify the accounting-safe "delete" invariant: hardDeleteInvoice and
// deleteVoucher must NEVER physically remove a row — they archive it. We use a
// fake prisma whose $transaction runs the callback with a spy-backed tx, and
// assert no .delete()/.deleteMany() is ever called while archive metadata is set.

type Call = { args: any[] };

function spy() {
  const calls: Call[] = [];
  const fn = (...args: any[]) => {
    calls.push({ args });
    return undefined;
  };
  (fn as any).calls = calls;
  return fn as ((...a: any[]) => any) & { calls: Call[] };
}

let invoiceRow: any;
let voucherRow: any;
let tx: any;

function makeTx() {
  return {
    invoice: {
      findUnique: async () => (invoiceRow ? { ...invoiceRow } : null),
      update: Object.assign(
        async ({ data }: any) => {
          Object.assign(invoiceRow, data);
          return { ...invoiceRow };
        },
        { calls: [] as Call[] },
      ),
      delete: spy(),
      updateMany: spy(),
    },
    paymentVoucher: {
      findUnique: async () => (voucherRow ? { ...voucherRow } : null),
      update: async ({ data }: any) => {
        Object.assign(voucherRow, data);
        return { ...voucherRow };
      },
      delete: spy(),
    },
    orderPreparation: { deleteMany: spy() },
    couponRedemption: { deleteMany: spy() },
    stockMovement: { deleteMany: spy() },
    invoiceItem: { deleteMany: spy() },
  };
}

const fakePrisma = {
  $transaction: async (cb: any) => cb(tx),
};

mock.module("../config/database", { exports: { default: fakePrisma } });

let hardDeleteInvoice: (id: string, deletedBy?: string, reason?: string) => Promise<any>;
let deleteVoucher: (id: string, db?: any, deletedBy?: string, reason?: string) => Promise<any>;

describe("accounting-safe delete (archive, never physically remove)", () => {
  before(async () => {
    ({ hardDeleteInvoice } = await import("./invoice.service"));
    ({ deleteVoucher } = await import("./voucher.service"));
  });

  beforeEach(() => {
    tx = makeTx();
    // Use already-CANCELLED invoice so the reverse-stock branch is skipped
    // (keeps the test focused on the archive vs delete invariant).
    invoiceRow = {
      id: "inv-1",
      invoiceNumber: "INV-1",
      status: "CANCELLED",
      customerId: "cust-1",
      archivedAt: null,
      deletedBy: null,
      deleteReason: null,
    };
    // EXPENSE voucher (no customer) so the balance-recalc branch is skipped.
    voucherRow = {
      id: "v-1",
      voucherNumber: "PV-1",
      amount: 5000,
      type: "EXPENSE",
      customerId: null,
      cancelledAt: null,
      archivedAt: null,
      deletedBy: null,
      deleteReason: null,
    };
  });

  it("hardDeleteInvoice archives instead of deleting", async () => {
    const res = await hardDeleteInvoice("inv-1", "user-1", "خطأ بالإدخال");
    assert.equal(res.invoiceNumber, "INV-1");
    assert.ok(invoiceRow.archivedAt instanceof Date, "archivedAt must be set");
    assert.equal(invoiceRow.deletedBy, "user-1");
    assert.equal(invoiceRow.deleteReason, "خطأ بالإدخال");
    // The physical-removal calls must never fire.
    assert.equal(tx.invoice.delete.calls.length, 0, "invoice row must not be deleted");
    assert.equal(tx.invoiceItem.deleteMany.calls.length, 0);
    assert.equal(tx.stockMovement.deleteMany.calls.length, 0);
    assert.equal(tx.couponRedemption.deleteMany.calls.length, 0);
  });

  it("hardDeleteInvoice is idempotent on an already-archived invoice", async () => {
    invoiceRow.archivedAt = new Date("2026-01-01");
    invoiceRow.deletedBy = "old-user";
    const res = await hardDeleteInvoice("inv-1", "user-2", "again");
    assert.equal(res.invoiceNumber, "INV-1");
    assert.equal(invoiceRow.deletedBy, "old-user", "must not overwrite original deleter");
    assert.equal(tx.invoice.delete.calls.length, 0);
  });

  it("deleteVoucher archives + cancels instead of deleting", async () => {
    const res = await deleteVoucher("v-1", tx, "user-1", "تكرار");
    assert.equal(res.voucherNumber, "PV-1");
    assert.ok(voucherRow.archivedAt instanceof Date, "archivedAt must be set");
    assert.ok(voucherRow.cancelledAt instanceof Date, "cancelledAt must be set");
    assert.equal(voucherRow.deletedBy, "user-1");
    assert.equal(voucherRow.deleteReason, "تكرار");
    assert.equal(tx.paymentVoucher.delete.calls.length, 0, "voucher row must not be deleted");
  });

  it("deleteVoucher is idempotent on an already-archived voucher", async () => {
    voucherRow.archivedAt = new Date("2026-01-01");
    voucherRow.deletedBy = "old-user";
    await deleteVoucher("v-1", tx, "user-2", "again");
    assert.equal(voucherRow.deletedBy, "old-user");
    assert.equal(tx.paymentVoucher.delete.calls.length, 0);
  });
});
