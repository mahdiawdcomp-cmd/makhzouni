import assert from "node:assert/strict";
import test from "node:test";
import { recalculateCustomerBalance } from "./customer.service";

test("recalculateCustomerBalance excludes cancelled and archived vouchers", async () => {
  const voucherFilters: unknown[] = [];
  let savedBalance: unknown;

  const db = {
    customer: {
      findFirst: async () => ({
        id: "customer-1",
        openingBalance: 0,
        currentBalance: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: async ({ data }: { data: { currentBalance: unknown } }) => {
        savedBalance = data.currentBalance;
        return {
          id: "customer-1",
          openingBalance: 0,
          currentBalance: data.currentBalance,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    },
    invoice: {
      aggregate: async ({ where }: { where: { type: string | { in: string[] } } }) => ({
        _sum: { remainingAmount: typeof where.type === "string" ? 12_000 : 0 },
      }),
      findFirst: async () => null,
    },
    paymentVoucher: {
      aggregate: async ({ where }: { where: unknown }) => {
        voucherFilters.push(where);
        return { _sum: { amount: 0 } };
      },
      findFirst: async ({ where }: { where: unknown }) => {
        voucherFilters.push(where);
        return null;
      },
    },
  };

  const result = await recalculateCustomerBalance("customer-1", db as never);

  assert.equal(savedBalance, 12_000);
  assert.equal(result.currentBalance, 12_000);
  for (const where of voucherFilters as Array<Record<string, unknown>>) {
    assert.equal(where.archivedAt, null);
    assert.equal(where.cancelledAt, null);
  }
});
