/**
 * cycle-count.service — "جدولة الجرد الذكي" (scheduled smart cycle count).
 *
 * Fully independent feature from the manual stocktake flow (stocktake.service.ts,
 * untouched by this work). Uses a faithful in-memory fake for `../config/database`
 * (same pattern as transfer-conservation.test.ts) so these tests exercise the
 * REAL service logic — selection strategies, session lifecycle, the worker
 * public link, admin review (single/bulk approve-reject), and the
 * approve-writes-StockMovement / reject-never-touches-stock invariant —
 * without a live database.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const WAREHOUSE = "wh-1";
const OTHER_WAREHOUSE = "wh-2";
const ADMIN_USER = "user-admin";

// ── In-memory fake store ──────────────────────────────────────────────────────
let branches: Map<string, any>;
let products: Map<string, any>;
let stocks: Map<string, any>; // key: `${productId}:${warehouseId}`
let sessions: Map<string, any>;
let items: Map<string, any>;
let movements: any[];
let users: Map<string, any>;
let settingsStore: Map<string, unknown>;
let idCounter: number;
let notifyAdminCalls: any[];
// Added for the stock-adjustment financial-trace wiring: recordStockAdjustmentVariance
// (called whenever an approval has a nonzero delta) writes a StockLoss + StockLossItem
// via generateLossNumber's counter upsert — all faked here the same faithful way as the
// rest of this in-memory store.
let stockLosses: Map<string, any>;
let stockLossItems: any[];
let counters: Map<string, number>;

function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function stockKey(productId: string, warehouseId: string) {
  return `${productId}:${warehouseId}`;
}

function attachSession(session: any) {
  const sessionItems = [...items.values()].filter((i) => i.sessionId === session.id);
  return {
    ...session,
    creator: users.get(session.createdBy) ? { id: session.createdBy, name: users.get(session.createdBy).name } : null,
    warehouse: branches.get(session.warehouseId)
      ? { id: session.warehouseId, name: branches.get(session.warehouseId).name ?? session.warehouseId }
      : null,
    items: sessionItems.map((item) => ({
      ...item,
      product: products.get(item.productId)
        ? {
            id: item.productId,
            name: products.get(item.productId).name,
            itemNumber: products.get(item.productId).itemNumber ?? null,
            category: null,
            imageUrl: null,
            qrCode: products.get(item.productId).qrCode ?? null,
            cartonQrCode: products.get(item.productId).cartonQrCode ?? null,
            pcsPerCarton: products.get(item.productId).pcsPerCarton ?? 1,
          }
        : null,
      approver: item.approvedBy && users.get(item.approvedBy)
        ? { id: item.approvedBy, name: users.get(item.approvedBy).name }
        : null,
    })),
    _count: { items: sessionItems.length },
  };
}

// Mocked BEFORE importing cycle-count.service so the real whatsapp-web.js /
// app-notification DB calls never run in this unit test.
mock.module("./whatsapp.service", {
  exports: {
    sendWhatsAppText: async () => ({ to: "", message: "" }),
    setCloudCredentials: () => {},
    syncWhatsAppSettings: () => {},
    generateVerifyToken: () => "tok",
  },
});
mock.module("./app-notification.service", {
  exports: {
    notifyAdmin: async (input: any) => { notifyAdminCalls.push(input); return {}; },
    buildDedupeKey: (type: string, entityId?: string | null) => `${type}:${entityId ?? "-"}`,
  },
});

const fakeDb: any = {
  branch: {
    findFirst: async ({ where }: any) => {
      const all = [...branches.values()];
      if (where?.id) {
        const wh = branches.get(where.id);
        return wh && (where.isActive === undefined || wh.isActive === where.isActive) ? { ...wh } : null;
      }
      const active = all.filter((b) => where?.isActive === undefined || b.isActive === where.isActive);
      active.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return active[0] ? { ...active[0] } : null;
    },
    findUnique: async ({ where }: any) => {
      const wh = branches.get(where.id);
      return wh ? { ...wh } : null;
    },
  },
  productWarehouseStock: {
    findMany: async ({ where }: any) => {
      const warehouseId = where.warehouseId;
      return [...stocks.values()]
        .filter((s) => s.warehouseId === warehouseId)
        .filter((s) => {
          const product = products.get(s.productId);
          return product && product.deletedAt === null;
        })
        .map((s) => {
          const product = products.get(s.productId);
          return {
            productId: s.productId,
            quantityPieces: s.quantityPieces,
            minStock: s.minStock,
            product: { salePrice: product.salePrice, minStock: product.minStock },
          };
        });
    },
    findUnique: async ({ where }: any) => {
      const key = stockKey(where.productId_warehouseId.productId, where.productId_warehouseId.warehouseId);
      const stock = stocks.get(key);
      return stock ? { ...stock } : null;
    },
    // upsertWarehouseStock() (called by adjustWarehouseStock) goes through here.
    upsert: async ({ where, create, update }: any) => {
      const key = stockKey(where.productId_warehouseId.productId, where.productId_warehouseId.warehouseId);
      let stock = stocks.get(key);
      if (!stock) {
        stock = {
          productId: create.productId,
          warehouseId: create.warehouseId,
          quantityPieces: create.quantityPieces ?? 0,
          minStock: create.minStock ?? null,
        };
        stocks.set(key, stock);
      } else {
        if (update.quantityPieces !== undefined) stock.quantityPieces = update.quantityPieces;
        if (update.minStock !== undefined) stock.minStock = update.minStock;
      }
      return { ...stock };
    },
    update: async ({ where, data }: any) => {
      const key = stockKey(where.productId_warehouseId.productId, where.productId_warehouseId.warehouseId);
      const stock = stocks.get(key);
      if (!stock) throw new Error("stock not found");
      // adjustWarehouseStock() sets an absolute balance; older call sites used
      // the { increment } form — support both shapes.
      if (data.quantityPieces && typeof data.quantityPieces === "object" && "increment" in data.quantityPieces) {
        stock.quantityPieces += data.quantityPieces.increment;
      } else {
        stock.quantityPieces = data.quantityPieces;
      }
      return { quantityPieces: stock.quantityPieces };
    },
    aggregate: async ({ where }: any) => {
      const total = [...stocks.values()]
        .filter((s) => s.productId === where.productId)
        .reduce((sum, s) => sum + s.quantityPieces, 0);
      return { _sum: { quantityPieces: total } };
    },
  },
  stockMovement: {
    create: async ({ data }: any) => {
      movements.push(data);
      return { id: nextId("mv"), ...data };
    },
    groupBy: async ({ where }: any) => {
      const since: Date = where.createdAt.gte;
      const matched = movements.filter(
        (m) => m.branchId === where.branchId && m.type === where.type && m.createdAt >= since,
      );
      const sums = new Map<string, number>();
      for (const m of matched) sums.set(m.productId, (sums.get(m.productId) ?? 0) + m.quantity);
      return [...sums.entries()].map(([productId, qty]) => ({ productId, _sum: { quantity: qty } }));
    },
  },
  cycleCountSession: {
    create: async ({ data }: any) => {
      const session = {
        id: nextId("sess"),
        status: "OPEN",
        submittedAt: null,
        closedAt: null,
        scheduledFor: null,
        notes: null,
        publicToken: null,
        createdAt: new Date(),
        ...data,
      };
      sessions.set(session.id, session);
      return { ...session };
    },
    findFirst: async ({ where }: any) => {
      const match = [...sessions.values()].find(
        (s) =>
          s.warehouseId === where.warehouseId &&
          s.source === where.source &&
          where.status.in.includes(s.status),
      );
      return match ? { id: match.id } : null;
    },
    findMany: async () => {
      const all = [...sessions.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return all.map(attachSession);
    },
    findUnique: async ({ where }: any) => {
      const session = where.id
        ? sessions.get(where.id)
        : [...sessions.values()].find((s) => s.publicToken === where.publicToken);
      return session ? attachSession(session) : null;
    },
    update: async ({ where, data }: any) => {
      const session = sessions.get(where.id);
      if (!session) throw new Error("session not found");
      Object.assign(session, data);
      return { ...session };
    },
  },
  cycleCountItem: {
    createMany: async ({ data }: any) => {
      for (const row of data) {
        const item = {
          id: nextId("item"),
          actualQty: null,
          variance: null,
          approvalStatus: "PENDING",
          approvedQty: null,
          approvedBy: null,
          approvedAt: null,
          notes: null,
          ...row,
        };
        items.set(item.id, item);
      }
      return { count: data.length };
    },
    findFirst: async ({ where }: any) => {
      const match = [...items.values()].find((i) => i.sessionId === where.sessionId && i.productId === where.productId);
      if (!match) return null;
      const product = products.get(match.productId);
      return { ...match, product: product ? { pcsPerCarton: product.pcsPerCarton ?? 1 } : undefined };
    },
    findMany: async ({ where }: any) => {
      const warehouseId = where.session.warehouseId;
      return [...items.values()]
        .filter((i) => sessions.get(i.sessionId)?.warehouseId === warehouseId)
        .map((i) => ({ productId: i.productId, session: { createdAt: sessions.get(i.sessionId).createdAt } }));
    },
    findUnique: async ({ where }: any) => {
      const item = items.get(where.id);
      if (!item) return null;
      const session = sessions.get(item.sessionId);
      const product = products.get(item.productId);
      return {
        ...item,
        session: { status: session.status, warehouseId: session.warehouseId },
        product: product ? { name: product.name } : null,
      };
    },
    update: async ({ where, data }: any) => {
      const item = items.get(where.id);
      if (!item) throw new Error("item not found");
      Object.assign(item, data);
      return { ...item };
    },
    updateMany: async ({ where, data }: any) => {
      const item = items.get(where.id);
      if (!item || item.approvalStatus !== where.approvalStatus) return { count: 0 };
      Object.assign(item, data);
      return { count: 1 };
    },
  },
  product: {
    findFirst: async ({ where }: any) => {
      const codes: string[] = (where.OR ?? []).map((c: any) => c.qrCode ?? c.cartonQrCode);
      const match = [...products.values()].find(
        (p) => p.deletedAt === null && (codes.includes(p.qrCode) || codes.includes(p.cartonQrCode)),
      );
      return match ? { ...match } : null;
    },
    findUnique: async ({ where }: any) => {
      const p = products.get(where.id);
      return p ? { ...p } : null;
    },
    update: async ({ where, data }: any) => {
      const p = products.get(where.id);
      if (!p) throw new Error("product not found");
      Object.assign(p, data);
      return { ...p };
    },
  },
  user: {
    findUnique: async ({ where }: any) => {
      const u = users.get(where.id);
      return u ? { name: u.name } : null;
    },
    findFirst: async ({ where }: any) => {
      const matches = [...users.values()].filter((u) => u.role === where.role && u.isActive === where.isActive);
      matches.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return matches[0] ? { id: matches[0].id } : null;
    },
  },
  setting: {
    findMany: async () => [...settingsStore.entries()].map(([key, value]) => ({ key, value })),
    upsert: async ({ where, create }: any) => {
      settingsStore.set(where.key, create.value);
      return { key: where.key, value: create.value };
    },
  },
  // Faked for recordStockAdjustmentVariance (stock-loss.service.ts), invoked by
  // approveCycleCountItem/approveAllCycleCountItems whenever delta !== 0.
  counter: {
    upsert: async ({ where }: any) => {
      const next = (counters.get(where.key) ?? 0) + 1;
      counters.set(where.key, next);
      return { key: where.key, value: next };
    },
  },
  stockLoss: {
    create: async ({ data }: any) => {
      const loss = { id: nextId("loss"), cancelledAt: null, createdAt: new Date(), updatedAt: new Date(), ...data };
      stockLosses.set(loss.id, loss);
      return { ...loss };
    },
    findUnique: async ({ where }: any) => {
      if (where.lossNumber !== undefined) {
        const match = [...stockLosses.values()].find((l) => l.lossNumber === where.lossNumber);
        return match ? { ...match } : null;
      }
      const loss = stockLosses.get(where.id);
      return loss ? { ...loss } : null;
    },
  },
  stockLossItem: {
    create: async ({ data }: any) => {
      const item = { id: nextId("lossitem"), ...data };
      stockLossItems.push(item);
      return { ...item };
    },
  },
  // adjustWarehouseStock()'s row lock — this fake has no real concurrency, so it
  // just reads the current in-memory balance.
  $queryRaw: async (query: any) => {
    const [productId, warehouseId] = query?.values ?? [];
    const stock = stocks.get(stockKey(productId, warehouseId));
    return [{ quantity_pieces: stock?.quantityPieces ?? 0 }];
  },
  // Prisma's $transaction accepts EITHER a callback OR an array of prepared
  // queries (settings.service batches its upserts that way). Support both, or
  // the double throws "fn is not a function" on the array form.
  $transaction: async (fnOrOps: any) =>
    Array.isArray(fnOrOps) ? Promise.all(fnOrOps) : fnOrOps(fakeDb),
};

mock.module("../config/database", { exports: { default: fakeDb } });

let svc: typeof import("./cycle-count.service");

describe("cycle-count.service — جدولة الجرد الذكي (independent feature)", () => {
  before(async () => {
    svc = await import("./cycle-count.service");
  });

  beforeEach(() => {
    idCounter = 0;
    notifyAdminCalls = [];
    branches = new Map([
      [WAREHOUSE, { id: WAREHOUSE, name: "المخزن الرئيسي", phone: null, isActive: true, createdAt: new Date("2026-01-01") }],
      [OTHER_WAREHOUSE, { id: OTHER_WAREHOUSE, name: "مخزن ثانٍ", phone: null, isActive: true, createdAt: new Date("2026-01-02") }],
    ]);
    products = new Map([
      ["p1", { id: "p1", name: "منتج 1", itemNumber: "AWD-225", salePrice: 1000, minStock: 5, deletedAt: null, qrCode: "QR-P1", cartonQrCode: "CQR-P1", pcsPerCarton: 12 }],
      ["p2", { id: "p2", name: "منتج 2", itemNumber: "AWD-226", salePrice: 5000, minStock: 5, deletedAt: null, qrCode: "QR-P2", cartonQrCode: "CQR-P2", pcsPerCarton: 6 }],
      ["p3", { id: "p3", name: "منتج 3", itemNumber: "", salePrice: 500, minStock: 20, deletedAt: null, qrCode: "QR-P3", cartonQrCode: "CQR-P3", pcsPerCarton: 24 }],
    ]);
    stocks = new Map([
      [stockKey("p1", WAREHOUSE), { productId: "p1", warehouseId: WAREHOUSE, quantityPieces: 100, minStock: null }],
      [stockKey("p2", WAREHOUSE), { productId: "p2", warehouseId: WAREHOUSE, quantityPieces: 10, minStock: null }],
      [stockKey("p3", WAREHOUSE), { productId: "p3", warehouseId: WAREHOUSE, quantityPieces: 5, minStock: null }],
    ]);
    sessions = new Map();
    items = new Map();
    movements = [];
    users = new Map([
      [ADMIN_USER, { id: ADMIN_USER, name: "المدير", role: "ADMIN", isActive: true, createdAt: new Date("2026-01-01") }],
    ]);
    settingsStore = new Map();
    stockLosses = new Map();
    stockLossItems = [];
    counters = new Map();
  });

  // ── Item count / capping ────────────────────────────────────────────────────

  it("creates exactly itemLimit items when the warehouse has more products than the limit", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 2,
    });
    const created = [...items.values()].filter((i) => i.sessionId === session.id);
    assert.equal(created.length, 2);
  });

  it("caps at the available product count when itemLimit exceeds it", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 999,
    });
    const created = [...items.values()].filter((i) => i.sessionId === session.id);
    assert.equal(created.length, 3, "only 3 products exist in this warehouse");
  });

  it("rejects creating a session for a warehouse with no stock at all", async () => {
    await assert.rejects(
      () =>
        svc.createCycleCountSession({
          createdBy: ADMIN_USER,
          warehouseId: OTHER_WAREHOUSE,
          strategy: "RANDOM" as any,
          itemLimit: 5,
        }),
      (err: any) => err.code === "NO_PRODUCTS",
    );
  });

  it("every new session gets a publicToken (the worker count link)", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 2,
    });
    assert.ok(session.publicToken && session.publicToken.length > 0);
    const listed = await svc.listCycleCountSessions();
    assert.equal(listed[0].publicToken, session.publicToken, "admin list also exposes the link so it can be copied");
  });

  // ── Strategies ───────────────────────────────────────────────────────────────

  it("HIGH_VALUE orders by (quantity × sale price) descending", async () => {
    const selected = await svc.selectProductsForStrategy(fakeDb, WAREHOUSE, "HIGH_VALUE" as any, 3);
    assert.deepEqual(selected.map((s) => s.productId), ["p1", "p2", "p3"]);
  });

  it("LOW_STOCK orders by (quantity - minStock) ascending — most deficient first", async () => {
    const selected = await svc.selectProductsForStrategy(fakeDb, WAREHOUSE, "LOW_STOCK" as any, 3);
    assert.deepEqual(selected.map((s) => s.productId), ["p3", "p2", "p1"]);
  });

  it("FAST_MOVING orders by recent OUT movement quantity descending", async () => {
    const now = new Date();
    movements.push(
      { productId: "p3", branchId: WAREHOUSE, type: "OUT", quantity: 50, createdAt: now },
      { productId: "p1", branchId: WAREHOUSE, type: "OUT", quantity: 5, createdAt: now },
    );
    const selected = await svc.selectProductsForStrategy(fakeDb, WAREHOUSE, "FAST_MOVING" as any, 3);
    assert.equal(selected[0].productId, "p3", "most OUT movement first");
    assert.ok(selected.map((s) => s.productId).includes("p2"), "products with zero movement are still included");
  });

  it("LEAST_RECENTLY_COUNTED puts never-counted products before previously-counted ones", async () => {
    const priorSession = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 1,
    });
    for (const item of items.values()) {
      if (item.sessionId === priorSession.id) item.productId = "p1";
    }

    const selected = await svc.selectProductsForStrategy(fakeDb, WAREHOUSE, "LEAST_RECENTLY_COUNTED" as any, 3);
    assert.notEqual(selected[0].productId, "p1", "p1 was already counted — should not be first");
  });

  it("RANDOM selects itemLimit distinct products from the pool", async () => {
    const selected = await svc.selectProductsForStrategy(fakeDb, WAREHOUSE, "RANDOM" as any, 2);
    assert.equal(selected.length, 2);
    assert.equal(new Set(selected.map((s) => s.productId)).size, 2, "no duplicates");
    for (const s of selected) assert.ok(["p1", "p2", "p3"].includes(s.productId));
  });

  // ── Duplicate scheduled session guard ───────────────────────────────────────

  it("hasOpenScheduledSession is false with no sessions, true once a SCHEDULED OPEN session exists", async () => {
    assert.equal(await svc.hasOpenScheduledSession(WAREHOUSE), false);
    await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 1,
      source: "SCHEDULED" as any,
    });
    assert.equal(await svc.hasOpenScheduledSession(WAREHOUSE), true);
  });

  it("does not flag a warehouse as having an open scheduled session when only a MANUAL session is open", async () => {
    await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 1,
      source: "MANUAL" as any,
    });
    assert.equal(await svc.hasOpenScheduledSession(WAREHOUSE), false);
  });

  // ── No stock movement before approval ───────────────────────────────────────

  it("creating a session, entering quantities, and submitting never touches stock or StockMovement", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 3,
    });
    const stockBefore = new Map([...stocks.entries()].map(([k, v]) => [k, v.quantityPieces]));

    for (const item of [...items.values()].filter((i) => i.sessionId === session.id)) {
      await svc.updateCycleCountItem(session.id, item.productId, item.systemQty + 7);
    }
    await svc.submitCycleCountSession(session.id);

    for (const [key, qty] of stockBefore) assert.equal(stocks.get(key)!.quantityPieces, qty, `${key} unchanged`);
    assert.equal(movements.length, 0, "no StockMovement rows before any approval");
  });

  // ── Admin notification on submit ────────────────────────────────────────────

  it("submitting a session (admin path) fires a best-effort admin notification", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 2,
    });
    await svc.submitCycleCountSession(session.id);

    assert.equal(notifyAdminCalls.length, 1);
    assert.equal(notifyAdminCalls[0].type, "CYCLE_COUNT_SUBMITTED");
    assert.equal(notifyAdminCalls[0].entityId, session.id);
  });

  it("submitting via the worker public link also fires the admin notification", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 2,
    });
    await svc.submitPublicCycleCount(session.publicToken!);

    assert.equal(notifyAdminCalls.length, 1);
    assert.equal(notifyAdminCalls[0].entityId, session.id);
    const updated = sessions.get(session.id);
    assert.equal(updated.status, "SUBMITTED");
  });

  // ── Worker public link ───────────────────────────────────────────────────────

  it("the worker never sees systemQty in the public session payload", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 3,
    });
    const publicView = await svc.getPublicCycleCountSession(session.publicToken!);
    for (const item of publicView.items) {
      assert.ok(!("systemQty" in item), "systemQty must never be present in the worker-facing payload");
    }
  });

  it("the worker payload includes itemNumber when set, and null when the product has none", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 3,
    });
    const publicView = await svc.getPublicCycleCountSession(session.publicToken!);

    const p1 = publicView.items.find((i) => i.productId === "p1")!;
    assert.equal(p1.itemNumber, "AWD-225");

    const p3 = publicView.items.find((i) => i.productId === "p3")!; // itemNumber: ""
    assert.equal(p3.itemNumber, null, "an empty itemNumber must come through as null, not an empty string");
  });

  it("scanning a barcode also returns itemNumber (null when the product has none)", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 3,
    });
    const token = session.publicToken!;
    const scanned = await svc.scanCycleCountQrCode(token, "QR-P1");
    assert.equal(scanned.itemNumber, "AWD-225");

    const scannedNoItemNumber = await svc.scanCycleCountQrCode(token, "QR-P3");
    assert.equal(scannedNoItemNumber.itemNumber, null);
  });

  it("worker-entered quantities persist across re-fetching the same link (reopen-safe)", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 3,
    });
    const token = session.publicToken!;
    const firstView = await svc.getPublicCycleCountSession(token);
    const target = firstView.items[0];
    assert.equal(target.actualQty, null, "starts empty — worker counts by himself");

    await svc.setCycleCountItemQty(token, target.productId, 5, "PIECE");

    // Simulate the worker leaving and reopening the same link later.
    const reopenedView = await svc.getPublicCycleCountSession(token);
    const sameItem = reopenedView.items.find((i) => i.productId === target.productId)!;
    assert.equal(sameItem.actualQty, 5, "previously entered quantity is still there — not wiped");
  });

  it("worker barcode scan increments actualQty using cartonQrCode × pcsPerCarton", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 3,
    });
    const token = session.publicToken!;
    const result = await svc.scanCycleCountQrCode(token, "CQR-P1"); // p1 pcsPerCarton = 12
    assert.equal(result.newQty, 12);
    const again = await svc.scanCycleCountQrCode(token, "QR-P1"); // piece barcode, +1
    assert.equal(again.newQty, 13);
  });

  it("worker cannot edit quantities once the session is submitted", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 2,
    });
    const token = session.publicToken!;
    await svc.submitPublicCycleCount(token);

    await assert.rejects(
      () => svc.setCycleCountItemQty(token, [...items.values()][0].productId, 3, "PIECE"),
      (err: any) => err.code === "SESSION_NOT_OPEN",
    );
  });

  it("admin cannot edit an item after the session is submitted, unless reopened", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 2,
    });
    const productId = [...items.values()][0].productId;
    await svc.submitCycleCountSession(session.id);

    await assert.rejects(
      () => svc.updateCycleCountItem(session.id, productId, 9),
      (err: any) => err.code === "SESSION_NOT_OPEN",
    );

    await svc.reopenCycleCountSession(session.id);
    const updated = await svc.updateCycleCountItem(session.id, productId, 9);
    assert.equal(updated.actualQty, 9, "editable again after reopen");
  });

  // ── Approve writes StockMovement; reject does not ───────────────────────────

  it("approving an item with a nonzero variance updates stock and writes exactly one StockMovement", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 3,
    });
    const item = [...items.values()].find((i) => i.sessionId === session.id && i.productId === "p1")!;
    await svc.updateCycleCountItem(session.id, "p1", item.systemQty + 10);
    await svc.submitCycleCountSession(session.id);

    const before = stocks.get(stockKey("p1", WAREHOUSE))!.quantityPieces;
    const result = await svc.approveCycleCountItem(session.id, item.id, ADMIN_USER, "COUNT_ERROR");

    assert.equal(result.delta, 10);
    assert.equal(stocks.get(stockKey("p1", WAREHOUSE))!.quantityPieces, before + 10);
    assert.equal(movements.length, 1);
    assert.equal(movements[0].type, "IN");
    assert.equal(movements[0].quantity, 10);
    assert.equal(items.get(item.id)!.approvalStatus, "APPROVED");
    assert.equal(items.get(item.id)!.approvedBy, ADMIN_USER);
  });

  // ── Financial trace (StockLoss/StockLossItem wiring) ───────────────────────

  it("approving a nonzero variance records a StockLoss+StockLossItem and links lossId onto the movement and item", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 3,
    });
    const item = [...items.values()].find((i) => i.sessionId === session.id && i.productId === "p1")!;
    await svc.updateCycleCountItem(session.id, "p1", item.systemQty + 5); // overage → GAIN
    await svc.submitCycleCountSession(session.id);

    await svc.approveCycleCountItem(session.id, item.id, ADMIN_USER, "COUNT_ERROR");

    assert.equal(stockLosses.size, 1, "exactly one StockLoss written");
    const loss = [...stockLosses.values()][0];
    assert.equal(loss.direction, "GAIN", "overage → GAIN direction");
    assert.equal(loss.source, "CYCLE_COUNT");
    assert.equal(loss.reason, "COUNT_ERROR");
    assert.equal(stockLossItems.length, 1);
    assert.equal(stockLossItems[0].quantity, 5);
    assert.equal(movements[0].lossId, loss.id, "StockMovement links to the loss row");
    assert.equal(items.get(item.id)!.lossId, loss.id, "CycleCountItem links to the loss row");
    assert.equal(items.get(item.id)!.reason, "COUNT_ERROR");
  });

  it("approving a zero-variance item never writes a StockLoss", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 3,
    });
    const item = [...items.values()].find((i) => i.sessionId === session.id && i.productId === "p3")!;
    await svc.updateCycleCountItem(session.id, "p3", item.systemQty);
    await svc.submitCycleCountSession(session.id);

    await svc.approveCycleCountItem(session.id, item.id, ADMIN_USER, "COUNT_ERROR");
    assert.equal(stockLosses.size, 0, "zero-delta approvals don't create a StockLoss");
  });

  // ── Negative-floor guard (bug fix — approval no longer bypasses it) ────────

  it("approving a variance that would drive LIVE warehouse stock negative is rejected, not silently applied", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 3,
    });
    const item = [...items.values()].find((i) => i.sessionId === session.id && i.productId === "p2")!;
    await svc.updateCycleCountItem(session.id, "p2", 0); // counted zero — delta vs systemQty(10) = -10
    await svc.submitCycleCountSession(session.id);

    // Simulate a concurrent stock-reducing event between counting and approval —
    // live stock is now lower than the systemQty captured at session creation,
    // so applying the full -10 delta would push it negative.
    stocks.get(stockKey("p2", WAREHOUSE))!.quantityPieces = 3;

    await assert.rejects(
      () => svc.approveCycleCountItem(session.id, item.id, ADMIN_USER, "COUNT_ERROR"),
      (err: any) => err.code === "INSUFFICIENT_WAREHOUSE_STOCK",
    );
    assert.equal(stocks.get(stockKey("p2", WAREHOUSE))!.quantityPieces, 3, "stock untouched after rejection");
    assert.equal(items.get(item.id)!.approvalStatus, "PENDING", "item stays pending — not silently approved");
    assert.equal(stockLosses.size, 0, "no StockLoss written for a rejected approval");
  });

  it("rejecting an item never touches stock and writes no StockMovement", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 3,
    });
    const item = [...items.values()].find((i) => i.sessionId === session.id && i.productId === "p2")!;
    await svc.updateCycleCountItem(session.id, "p2", item.systemQty + 25);
    await svc.submitCycleCountSession(session.id);

    const before = stocks.get(stockKey("p2", WAREHOUSE))!.quantityPieces;
    await svc.rejectCycleCountItem(session.id, item.id, ADMIN_USER);

    assert.equal(stocks.get(stockKey("p2", WAREHOUSE))!.quantityPieces, before, "stock unchanged");
    assert.equal(movements.length, 0, "no StockMovement written on reject");
    assert.equal(items.get(item.id)!.approvalStatus, "REJECTED");
  });

  it("approving a zero-variance item updates approval status but writes no StockMovement", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 3,
    });
    const item = [...items.values()].find((i) => i.sessionId === session.id && i.productId === "p3")!;
    await svc.updateCycleCountItem(session.id, "p3", item.systemQty); // no variance
    await svc.submitCycleCountSession(session.id);

    await svc.approveCycleCountItem(session.id, item.id, ADMIN_USER, "COUNT_ERROR");
    assert.equal(movements.length, 0, "zero delta approvals don't create a movement row");
    assert.equal(items.get(item.id)!.approvalStatus, "APPROVED");
  });

  it("cannot approve the same item twice — second call rejects and no duplicate StockMovement is written", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 3,
    });
    const item = [...items.values()].find((i) => i.sessionId === session.id && i.productId === "p1")!;
    await svc.updateCycleCountItem(session.id, "p1", item.systemQty + 10);
    await svc.submitCycleCountSession(session.id);

    const before = stocks.get(stockKey("p1", WAREHOUSE))!.quantityPieces;
    await svc.approveCycleCountItem(session.id, item.id, ADMIN_USER, "COUNT_ERROR"); // first click

    await assert.rejects(
      () => svc.approveCycleCountItem(session.id, item.id, ADMIN_USER, "COUNT_ERROR"), // double-click
      (err: any) => err.code === "ALREADY_PROCESSED",
    );

    assert.equal(stocks.get(stockKey("p1", WAREHOUSE))!.quantityPieces, before + 10, "delta applied exactly once");
    assert.equal(movements.length, 1, "exactly one StockMovement, not two");
  });

  it("cannot reject an already-approved item, and cannot approve an already-rejected item", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 3,
    });
    const [item1, item2] = [...items.values()].filter((i) => i.sessionId === session.id);
    await svc.updateCycleCountItem(session.id, item1.productId, item1.systemQty + 1);
    await svc.updateCycleCountItem(session.id, item2.productId, item2.systemQty + 1);
    await svc.submitCycleCountSession(session.id);

    await svc.approveCycleCountItem(session.id, item1.id, ADMIN_USER, "COUNT_ERROR");
    await assert.rejects(
      () => svc.rejectCycleCountItem(session.id, item1.id, ADMIN_USER),
      (err: any) => err.code === "ALREADY_PROCESSED",
    );

    await svc.rejectCycleCountItem(session.id, item2.id, ADMIN_USER);
    await assert.rejects(
      () => svc.approveCycleCountItem(session.id, item2.id, ADMIN_USER, "COUNT_ERROR"),
      (err: any) => err.code === "ALREADY_PROCESSED",
    );
  });

  // ── Bulk approve / reject ────────────────────────────────────────────────────

  it("approve-all applies every counted item's delta and writes one StockMovement per nonzero delta", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 3,
    });
    const sessionItems = [...items.values()].filter((i) => i.sessionId === session.id);
    for (const item of sessionItems) {
      await svc.updateCycleCountItem(session.id, item.productId, item.systemQty + 3);
    }
    await svc.submitCycleCountSession(session.id);

    const before = new Map(sessionItems.map((i) => [i.productId, stocks.get(stockKey(i.productId, WAREHOUSE))!.quantityPieces]));
    const result = await svc.approveAllCycleCountItems(session.id, ADMIN_USER, "COUNT_ERROR");

    assert.equal(result.approvedCount, sessionItems.length);
    for (const item of sessionItems) {
      assert.equal(stocks.get(stockKey(item.productId, WAREHOUSE))!.quantityPieces, before.get(item.productId)! + 3);
    }
    assert.equal(movements.length, sessionItems.length);
    for (const item of sessionItems) assert.equal(items.get(item.id)!.approvalStatus, "APPROVED");
  });

  it("reject-all leaves every stock quantity unchanged and writes no StockMovement", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 3,
    });
    const sessionItems = [...items.values()].filter((i) => i.sessionId === session.id);
    for (const item of sessionItems) {
      await svc.updateCycleCountItem(session.id, item.productId, item.systemQty + 4);
    }
    await svc.submitCycleCountSession(session.id);

    const before = new Map([...stocks.entries()].map(([k, v]) => [k, v.quantityPieces]));
    const result = await svc.rejectAllCycleCountItems(session.id, ADMIN_USER);

    assert.equal(result.rejectedCount, sessionItems.length);
    for (const [key, qty] of before) assert.equal(stocks.get(key)!.quantityPieces, qty, `${key} unchanged`);
    assert.equal(movements.length, 0, "reject-all never writes StockMovement");
    for (const item of sessionItems) assert.equal(items.get(item.id)!.approvalStatus, "REJECTED");
  });

  it("approve-all skips items with no actualQty entered and items already processed", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 3,
    });
    const sessionItems = [...items.values()].filter((i) => i.sessionId === session.id);
    // Only count the first item; leave the rest uncounted.
    await svc.updateCycleCountItem(session.id, sessionItems[0].productId, sessionItems[0].systemQty + 2);
    await svc.submitCycleCountSession(session.id);

    const result = await svc.approveAllCycleCountItems(session.id, ADMIN_USER, "COUNT_ERROR");
    assert.equal(result.approvedCount, 1, "only the counted item gets approved");
  });

  // ── Admin close / cancel ─────────────────────────────────────────────────────

  it("admin can close a submitted session", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 2,
    });
    await svc.submitCycleCountSession(session.id);
    const closed = await svc.closeCycleCountSession(session.id);
    assert.equal(closed.status, "CLOSED");
    assert.ok(sessions.get(session.id).closedAt);
  });

  it("closing a submitted session with an unreviewed counted variance is blocked unless force=true", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 2,
    });
    const sessionItems = [...items.values()].filter((i) => i.sessionId === session.id);
    // Count only the first item — leave the second uncounted (actualQty null,
    // which must NOT count as "unresolved").
    await svc.updateCycleCountItem(session.id, sessionItems[0].productId, sessionItems[0].systemQty + 1);
    await svc.submitCycleCountSession(session.id);

    await assert.rejects(
      () => svc.closeCycleCountSession(session.id),
      (err: any) => err.code === "UNRESOLVED_ITEMS",
    );
    assert.equal(sessions.get(session.id).status, "SUBMITTED", "still open — close did not silently proceed");

    const closed = await svc.closeCycleCountSession(session.id, true);
    assert.equal(closed.status, "CLOSED");
    assert.equal(closed.unresolvedCount, 1, "reports how many were left unresolved when force-closed");
  });

  it("admin can cancel an open session", async () => {
    const session = await svc.createCycleCountSession({
      createdBy: ADMIN_USER,
      warehouseId: WAREHOUSE,
      strategy: "RANDOM" as any,
      itemLimit: 2,
    });
    const result = await svc.cancelCycleCountSession(session.id);
    assert.equal(result.success, true);
    assert.equal(sessions.get(session.id).status, "CANCELLED");
  });

  // ── Scheduled cron job ───────────────────────────────────────────────────────

  it("runScheduledCycleCountJob does nothing when the feature is disabled", async () => {
    settingsStore.set("cycleCountEnabled", false);
    settingsStore.set("cycleCountWarehouseId", WAREHOUSE);
    await svc.runScheduledCycleCountJob();
    assert.equal(sessions.size, 0);
  });

  it("runScheduledCycleCountJob respects cycleCountIntervalDays — skips when not due yet", async () => {
    settingsStore.set("cycleCountEnabled", true);
    settingsStore.set("cycleCountWarehouseId", WAREHOUSE);
    settingsStore.set("cycleCountIntervalDays", 7);
    settingsStore.set("cycleCountItemLimit", 2);
    settingsStore.set("cycleCountStrategy", "RANDOM");
    settingsStore.set("cycleCountLastRunAt", new Date().toISOString()); // just ran

    await svc.runScheduledCycleCountJob();
    assert.equal(sessions.size, 0, "interval has not elapsed — no session created");
  });

  it("runScheduledCycleCountJob creates a SCHEDULED session once the interval has elapsed", async () => {
    settingsStore.set("cycleCountEnabled", true);
    settingsStore.set("cycleCountWarehouseId", WAREHOUSE);
    settingsStore.set("cycleCountIntervalDays", 7);
    settingsStore.set("cycleCountItemLimit", 2);
    settingsStore.set("cycleCountStrategy", "RANDOM");
    settingsStore.set("cycleCountLastRunAt", new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString());

    await svc.runScheduledCycleCountJob();

    const created = [...sessions.values()];
    assert.equal(created.length, 1);
    assert.equal(created[0].source, "SCHEDULED");
    assert.equal(created[0].warehouseId, WAREHOUSE);
    assert.equal(settingsStore.get("cycleCountLastRunAt") !== "", true, "lastRunAt was advanced");
  });

  it("runScheduledCycleCountJob does not create a duplicate when a SCHEDULED session is still open", async () => {
    settingsStore.set("cycleCountEnabled", true);
    settingsStore.set("cycleCountWarehouseId", WAREHOUSE);
    settingsStore.set("cycleCountIntervalDays", 7);
    settingsStore.set("cycleCountItemLimit", 2);
    settingsStore.set("cycleCountStrategy", "RANDOM");
    settingsStore.set("cycleCountLastRunAt", new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString());

    await svc.runScheduledCycleCountJob();
    assert.equal(sessions.size, 1, "first run creates one session");

    settingsStore.set("cycleCountLastRunAt", new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString());
    await svc.runScheduledCycleCountJob();

    assert.equal(sessions.size, 1, "no duplicate session created while one is still open for the warehouse");
  });
});
