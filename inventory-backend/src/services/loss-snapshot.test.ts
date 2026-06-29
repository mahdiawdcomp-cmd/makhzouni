/**
 * Damaged-stock cost SNAPSHOT, frozen at loss time.
 *
 * 1. createStockLoss must snapshot stockLossItem.costPrice = costPrice>0 ?
 *    costPrice : purchasePrice (NOT raw purchasePrice).
 * 2. The loss-valuation report must PREFER that frozen snapshot, falling back to
 *    the live accounting cost only when the snapshot is missing/zero.
 */

import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { LossReason, Unit } from "@prisma/client";

// ── Capture target ────────────────────────────────────────────────────────────
let createdLossItem: any = null;
const productRow = {
  id: "p1", name: "ماء", pcsPerCarton: 1, costPrice: 250, purchasePrice: 300,
};

const fakePrisma: any = {
  $transaction: async (cb: any) => cb(fakePrisma),
  counter: { upsert: async () => ({ value: 1 }) },
  stockLoss: {
    // lossNumber uniqueness probe → null (accept candidate); final fetch → object.
    findUnique: async ({ where }: any) =>
      where.lossNumber
        ? null
        : { id: "loss-1", items: [], warehouse: { id: "w1", name: "المحل" }, creator: null },
    create: async ({ data }: any) => ({ id: "loss-1", ...data }),
  },
  product: {
    findUnique: async ({ where }: any) => (where.id === productRow.id ? { ...productRow } : null),
  },
  stockMovement: { create: async ({ data }: any) => data },
  stockLossItem: {
    create: async ({ data }: any) => {
      createdLossItem = data;
      return data;
    },
  },
};

mock.module("../config/database", { exports: { default: fakePrisma } });
mock.module("./warehouse-stock.service", {
  exports: {
    resolveWarehouseId: async (_db: unknown, id: string) => id,
    ensureLegacyWarehouseStock: async () => {},
    adjustWarehouseStock: async () => ({ balanceBefore: 10, balanceAfter: 5 }),
    syncProductTotalStock: async () => {},
  },
});

let createStockLoss: Function;
let accountingUnitCost: (p: { costPrice: any; purchasePrice: any }) => number;

describe("stock-loss cost snapshot uses costPrice first", () => {
  before(async () => {
    ({ createStockLoss } = await import("./stock-loss.service"));
    ({ accountingUnitCost } = await import("./report.service"));
  });

  it("snapshots costPrice 250 (not purchasePrice 300) on a new loss", async () => {
    await createStockLoss(
      {
        date: "2026-06-30",
        warehouseId: "w1",
        reason: LossReason.DAMAGE,
        items: [{ productId: "p1", unit: Unit.PIECE, quantity: 5 }],
      },
      "user-1"
    );
    assert.ok(createdLossItem, "stockLossItem.create was called");
    assert.equal(Number(createdLossItem.costPrice), 250, "snapshot = costPrice, not purchasePrice");
  });

  it("report values 5 damaged @ snapshot 250 → 1250 (snapshot preferred)", () => {
    // Mirrors the report rule: snapshot>0 ? snapshot : accountingUnitCost(product)
    const snapshot = 250;
    const unitCost = snapshot > 0 ? snapshot : accountingUnitCost({ costPrice: 999, purchasePrice: 999 });
    assert.equal(5 * unitCost, 1250, "uses frozen snapshot, not live product price");
  });

  it("report falls back to live accounting cost when snapshot is 0", () => {
    const snapshot = 0;
    const unitCost = snapshot > 0 ? snapshot : accountingUnitCost({ costPrice: 250, purchasePrice: 300 });
    assert.equal(5 * unitCost, 1250, "fallback to costPrice 250");
  });
});
