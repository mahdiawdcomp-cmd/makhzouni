/**
 * «زبائن يحتاجون تواصل» — من يدخل القائمة ومن ما يدخل.
 *
 * القائمة فعلها «اتصل بيه حتى يشتري». فالحساب الي نشتري منه أكثر مما نبيعه
 * ما إله محل بيها: صاحب المحل شافها وبيها مورّده مكتوب «تأخر ٦٢ يوم» بينما
 * المحل مدين إله ٢٨٨ مليون. خانة «مورّد» وحدها ما كفت، لأن الحساب مسجّل
 * «زبون ومورّد» سوا فمرّ من الفلتر.
 */
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

type Row = Record<string, any>;
let customers: Row[] = [];
let invoiceSums: Row[] = [];

mock.module("../config/database", {
  exports: {
    default: {
      customer: { findMany: async () => customers.map((c) => ({ ...c })) },
      invoice: { groupBy: async () => invoiceSums.map((r) => ({ ...r })) },
    },
  },
});

let getAtRiskCustomers: (limit?: number) => Promise<any[]>;

before(async () => {
  ({ getAtRiskCustomers } = await import("./report.service"));
});

/** زبون آخر شراء منه قبل ٦٠ يوم، وإيقاعه المعتاد كل ٣ أيام. */
function lateBuyer(id: string, name: string) {
  const day = 86_400_000;
  const now = Date.now();
  return {
    id,
    name,
    phone: `0770${id}`,
    currentBalance: 0,
    lastTransactionAt: new Date(now - 60 * day),
    invoices: [
      { date: new Date(now - 60 * day), totalAmount: 1000 },
      { date: new Date(now - 63 * day), totalAmount: 1000 },
      { date: new Date(now - 66 * day), totalAmount: 1000 },
    ],
  };
}

describe("at-risk customers", () => {
  it("يطلع الزبون المتأخر عن إيقاعه المعتاد", async () => {
    customers = [lateBuyer("1", "زبون متأخر")];
    invoiceSums = [{ customerId: "1", type: "SALE", _sum: { totalAmount: 3000 } }];
    const rows = await getAtRiskCustomers(10);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "زبون متأخر");
  });

  it("ما يطلع الحساب الي نشتري منه أكثر مما نبيعه، حتى لو عنده مبيعات", async () => {
    customers = [lateBuyer("2", "مورّد يشتري شوية")];
    invoiceSums = [
      { customerId: "2", type: "SALE", _sum: { totalAmount: 16_250 } },
      { customerId: "2", type: "PURCHASE", _sum: { totalAmount: 359_793_396 } },
    ];
    assert.deepEqual(await getAtRiskCustomers(10), []);
  });

  it("يبقى بالقائمة لو مشترياتنا منه أقل من مبيعاتنا إله", async () => {
    customers = [lateBuyer("3", "زبون يبيعنا شوية")];
    invoiceSums = [
      { customerId: "3", type: "SALE", _sum: { totalAmount: 900_000 } },
      { customerId: "3", type: "PURCHASE", _sum: { totalAmount: 50_000 } },
    ];
    const rows = await getAtRiskCustomers(10);
    assert.equal(rows.length, 1);
  });
});
