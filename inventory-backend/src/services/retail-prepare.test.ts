import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

// ── In-memory fakes ──────────────────────────────────────────────────────────
// We stub the heavy module dependencies (prisma, invoice creation, whatsapp,
// settings, db connection) so we can test the markRetailOrderPrepared
// orchestration — the atomic claim, synchronous invoicing, and rollback — in
// isolation, without a real database.

type Order = {
  id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string | null;
  notes: string | null;
  items: Array<{ productId: string; quantity: number; unitPrice: number }>;
  discount: number;
  total: number;
  status: string;
  invoiceId: string | null;
  preparedAt: Date | null;
  preparedById: string | null;
};

let order: Order;
let createInvoiceCalls = 0;
let createInvoiceImpl: () => Promise<{ id: string; invoiceNumber: string }>;

function freshOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    orderNumber: "R-1001",
    customerName: "زبون",
    phone: "9647700000000",
    address: null,
    notes: null,
    items: [{ productId: "prod-1", quantity: 2, unitPrice: 1000 }],
    discount: 0,
    total: 2000,
    status: "PENDING",
    invoiceId: null,
    preparedAt: null,
    preparedById: null,
    ...overrides,
  };
}

const fakePrisma = {
  retailOrder: {
    // Atomic guard: flip status only when the current status matches the filter.
    updateMany: async ({ where, data }: any) => {
      if (where.id !== order.id) return { count: 0 };
      const allowed: string[] = where.status?.in ?? (where.status ? [where.status] : []);
      if (allowed.length && !allowed.includes(order.status)) return { count: 0 };
      Object.assign(order, data);
      return { count: 1 };
    },
    findUnique: async ({ where }: any) => (where.id === order.id ? { ...order } : null),
    findUniqueOrThrow: async ({ where }: any) => {
      if (where.id !== order.id) throw new Error("not found");
      return { ...order };
    },
    update: async ({ where, data }: any) => {
      if (where.id !== order.id) throw new Error("not found");
      Object.assign(order, data);
      return { ...order };
    },
  },
  customer: {
    findFirst: async () => ({ id: "cust-retail" }),
    create: async () => ({ id: "cust-retail" }),
  },
  invoice: {
    update: async () => ({}),
  },
};

mock.module("../config/database", {
  exports: { default: fakePrisma, ensureConnected: async () => {} },
});
mock.module("./invoice.service", {
  exports: {
    createInvoice: async () => {
      createInvoiceCalls += 1;
      return createInvoiceImpl();
    },
  },
});
mock.module("./whatsapp.service", {
  exports: {
    sendWhatsAppText: async () => {},
    sendWhatsAppImage: async () => {},
  },
});
mock.module("./settings.service", {
  exports: { getSettings: async () => ({}) },
});

// Import AFTER mocks are registered (in a hook — tsconfig emits CJS, so no
// top-level await).
let markRetailOrderPrepared: (orderId: string, userId: string) => Promise<{ id: string; orderNumber: string }>;

describe("markRetailOrderPrepared — invoice safety", () => {
  before(async () => {
    ({ markRetailOrderPrepared } = await import("./retail-catalog.service"));
  });

  beforeEach(() => {
    order = freshOrder();
    createInvoiceCalls = 0;
    createInvoiceImpl = async () => ({ id: "inv-1", invoiceNumber: "INV-1" });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  it("happy path: PENDING order becomes PREPARED with exactly one invoice", async () => {
    const res = await markRetailOrderPrepared(order.id, "user-1");
    assert.equal(res.orderNumber, "R-1001");
    assert.equal(order.status, "PREPARED");
    assert.equal(order.invoiceId, "inv-1");
    assert.equal(order.preparedById, "user-1");
    assert.equal(createInvoiceCalls, 1);
  });

  it("double-click race: only one call invoices, the other is rejected", async () => {
    // Fire two concurrent prepares; the atomic claim must let only one through.
    const results = await Promise.allSettled([
      markRetailOrderPrepared(order.id, "user-1"),
      markRetailOrderPrepared(order.id, "user-2"),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactly one prepare should succeed");
    assert.equal(rejected.length, 1, "the racing prepare should be rejected");
    assert.equal(createInvoiceCalls, 1, "stock/invoice must be created only once");
    assert.equal(order.status, "PREPARED");
  });

  it("invoice failure (e.g. insufficient stock): order ends FAILED, no invoiceId", async () => {
    createInvoiceImpl = async () => {
      throw new Error("INSUFFICIENT_STOCK");
    };
    await assert.rejects(() => markRetailOrderPrepared(order.id, "user-1"));
    assert.equal(order.status, "FAILED");
    assert.equal(order.invoiceId, null);
  });

  it("FAILED order can be retried and then succeeds", async () => {
    order.status = "FAILED";
    const res = await markRetailOrderPrepared(order.id, "user-1");
    assert.equal(res.orderNumber, "R-1001");
    assert.equal(order.status, "PREPARED");
    assert.equal(order.invoiceId, "inv-1");
  });

  it("already PREPARED order is rejected (no second invoice)", async () => {
    order.status = "PREPARED";
    order.invoiceId = "inv-existing";
    await assert.rejects(
      () => markRetailOrderPrepared(order.id, "user-1"),
      /مجهز مسبقاً/,
    );
    assert.equal(createInvoiceCalls, 0);
  });

  it("CANCELLED order is rejected", async () => {
    order.status = "CANCELLED";
    await assert.rejects(() => markRetailOrderPrepared(order.id, "user-1"), /ملغي/);
    assert.equal(createInvoiceCalls, 0);
  });

  it("idempotent: an order already linked to an invoice is not invoiced again", async () => {
    // Status lets it be claimed, but invoiceId is already set → skip creation.
    order.status = "FAILED";
    order.invoiceId = "inv-prev";
    const res = await markRetailOrderPrepared(order.id, "user-1");
    assert.equal(res.orderNumber, "R-1001");
    assert.equal(order.status, "PREPARED");
    assert.equal(createInvoiceCalls, 0, "must not create a second invoice");
    assert.equal(order.invoiceId, "inv-prev");
  });
});
