import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// Verify the stock-loss cancellation invariants:
//   #4 idempotent + race-safe: concurrent/duplicate cancels restore stock ONCE.
//   #5 audit-preserving: the original DAMAGE movement is never deleted; a
//      compensating IN movement is appended carrying real balances.
//
// We drive the real cancelStockLoss against a fake prisma whose stockLoss.updateMany
// models the atomic `cancelledAt: null -> now()` claim, and a stubbed
// warehouse-stock service that records every restore.

type AdjustInput = { productId: string; warehouseId: string; deltaPieces: number; allowNegative?: boolean };

let lossRow: any;
let restoreCalls: AdjustInput[] = [];
let movementCreates: any[] = [];
let deleteManyCalls: any[] = [];

const fakePrisma: any = {
  $transaction: async (cb: any) => cb(fakePrisma),
  stockLoss: {
    // Atomic claim: only the first caller sees cancelledAt === null and wins.
    updateMany: async ({ where, data }: any) => {
      if (where.id === lossRow.id && where.cancelledAt === null && lossRow.cancelledAt == null) {
        lossRow.cancelledAt = data.cancelledAt;
        return { count: 1 };
      }
      return { count: 0 };
    },
    findUnique: async ({ where }: any) => (where.id === lossRow.id ? { ...lossRow } : null),
    update: async ({ data }: any) => {
      Object.assign(lossRow, data);
      return { ...lossRow };
    },
  },
  stockMovement: {
    create: async ({ data }: any) => {
      movementCreates.push(data);
      return data;
    },
    deleteMany: async (args: any) => {
      deleteManyCalls.push(args);
      return { count: 0 };
    },
  },
};

mock.module("../config/database", { exports: { default: fakePrisma } });
mock.module("./warehouse-stock.service", {
  exports: {
    adjustWarehouseStock: async (_db: unknown, input: AdjustInput) => {
      restoreCalls.push(input);
      return { balanceBefore: 5, balanceAfter: 5 + input.deltaPieces };
    },
    ensureLegacyWarehouseStock: async () => {},
    syncProductTotalStock: async () => {},
    resolveWarehouseId: async (_db: unknown, id: string) => id,
  },
});

let cancelStockLoss: typeof import("./stock-loss.service").cancelStockLoss;

describe("cancelStockLoss", () => {
  before(async () => {
    ({ cancelStockLoss } = await import("./stock-loss.service"));
  });

  beforeEach(() => {
    restoreCalls = [];
    movementCreates = [];
    deleteManyCalls = [];
    lossRow = {
      id: "loss-1",
      warehouseId: "wh-1",
      cancelledAt: null,
      warehouse: { id: "wh-1", name: "المحل" },
      creator: { id: "u1", name: "x", username: "x" },
      items: [
        { id: "i1", productId: "p1", unit: "CARTON", quantity: 2, product: { id: "p1", pcsPerCarton: 10 } },
      ],
    };
  });

  it("restores stock once and appends an IN reversal carrying real balances", async () => {
    await cancelStockLoss("loss-1");

    assert.equal(restoreCalls.length, 1);
    assert.equal(restoreCalls[0].deltaPieces, 20); // 2 cartons * 10 pcs, added back
    assert.ok(restoreCalls[0].deltaPieces > 0);

    assert.equal(movementCreates.length, 1);
    assert.equal(movementCreates[0].type, "IN");
    assert.equal(movementCreates[0].quantity, 20);
    assert.equal(movementCreates[0].balanceBefore, 5);
    assert.equal(movementCreates[0].balanceAfter, 25);
  });

  it("never deletes the original DAMAGE movement", async () => {
    await cancelStockLoss("loss-1");
    assert.equal(deleteManyCalls.length, 0);
  });

  it("is idempotent: a second cancel does not restore stock again", async () => {
    await cancelStockLoss("loss-1");
    await cancelStockLoss("loss-1");
    assert.equal(restoreCalls.length, 1); // still just one restore
  });

  it("is race-safe: two concurrent cancels restore stock only once", async () => {
    await Promise.all([cancelStockLoss("loss-1"), cancelStockLoss("loss-1")]);
    assert.equal(restoreCalls.length, 1);
    assert.equal(movementCreates.length, 1);
  });

  it("throws for an unknown loss id", async () => {
    await assert.rejects(() => cancelStockLoss("does-not-exist"), /LOSS_NOT_FOUND|غير موجود/);
  });
});
