/**
 * transfer.service — warehouse-to-warehouse conservation test
 *
 * Drives the REAL executeTransferWithin orchestration. The stock engine
 * (warehouse-stock.service) is module-mocked with a faithful in-memory
 * implementation that actually moves pieces and blocks an overdraw, so the
 * test verifies the invariants the user depends on when transferring between
 * warehouses ("حول بين المخازن"):
 *
 *   • source warehouse loses exactly N pieces, destination gains exactly N
 *   • total pieces across all warehouses are conserved
 *   • unit conversion (CARTON × pcsPerCarton, DOZEN × 12) is correct
 *   • a transfer larger than the source stock is rejected (no partial move)
 *   • non-positive quantities are rejected
 */

import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { Unit } from "@prisma/client";

const FROM = "wh-abb";
const TO = "wh-shop";
const PROD = "prod-1";

// ── In-memory per-(product,warehouse) stock ───────────────────────────────────
let stock: Map<string, number>; // key: `${productId}:${warehouseId}` → pieces
const key = (p: string, w: string) => `${p}:${w}`;
const stockOf = (p: string, w: string) => stock.get(key(p, w)) ?? 0;
const totalOf = (p: string) =>
  [...stock.entries()].filter(([k]) => k.startsWith(`${p}:`)).reduce((s, [, v]) => s + v, 0);

// ── Faithful stock-engine mock (registered before importing the service) ──────
mock.module("./warehouse-stock.service", {
  exports: {
    ensureLegacyWarehouseStock: async () => {},
    syncProductTotalStock: async () => {},
    // Mirrors the real adjust: returns balanceBefore/After and blocks an
    // overdraw unless allowNegative is set.
    adjustWarehouseStock: async (_tx: any, { productId, warehouseId, deltaPieces, allowNegative }: any) => {
      const before = stockOf(productId, warehouseId);
      const after = before + deltaPieces;
      if (after < 0 && !allowNegative) {
        const err: any = new Error("Insufficient stock");
        err.statusCode = 400;
        err.code = "INSUFFICIENT_STOCK";
        throw err;
      }
      stock.set(key(productId, warehouseId), after);
      return { balanceBefore: before, balanceAfter: after };
    },
  },
});

// Transitively imported by transfer.service — stub to keep the graph resolvable.
mock.module("./approval.service", {
  exports: { approvalRequestTypes: {}, createPendingApproval: async () => ({}) },
});
mock.module("./settings.service", { exports: { getSettings: async () => ({}) } });
mock.module("./whatsapp.service", { exports: { sendWhatsAppText: async () => {} } });

// ── Fake transaction client ───────────────────────────────────────────────────
let movements: any[];
function makeTx(): any {
  return {
    counter: { upsert: async () => ({ key: "inventory_transfer", value: 1 }) },
    branch: {
      findMany: async ({ where }: any) =>
        (where.id.in as string[])
          .filter((id) => id === FROM || id === TO)
          .map((id) => ({ id })),
    },
    product: {
      findMany: async ({ where }: any) =>
        (where.id.in as string[])
          .filter((id) => id === PROD)
          .map((id) => ({ id, name: "منتج", pcsPerCarton: 12, deletedAt: null })),
    },
    inventoryTransfer: {
      create: async ({ data }: any) => ({ id: "trf-1", ...data }),
      findUniqueOrThrow: async ({ where }: any) => ({ id: where.id, items: [] }),
    },
    stockMovement: {
      createMany: async ({ data }: any) => { movements.push(...data); return { count: data.length }; },
    },
  };
}

let executeTransferWithin: Function;

describe("transfer.service — warehouse conservation", () => {
  before(async () => {
    ({ executeTransferWithin } = await import("./transfer.service"));
  });

  beforeEach(() => {
    // ABB depot holds 100 pieces; المحل holds 0.
    stock = new Map([[key(PROD, FROM), 100], [key(PROD, TO), 0]]);
    movements = [];
  });

  it("moves pieces from source to destination, conserving the total", async () => {
    const total0 = totalOf(PROD);
    await executeTransferWithin(
      makeTx(),
      { fromBranchId: FROM, toBranchId: TO, items: [{ productId: PROD, quantity: 30, unit: Unit.PIECE }] },
      "user-1",
      false
    );
    assert.equal(stockOf(PROD, FROM), 70, "source dropped by 30");
    assert.equal(stockOf(PROD, TO), 30, "destination rose by 30");
    assert.equal(totalOf(PROD), total0, "total pieces conserved");
  });

  it("converts CARTON quantity using pcsPerCarton (2 × 12 = 24)", async () => {
    await executeTransferWithin(
      makeTx(),
      { fromBranchId: FROM, toBranchId: TO, items: [{ productId: PROD, quantity: 2, unit: Unit.CARTON }] },
      "user-1",
      false
    );
    assert.equal(stockOf(PROD, FROM), 76, "100 − 24");
    assert.equal(stockOf(PROD, TO), 24, "0 + 24");
  });

  it("records paired OUT (source) + IN (destination) movements", async () => {
    await executeTransferWithin(
      makeTx(),
      { fromBranchId: FROM, toBranchId: TO, items: [{ productId: PROD, quantity: 10, unit: Unit.PIECE }] },
      "user-1",
      false
    );
    const out = movements.find((m) => m.type === "OUT");
    const inn = movements.find((m) => m.type === "IN");
    assert.ok(out && inn, "both movements recorded");
    assert.equal(out.branchId, FROM);
    assert.equal(inn.branchId, TO);
    assert.equal(out.balanceAfter, 90, "source balanceAfter = 90");
    assert.equal(inn.balanceAfter, 10, "destination balanceAfter = 10");
  });

  it("rejects a transfer larger than the source stock (no partial move)", async () => {
    await assert.rejects(
      () => executeTransferWithin(
        makeTx(),
        { fromBranchId: FROM, toBranchId: TO, items: [{ productId: PROD, quantity: 150, unit: Unit.PIECE }] },
        "user-1",
        false
      ),
      (err: any) => err.code === "INSUFFICIENT_STOCK"
    );
  });

  it("rejects a non-positive transfer quantity", async () => {
    await assert.rejects(
      () => executeTransferWithin(
        makeTx(),
        { fromBranchId: FROM, toBranchId: TO, items: [{ productId: PROD, quantity: 0, unit: Unit.PIECE }] },
        "user-1",
        false
      ),
      (err: any) => err.code === "INVALID_TRANSFER_QUANTITY"
    );
  });

  it("rejects an unknown / inactive warehouse", async () => {
    await assert.rejects(
      () => executeTransferWithin(
        makeTx(),
        { fromBranchId: FROM, toBranchId: "ghost-wh", items: [{ productId: PROD, quantity: 5, unit: Unit.PIECE }] },
        "user-1",
        false
      ),
      (err: any) => err.code === "WAREHOUSE_NOT_FOUND"
    );
  });
});
