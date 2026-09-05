/**
 * invoice-count.service — «جرد الفاتورة».
 *
 * The whole point of the feature is an asymmetry that must not drift: a WORKER's
 * count rewrites the invoice on submit, a CUSTOMER's count touches nothing until
 * the owner approves. These tests pin that, plus the money rules around it —
 * the unit price never moves, a zero line disappears, and a paid invoice that
 * shrinks records cash owed back instead of quietly keeping it.
 *
 * Uses an in-memory fake for `../config/database` and captures the payload sent
 * to updateInvoice, so the real service logic runs without a live database.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const INVOICE_ID = "inv-1";
const OWNER = "user-owner";
const CREATOR = "user-creator";

let links: Map<string, any>;
let editLocks: Map<string, any>;
let invoice: any;
let updateInvoiceCalls: any[];
// What each coupon code is worth, so the fake engine can double-charge it the
// way the real one would if a count ever re-sent the code.
const couponValues: Record<string, number> = { SAVE10: 10000 };
let approvalCalls: any[];
let notifyCalls: any[];
let whatsappCalls: any[];
let idCounter: number;

const nextId = () => `link-${++idCounter}`;

function makeItem(over: Partial<any> = {}) {
  return {
    id: "item-1",
    productId: "prod-1",
    productName: "شاحن سريع",
    itemNumber: "A-1",
    unit: "CARTON",
    quantity: 1,
    unitPrice: 240000,
    totalPrice: 240000,
    notes: null,
    warehouseId: "wh-1",
    product: { itemNumber: "A-1", pcsPerCarton: 240, boxPieces: null },
    ...over,
  };
}

function resetInvoice(over: Partial<any> = {}) {
  invoice = {
    id: INVOICE_ID,
    invoiceNumber: "INV-1",
    date: new Date("2026-09-05"),
    type: "SALE",
    status: "ACTIVE",
    archivedAt: null,
    customerId: "cust-1",
    customer: { name: "محل الرافدين", phone: "07700000000" },
    paymentType: "CASH",
    notes: null,
    branchId: null,
    subtotal: 240000,
    discount: 0,
    tax: 0,
    totalAmount: 240000,
    paidAmount: 240000,
    remainingAmount: 0,
    previousBalance: 0,
    finalBalance: 0,
    createdBy: CREATOR,
    coupon: null,
    items: [makeItem()],
    ...over,
  };
}

function matchWhere(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "in" in (value as any)) {
      return (value as any).in.includes(row[key]);
    }
    return row[key] === value;
  });
}

const fakeDb: any = {
  invoice: {
    findUnique: async ({ where }: any) => (where.id === INVOICE_ID ? { ...invoice } : null),
  },
  invoiceCountLink: {
    create: async ({ data }: any) => {
      const row = {
        id: nextId(),
        status: "OPEN",
        createdAt: new Date(),
        firstViewedAt: null,
        lastViewedAt: null,
        viewCount: 0,
        submittedAt: null,
        revokedAt: null,
        result: null,
        hasDifference: false,
        appliedAt: null,
        approvalId: null,
        refundDue: null,
        refundAckAt: null,
        refundAckBy: null,
        recipientId: null,
        recipientPhone: null,
        ...data,
      };
      links.set(row.id, row);
      return { ...row };
    },
    findUnique: async ({ where }: any) => {
      const row = where.id
        ? links.get(where.id)
        : [...links.values()].find((l) => l.token === where.token);
      return row ? { ...row } : null;
    },
    findMany: async ({ where }: any) =>
      [...links.values()].filter((l) => matchWhere(l, where)).map((l) => ({ ...l })),
    update: async ({ where, data }: any) => {
      const row = links.get(where.id);
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === "object" && "increment" in (value as any)) {
          row[key] = (row[key] ?? 0) + (value as any).increment;
        } else {
          row[key] = value;
        }
      }
      return { ...row };
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of links.values()) {
        if (!matchWhere(row, where)) continue;
        Object.assign(row, data);
        count += 1;
      }
      return { count };
    },
  },
  product: {
    // The counting view fetches thumbnails separately (getInvoiceById never
    // selects the base64 image columns), so the fake has to answer that too.
    findMany: async ({ where }: any) =>
      (where?.id?.in ?? []).map((id: string) => ({ id, thumbnailUrl: `data:image/png;base64,${id}` })),
  },
  invoiceEditLock: {
    findUnique: async ({ where }: any) => {
      const row = editLocks.get(where.invoiceId);
      return row ? { ...row } : null;
    },
    upsert: async ({ where, create, update }: any) => {
      const existing = editLocks.get(where.invoiceId);
      const row = existing ? { ...existing, ...update } : { ...create };
      editLocks.set(where.invoiceId, row);
      return { ...row };
    },
    deleteMany: async ({ where }: any) => {
      const row = editLocks.get(where.invoiceId);
      if (row && row.userId === where.userId) editLocks.delete(where.invoiceId);
      return { count: row ? 1 : 0 };
    },
  },
  $transaction: async (fn: any) => fn(fakeDb),
};

mock.module("../config/database", { exports: { default: fakeDb } });

mock.module("./settings.service", {
  exports: {
    getSettings: async () => ({
      storeName: "مخزوني",
      currency: "د.ع",
      adminApprovalWhatsappNumber: "07799999999",
      preparationWorkers: [
        { id: "w-1", name: "رسول", phone: "07711111111", active: true },
        { id: "w-2", name: "عامل موقوف", phone: "07722222222", active: false },
      ],
    }),
  },
});

mock.module("./approval.service", {
  exports: {
    approvalRequestTypes: { INVOICE_COUNT_ADJUSTMENT: "INVOICE_COUNT_ADJUSTMENT" },
    createPendingApproval: async (requestType: string, requestData: any, requestedBy: string, requesterName?: string) => {
      approvalCalls.push({ requestType, requestData, requestedBy, requesterName });
      return { id: `approval-${approvalCalls.length}` };
    },
  },
});

mock.module("./app-notification.service", {
  exports: {
    notifyAdmin: async (input: any) => { notifyCalls.push(input); return {}; },
    buildDedupeKey: (type: string, entityId?: string | null) => `${type}:${entityId ?? "-"}`,
  },
});

mock.module("./whatsapp.service", {
  exports: {
    sendWhatsAppText: async (to: string, message: string) => { whatsappCalls.push({ to, message }); return {}; },
  },
});

mock.module("./invoice.service", {
  exports: {
    getInvoiceById: async () => ({ ...invoice }),
    updateInvoice: async (id: string, input: any, updatedBy: string) => {
      updateInvoiceCalls.push({ id, input, updatedBy });
      const subtotal = input.items.reduce(
        (sum: number, i: any) => sum + Math.round(i.unitPrice * i.quantity * 100) / 100, 0,
      );
      // Faithful to createInvoiceInTransaction: a coupon code is charged ON TOP
      // of the discount it is given, and paid is clamped to the total.
      const couponValue = input.couponCode ? (couponValues[input.couponCode] ?? 0) : 0;
      const discount = Math.min(subtotal, input.discount + couponValue);
      const total = Math.round((subtotal - discount + input.tax) * 100) / 100;
      const paidAmount = Math.min(input.paidAmount, Math.max(0, total));
      return { ...invoice, subtotal, discount, totalAmount: total, paidAmount };
    },
  },
});

let svc: typeof import("./invoice-count.service");

async function mintLink(audience: "WORKER" | "CUSTOMER") {
  return svc.createCountLink({
    invoiceId: INVOICE_ID,
    audience: audience as any,
    workerId: audience === "WORKER" ? "w-1" : undefined,
    createdBy: OWNER,
  });
}

describe("invoice-count.service — «جرد الفاتورة»", () => {
  before(async () => {
    svc = await import("./invoice-count.service");
  });

  beforeEach(() => {
    links = new Map();
    editLocks = new Map();
    updateInvoiceCalls = [];
    approvalCalls = [];
    notifyCalls = [];
    whatsappCalls = [];
    idCounter = 0;
    resetInvoice();
  });

  // ── Link lifecycle ─────────────────────────────────────────────────────────

  it("mints a link per audience with the right lifetime and a snapshotted recipient", async () => {
    const worker = await mintLink("WORKER");
    const customer = await mintLink("CUSTOMER");

    assert.equal(worker.recipientName, "رسول");
    assert.equal(worker.recipientId, "w-1");
    assert.equal(customer.recipientName, "محل الرافدين");
    assert.equal(customer.recipientPhone, "07700000000");

    const hours = (l: any) => Math.round((l.expiresAt.getTime() - l.createdAt.getTime()) / 3600_000);
    assert.equal(hours(worker), 24, "a worker counts the same day");
    assert.equal(hours(customer), 72, "a customer gets three days");
    assert.notEqual(worker.token, customer.token);
  });

  it("a second link for the same audience revokes the first — two counters cannot overwrite each other", async () => {
    const first = await mintLink("WORKER");
    const second = await mintLink("WORKER");

    assert.equal(links.get(first.id).status, "REVOKED");
    assert.equal(links.get(second.id).status, "OPEN");
  });

  it("a link for the other audience is left alone", async () => {
    const customer = await mintLink("CUSTOMER");
    await mintLink("WORKER");
    assert.equal(links.get(customer.id).status, "OPEN");
  });

  it("refuses an inactive worker, a customer with no phone, and a closed invoice", async () => {
    await assert.rejects(
      () => svc.createCountLink({ invoiceId: INVOICE_ID, audience: "WORKER" as any, workerId: "w-2", createdBy: OWNER }),
      /عاملاً مفعّلاً|WORKER_NOT_FOUND/,
    );

    resetInvoice({ customer: { name: "زبون", phone: "" } });
    await assert.rejects(() => mintLink("CUSTOMER"), /رقم هاتف|CUSTOMER_HAS_NO_PHONE/);

    resetInvoice({ status: "CANCELLED" });
    await assert.rejects(() => mintLink("WORKER"), /ملغاة|INVOICE_CLOSED/);
  });

  it("opening the link records that it was opened — «never opened» has to be a fact", async () => {
    const link = await mintLink("WORKER");
    assert.equal(links.get(link.id).viewCount, 0);
    assert.equal(links.get(link.id).firstViewedAt, null);

    await svc.getCountLinkByToken(link.token, true);
    await svc.getCountLinkByToken(link.token, true);

    const stored = links.get(link.id);
    assert.equal(stored.viewCount, 2);
    assert.equal(stored.status, "VIEWED");
    assert.ok(stored.firstViewedAt, "the first open is kept separately from the last");
    assert.ok(stored.lastViewedAt.getTime() >= stored.firstViewedAt.getTime());
  });

  it("a plain status poll does not count as an open", async () => {
    const link = await mintLink("WORKER");
    await svc.getCountLinkByToken(link.token, false);
    assert.equal(links.get(link.id).viewCount, 0);
  });

  it("the counting view never exposes cost or profit", async () => {
    const link = await mintLink("CUSTOMER");
    const view = await svc.getCountLinkByToken(link.token, true);
    const json = JSON.stringify(view);
    for (const forbidden of ["costPrice", "purchasePrice", "profit", "margin"]) {
      assert.ok(!json.includes(forbidden), `counting view must not carry ${forbidden}`);
    }
    assert.equal(view.invoice.lines[0].expectedPieces, 240, "one carton of 240 is 240 pieces");
    assert.ok(view.invoice.lines[0].imageUrl, "the product photo travels with the line — goods are identified by sight");
  });

  // ── Submission gates ───────────────────────────────────────────────────────

  it("refuses a submission that skips a line — «I forgot it» must not read as «all of it came»", async () => {
    resetInvoice({ items: [makeItem(), makeItem({ id: "item-2", productId: "prod-2" })] });
    const link = await mintLink("WORKER");
    await assert.rejects(
      () => svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 240 }]),
      /بقيت 1 مادة|COUNT_INCOMPLETE/,
    );
    assert.equal(updateInvoiceCalls.length, 0);
  });

  it("zero IS an answer — it does not count as a missing line", async () => {
    resetInvoice({ items: [makeItem(), makeItem({ id: "item-2", productId: "prod-2" })], paidAmount: 0 });
    const link = await mintLink("WORKER");
    const res = await svc.submitCount(link.token, [
      { itemId: "item-1", receivedPieces: 0 },
      { itemId: "item-2", receivedPieces: 240 },
    ]);
    assert.equal(res.hasDifference, true);
  });

  it("refuses a negative received quantity", async () => {
    const link = await mintLink("WORKER");
    await assert.rejects(
      () => svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: -5 }]),
      /غير صحيحة|INVALID_RECEIVED_QUANTITY/,
    );
  });

  it("a link can only be submitted once", async () => {
    const link = await mintLink("WORKER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 240 }]);
    await assert.rejects(
      () => svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 200 }]),
      /مسبقاً|SUBMITTED/,
    );
  });

  it("an expired or revoked link cannot be counted on", async () => {
    const expired = await mintLink("WORKER");
    links.get(expired.id).expiresAt = new Date(Date.now() - 1000);
    await assert.rejects(
      () => svc.submitCount(expired.token, [{ itemId: "item-1", receivedPieces: 240 }]),
      /انتهت مدة|EXPIRED/,
    );

    const revoked = await mintLink("CUSTOMER");
    await svc.revokeCountLink(revoked.id);
    await assert.rejects(
      () => svc.submitCount(revoked.token, [{ itemId: "item-1", receivedPieces: 240 }]),
      /لم يعد صالحاً|REVOKED/,
    );
  });

  it("a submitted link cannot be revoked away afterwards", async () => {
    const link = await mintLink("WORKER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 240 }]);
    await assert.rejects(() => svc.revokeCountLink(link.id), /تم الجرد|COUNT_LINK_SUBMITTED/);
  });

  // ── The asymmetry ──────────────────────────────────────────────────────────

  it("a WORKER's count rewrites the invoice immediately", async () => {
    const link = await mintLink("WORKER");
    const res = await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);

    assert.equal(res.applied, true);
    assert.equal(updateInvoiceCalls.length, 1);
    assert.ok(links.get(link.id).appliedAt, "appliedAt is stamped");
  });

  it("a CUSTOMER's count changes nothing — it waits for the owner", async () => {
    const link = await mintLink("CUSTOMER");
    const res = await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);

    assert.equal(res.applied, false);
    assert.equal(res.hasDifference, true);
    assert.equal(updateInvoiceCalls.length, 0, "the invoice must not move before approval");
    assert.equal(links.get(link.id).appliedAt, null);
    assert.equal(links.get(link.id).status, "SUBMITTED");
  });

  it("a matching worker count touches nothing but is still recorded", async () => {
    const link = await mintLink("WORKER");
    const res = await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 240 }]);

    assert.equal(res.hasDifference, false);
    assert.equal(updateInvoiceCalls.length, 0, "nothing to change when the count matches");
    assert.equal(links.get(link.id).status, "SUBMITTED");
    assert.equal(links.get(link.id).hasDifference, false);
  });

  it("the stored result freezes what the invoice said at counting time", async () => {
    const link = await mintLink("CUSTOMER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);

    const result = links.get(link.id).result;
    assert.equal(result.differenceCount, 1);
    assert.equal(result.totalBefore, 240000);
    assert.deepEqual(
      { expected: result.lines[0].expectedPieces, received: result.lines[0].receivedPieces, diff: result.lines[0].differencePieces },
      { expected: 240, received: 210, diff: -30 },
    );
    assert.equal(result.lines[0].itemNumber, "A-1");
  });

  // ── Applying the count ─────────────────────────────────────────────────────

  it("keeps the price per piece identical when the count breaks a carton", async () => {
    const link = await mintLink("WORKER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);

    const item = updateInvoiceCalls[0].input.items[0];
    assert.equal(item.unit, "PIECE", "210 of 240 is not a whole carton");
    assert.equal(item.quantity, 210);
    assert.equal(item.unitPrice, 1000, "240,000 per carton of 240 is 1,000 per piece");
    assert.equal(item.unitPrice * item.quantity, 210000);
  });

  it("keeps whole cartons in cartons", async () => {
    resetInvoice({ items: [makeItem({ quantity: 3, unitPrice: 240000, totalPrice: 720000 })], totalAmount: 720000, paidAmount: 0 });
    const link = await mintLink("WORKER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 480 }]);

    const item = updateInvoiceCalls[0].input.items[0];
    assert.deepEqual(
      { unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice },
      { unit: "CARTON", quantity: 2, unitPrice: 240000 },
    );
  });

  it("a line counted at zero is removed, not left sitting at zero", async () => {
    resetInvoice({
      items: [makeItem(), makeItem({ id: "item-2", productId: "prod-2", productName: "كيبل" })],
      paidAmount: 0,
    });
    const link = await mintLink("WORKER");
    await svc.submitCount(link.token, [
      { itemId: "item-1", receivedPieces: 0 },
      { itemId: "item-2", receivedPieces: 240 },
    ]);

    const items = updateInvoiceCalls[0].input.items;
    assert.equal(items.length, 1);
    assert.equal(items[0].productId, "prod-2");
  });

  it("refuses to zero out every line — that is a cancellation, not a count", async () => {
    const link = await mintLink("WORKER");
    await assert.rejects(
      () => svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 0 }]),
      /ألغِ الفاتورة|COUNT_EMPTIES_INVOICE/,
    );
  });

  it("counting more than was sent is allowed and applied", async () => {
    resetInvoice({ paidAmount: 0 });
    const link = await mintLink("WORKER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 250 }]);

    const item = updateInvoiceCalls[0].input.items[0];
    assert.equal(item.quantity, 250);
    assert.equal(item.unit, "PIECE");
  });

  it("never blocks on stock — the goods have already moved by the time anyone counts", async () => {
    const link = await mintLink("WORKER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 250 }]);
    assert.equal(updateInvoiceCalls[0].input.items[0].allowNegativeStock, true);
  });

  // ── The money ──────────────────────────────────────────────────────────────

  it("a paid invoice that shrinks records cash owed back to the customer", async () => {
    const link = await mintLink("WORKER"); // paid 240,000 in full
    const res = await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);

    assert.equal(res.outcome?.refundDue, 30000, "240,000 paid against a 210,000 invoice");
    assert.equal(updateInvoiceCalls[0].input.paidAmount, 210000, "paid is lowered to the new total");
    assert.equal(Number(links.get(link.id).refundDue), 30000, "and the debt to the customer is kept");
  });

  it("an unpaid invoice owes nothing back", async () => {
    resetInvoice({ paidAmount: 0, paymentType: "CREDIT" });
    const link = await mintLink("WORKER");
    const res = await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);

    assert.equal(res.outcome?.refundDue, 0);
    assert.equal(updateInvoiceCalls[0].input.paidAmount, 0);
    assert.equal(links.get(link.id).refundDue, null);
  });

  it("a partly paid invoice only owes back what exceeds the new total", async () => {
    resetInvoice({ paidAmount: 220000, paymentType: "PARTIAL" });
    const link = await mintLink("WORKER");
    const res = await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);

    assert.equal(res.outcome?.refundDue, 10000);
    assert.equal(updateInvoiceCalls[0].input.paidAmount, 210000);
  });

  it("a fixed discount can never drive the shrunken invoice negative", async () => {
    resetInvoice({ discount: 200000, totalAmount: 40000, paidAmount: 0 });
    const link = await mintLink("WORKER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 24 }]); // 24,000 of goods

    assert.equal(updateInvoiceCalls[0].input.discount, 24000, "the discount is clamped to what is left");
  });

  it("acknowledging the refund stamps who returned the money, and is idempotent", async () => {
    const link = await mintLink("WORKER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);

    const acked = await svc.acknowledgeRefund(link.id, OWNER);
    assert.ok(acked.refundAckAt);
    assert.equal(acked.refundAckBy, OWNER);

    const again = await svc.acknowledgeRefund(link.id, "someone-else");
    assert.equal(again.refundAckBy, OWNER, "the first acknowledgement stands");
  });

  it("there is nothing to acknowledge when no money is owed", async () => {
    resetInvoice({ paidAmount: 0 });
    const link = await mintLink("WORKER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);
    await assert.rejects(() => svc.acknowledgeRefund(link.id, OWNER), /لا يوجد مبلغ|NO_REFUND_DUE/);
  });

  // ── Edit lock ──────────────────────────────────────────────────────────────

  it("counting is held back while someone in the shop is editing the invoice", async () => {
    const link = await mintLink("CUSTOMER");
    await svc.touchEditLock(INVOICE_ID, OWNER, "مهدي عوض");

    const view = await svc.getCountLinkByToken(link.token, true);
    assert.equal(view.editingBy, "مهدي عوض");

    await assert.rejects(
      () => svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]),
      /مهدي عوض يعدّل|INVOICE_BEING_EDITED/,
    );
  });

  it("an abandoned edit tab stops blocking on its own", async () => {
    const link = await mintLink("CUSTOMER");
    await svc.touchEditLock(INVOICE_ID, OWNER, "مهدي عوض");
    editLocks.get(INVOICE_ID).heartbeatAt = new Date(Date.now() - svc.EDIT_LOCK_STALE_MS - 1000);

    const view = await svc.getCountLinkByToken(link.token, true);
    assert.equal(view.editingBy, null);
    const res = await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);
    assert.equal(res.hasDifference, true);
  });

  it("releasing the lock only removes your own", async () => {
    await svc.touchEditLock(INVOICE_ID, OWNER, "مهدي");
    await svc.releaseEditLock(INVOICE_ID, "another-user");
    assert.ok(await svc.getActiveEditLock(INVOICE_ID), "someone else's lock is not yours to drop");

    await svc.releaseEditLock(INVOICE_ID, OWNER);
    assert.equal(await svc.getActiveEditLock(INVOICE_ID), null);
  });

  // ── Status strip ───────────────────────────────────────────────────────────

  it("a link that ran out while nobody was looking still reads as expired", async () => {
    const link = await mintLink("WORKER");
    links.get(link.id).expiresAt = new Date(Date.now() - 1000);

    const [row] = await svc.listCountLinks(INVOICE_ID);
    assert.equal(row.status, "EXPIRED");
  });

  it("a submitted link keeps its status regardless of the clock", async () => {
    const link = await mintLink("WORKER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 240 }]);
    links.get(link.id).expiresAt = new Date(Date.now() - 1000);

    const [row] = await svc.listCountLinks(INVOICE_ID);
    assert.equal(row.status, "SUBMITTED");
  });

  // ── Unit rebuilding, directly ──────────────────────────────────────────────


  // ── Telling the shop (phase 3) ─────────────────────────────────────────────

  it("a customer's difference becomes an approval the owner has to act on", async () => {
    const link = await mintLink("CUSTOMER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);

    assert.equal(approvalCalls.length, 1);
    assert.equal(approvalCalls[0].requestType, "INVOICE_COUNT_ADJUSTMENT");
    assert.equal(approvalCalls[0].requestData.linkId, link.id);
    assert.equal(approvalCalls[0].requestData.differenceCount, 1);
    // The approvals table needs a staff member; a customer is not one, so the
    // request is attributed to whoever wrote the invoice.
    assert.equal(approvalCalls[0].requestedBy, CREATOR);
    assert.equal(links.get(link.id).approvalId, "approval-1");
  });

  it("a customer's matching count raises no approval — there is nothing to decide", async () => {
    const link = await mintLink("CUSTOMER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 240 }]);
    assert.equal(approvalCalls.length, 0);
  });

  it("a worker's count never raises an approval — it already happened", async () => {
    const link = await mintLink("WORKER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);
    assert.equal(approvalCalls.length, 0);
  });

  it("every count lands in the counting notification box", async () => {
    const link = await mintLink("WORKER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);

    const submitted = notifyCalls.find((n) => n.type === "INVOICE_COUNT_SUBMITTED");
    assert.ok(submitted, "a count is always reported");
    assert.equal(submitted.severity, "COUNT");
    assert.equal(submitted.category, "INVOICE_COUNT");
    assert.match(submitted.message, /رسول/);
    assert.match(submitted.message, /تعدّلت الفاتورة/);
  });

  it("money owed back to the customer gets its own notification", async () => {
    const link = await mintLink("WORKER"); // paid in full
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);

    const refund = notifyCalls.find((n) => n.type === "INVOICE_COUNT_REFUND_DUE");
    assert.ok(refund, "a paid invoice that shrank must say so");
    assert.match(refund.message, /30,000/);
  });

  it("only the customer's word reaches the owner's phone", async () => {
    const worker = await mintLink("WORKER");
    await svc.submitCount(worker.token, [{ itemId: "item-1", receivedPieces: 210 }]);
    assert.equal(whatsappCalls.length, 0, "in-house counting must not buzz the phone");

    resetInvoice();
    const customer = await mintLink("CUSTOMER");
    await svc.submitCount(customer.token, [{ itemId: "item-1", receivedPieces: 210 }]);
    assert.equal(whatsappCalls.length, 1);
    assert.equal(whatsappCalls[0].to, "07799999999");
    assert.match(whatsappCalls[0].message, /الزبون محل الرافدين/);
    assert.match(whatsappCalls[0].message, /لم تتغيّر بعد/);
  });

  // ── Approving the customer's count ─────────────────────────────────────────

  it("approving applies the count that was frozen at submit time", async () => {
    const link = await mintLink("CUSTOMER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);
    assert.equal(updateInvoiceCalls.length, 0);

    const outcome = await svc.applyCustomerCount(link.id, OWNER);

    assert.equal(updateInvoiceCalls.length, 1);
    assert.equal(updateInvoiceCalls[0].input.items[0].quantity, 210);
    assert.equal((outcome as any).refundDue, 30000);
    assert.ok(links.get(link.id).appliedAt);
    assert.equal(Number(links.get(link.id).refundDue), 30000);
  });

  it("the refund reminder fires on approval, not on submit — nothing was owed before", async () => {
    const link = await mintLink("CUSTOMER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);
    assert.equal(
      notifyCalls.filter((n) => n.type === "INVOICE_COUNT_REFUND_DUE").length, 0,
      "no money has moved while the count is still pending",
    );

    await svc.applyCustomerCount(link.id, OWNER);
    await new Promise((resolve) => setImmediate(resolve));

    const refund = notifyCalls.find((n) => n.type === "INVOICE_COUNT_REFUND_DUE");
    assert.ok(refund, "once approved, the cash owed back has to be surfaced");
    assert.match(refund.message, /30,000/);
  });

  it("approving twice does not apply the count twice", async () => {
    const link = await mintLink("CUSTOMER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);
    await svc.applyCustomerCount(link.id, OWNER);
    const second = await svc.applyCustomerCount(link.id, OWNER);

    assert.deepEqual(second, { alreadyApplied: true });
    assert.equal(updateInvoiceCalls.length, 1);
  });

  it("rejecting changes nothing — the invoice is simply never touched", async () => {
    const link = await mintLink("CUSTOMER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);
    // A rejection never calls applyCustomerCount at all.
    assert.equal(updateInvoiceCalls.length, 0);
    assert.equal(links.get(link.id).appliedAt, null);
    assert.equal(links.get(link.id).status, "SUBMITTED");
  });

  it("an empty or unknown count record cannot be approved into effect", async () => {
    await assert.rejects(() => svc.applyCustomerCount("nope", OWNER), /غير موجود|COUNT_LINK_NOT_FOUND/);

    const link = await mintLink("CUSTOMER");
    await assert.rejects(() => svc.applyCustomerCount(link.id, OWNER), /فارغ|COUNT_RESULT_EMPTY/);
  });


  // ── The money, audited ─────────────────────────────────────────────────────

  it("a coupon is never charged a second time by a count", async () => {
    // 240,000 of goods, 15,000 already discounted — 10,000 of it the coupon's.
    resetInvoice({ discount: 15000, totalAmount: 225000, paidAmount: 0, coupon: { code: "SAVE10" } });
    const link = await mintLink("WORKER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 240 - 24 }]);

    const input = updateInvoiceCalls[0].input;
    assert.equal(input.couponCode, undefined, "the code must not be re-sent — its value is already in the discount");
    assert.equal(input.discount, 15000, "every dinar of the original discount is carried forward");
  });

  it("the discount is clamped so a shrunken invoice can never go negative", async () => {
    resetInvoice({ discount: 200000, totalAmount: 40000, paidAmount: 0 });
    const link = await mintLink("WORKER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 24 }]); // 24,000 of goods
    assert.equal(updateInvoiceCalls[0].input.discount, 24000);
  });

  it("the price per piece survives a broken carton to the dinar", async () => {
    // 100,000 a carton of 240 => 416.67 a piece. 210 pieces => 87,500.70.
    resetInvoice({ items: [makeItem({ unitPrice: 100000, totalPrice: 100000 })], totalAmount: 100000, paidAmount: 0 });
    const link = await mintLink("WORKER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 210 }]);

    const item = updateInvoiceCalls[0].input.items[0];
    assert.equal(item.unitPrice, 416.67, "rounded to the money scale, not to a whole dinar");
    const exact = (100000 / 240) * 210;
    const charged = item.unitPrice * item.quantity;
    assert.ok(Math.abs(charged - exact) < 1, `drift must stay under a dinar (was ${Math.abs(charged - exact)})`);
  });

  it("what is owed back is read off the invoice, not off a guess", async () => {
    resetInvoice({ paidAmount: 240000, totalAmount: 240000 });
    const link = await mintLink("WORKER");
    const res = await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 120 }]);

    const stored = updateInvoiceCalls[0];
    // 120 of 240 at 240,000 a carton => 120,000 of goods.
    assert.equal(res.outcome?.totalAfter, 120000);
    assert.equal(res.outcome?.refundDue, 120000, "240,000 paid against a 120,000 invoice");
    assert.equal(stored.input.paidAmount, 120000, "paid is brought down to the new total");
  });

  it("two counts on one invoice never hand back the same dinar twice", async () => {
    // Worker: 240,000 paid, invoice falls to 210,000 => 30,000 owed.
    const first = await mintLink("WORKER");
    const firstRes = await svc.submitCount(first.token, [{ itemId: "item-1", receivedPieces: 210 }]);
    assert.equal(firstRes.outcome?.refundDue, 30000);

    // The invoice now stands at 210,000 with 210,000 paid. A second count takes
    // it to 200,000 => only the further 10,000 is owed, not another 30,000.
    resetInvoice({
      items: [makeItem({ unit: "PIECE", quantity: 210, unitPrice: 1000, totalPrice: 210000 })],
      totalAmount: 210000, paidAmount: 210000,
    });
    const second = await mintLink("WORKER");
    const secondRes = await svc.submitCount(second.token, [{ itemId: "item-1", receivedPieces: 200 }]);

    assert.equal(secondRes.outcome?.refundDue, 10000);
    // 30,000 + 10,000 handed back against 240,000 paid on a 200,000 invoice.
    assert.equal(240000 - 200000, 30000 + 10000);
  });

  it("an invoice that grows owes nothing back and keeps what was paid", async () => {
    resetInvoice({ paidAmount: 240000, totalAmount: 240000 });
    const link = await mintLink("WORKER");
    const res = await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 250 }]);

    assert.equal(res.outcome?.refundDue, 0);
    assert.equal(updateInvoiceCalls[0].input.paidAmount, 240000, "the customer's payment is left alone");
  });

  it("the tax rides through untouched", async () => {
    resetInvoice({ tax: 5000, totalAmount: 245000, paidAmount: 0 });
    const link = await mintLink("WORKER");
    await svc.submitCount(link.token, [{ itemId: "item-1", receivedPieces: 120 }]);
    assert.equal(updateInvoiceCalls[0].input.tax, 5000);
  });

  it("counting is refused on anything that is not a sale", async () => {
    resetInvoice({ type: "PURCHASE" });
    await assert.rejects(() => mintLink("WORKER"), /فواتير البيع فقط|NOT_A_SALE_INVOICE/);
  });

  it("rebuildLine picks the largest unit that divides exactly, at an unchanged piece price", () => {
    // 240 per carton, 240,000 per carton => 1,000 per piece.
    assert.deepEqual(svc.rebuildLine("CARTON" as any, 240000, 480, 240), { unit: "CARTON", quantity: 2, unitPrice: 240000 });
    assert.deepEqual(svc.rebuildLine("CARTON" as any, 240000, 210, 240), { unit: "PIECE", quantity: 210, unitPrice: 1000 });
    // 120 pieces divides by the derived box size (120) before it reaches dozens.
    assert.deepEqual(svc.rebuildLine("CARTON" as any, 240000, 120, 240), { unit: "BOX", quantity: 1, unitPrice: 120000 });
    // A piece line stays a piece line.
    assert.deepEqual(svc.rebuildLine("PIECE" as any, 1000, 7, 240), { unit: "PIECE", quantity: 7, unitPrice: 1000 });
  });
});
