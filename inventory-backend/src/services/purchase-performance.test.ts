/**
 * أداء المشتريات — the sharing rule and the grades, without a database.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { allocateSales, gradeLots, type LotInput, type SaleEvent } from "./purchase-performance.service";

const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 24 * 60 * 60 * 1000);

function lot(over: Partial<LotInput> = {}): LotInput {
  return {
    lotId: "l1", invoiceId: "i1", invoiceNumber: "P-1", supplierName: "مورد", date: day(0),
    source: "REGULAR", productId: "p1", productName: "باربي", itemNumber: "AB1", thumbnailUrl: null, pcsPerCarton: 12,
    salePrice: 1000, orderedPieces: 100, costPerPiece: 600,
    ...over,
  };
}

const sale = (productId: string, when: number, pieces: number, revenue = pieces * 1000): SaleEvent =>
  ({ productId, date: day(when), pieces, revenue });

describe("توزيع البيع على الأوردرات", () => {
  it("يوزّع البيعة حسب الباقي من كل أوردر", () => {
    const lots = [lot({ lotId: "old", orderedPieces: 100 }), lot({ lotId: "new", orderedPieces: 50, date: day(1) })];
    const { states } = allocateSales(lots, [sale("p1", 2, 30)]);
    const old = states.find((s) => s.lotId === "old")!;
    const fresh = states.find((s) => s.lotId === "new")!;
    assert.equal(Math.round(old.sold), 20, "١٠٠ من ١٥٠");
    assert.equal(Math.round(fresh.sold), 10, "٥٠ من ١٥٠");
  });

  it("ما ينسب بيعة لأوردر وصل بعدها", () => {
    const lots = [lot({ lotId: "old" }), lot({ lotId: "later", date: day(10) })];
    const { states } = allocateSales(lots, [sale("p1", 5, 40)]);
    assert.equal(states.find((s) => s.lotId === "old")!.sold, 40);
    assert.equal(states.find((s) => s.lotId === "later")!.sold, 0);
  });

  it("الأوردر اللي خلص يطلع من التوزيع", () => {
    const lots = [lot({ lotId: "small", orderedPieces: 10 }), lot({ lotId: "big", orderedPieces: 90 })];
    const { states } = allocateSales(lots, [sale("p1", 1, 50), sale("p1", 2, 40)]);
    const small = states.find((s) => s.lotId === "small")!;
    const big = states.find((s) => s.lotId === "big")!;
    assert.ok(small.sold <= 10 + 1e-9, "ما يتجاوز كميته");
    assert.equal(Math.round(small.sold + big.sold), 90);
  });

  it("البيع الزايد عن كل الأوردرات ما ينسب لأحد", () => {
    const { states, unattributedPieces } = allocateSales([lot({ orderedPieces: 20 })], [sale("p1", 1, 30)]);
    assert.equal(states[0].sold, 20);
    assert.equal(unattributedPieces, 10);
  });

  it("المرتجع يرجّع القطع والإيراد للأوردر اللي باعها", () => {
    const { states } = allocateSales([lot()], [sale("p1", 1, 40, 40_000), sale("p1", 2, -10, -10_000)]);
    assert.equal(states[0].sold, 30);
    assert.equal(states[0].revenue, 30_000);
  });

  it("مادة ثانية ما تأثر", () => {
    const { states } = allocateSales([lot()], [sale("p2", 1, 40)]);
    assert.equal(states[0].sold, 0);
  });
});

describe("التقييم والتصنيف", () => {
  const now = day(30);

  it("يحسب الربح من كلفة الأوردر نفسه", () => {
    const { states } = allocateSales([lot({ costPerPiece: 700 })], [sale("p1", 1, 10, 10_000)]);
    const [row] = gradeLots(states, now);
    assert.equal(row.cost, 7_000);
    assert.equal(row.profit, 3_000);
    assert.equal(row.margin, 30);
    assert.equal(row.marginIsExpected, false);
  });

  it("السريع والمربح يصير الأفضل، والبطيء قليل الربح راكد", () => {
    const lots = [
      lot({ lotId: "star", productId: "a", costPerPiece: 400 }),
      lot({ lotId: "mid", productId: "b", costPerPiece: 600 }),
      lot({ lotId: "dog", productId: "c", costPerPiece: 900 }),
    ];
    const events = [sale("a", 2, 90), sale("b", 5, 40), sale("c", 20, 5)];
    const rows = gradeLots(allocateSales(lots, events).states, now);
    const by = (id: string) => rows.find((r) => r.lotId === id)!;
    assert.equal(by("star").category, "BEST");
    assert.equal(by("dog").category, "STAGNANT");
    assert.ok(by("star").score > by("mid").score && by("mid").score > by("dog").score);
  });

  it("الربح العالي لازم يكون مباع — المادة اللي ما انباعت راكدة حتى لو هامشها المتوقع عالي", () => {
    const lots = [
      lot({ lotId: "sells", productId: "a", costPerPiece: 800 }),
      lot({ lotId: "unsold", productId: "b", costPerPiece: 100 }),
    ];
    const rows = gradeLots(allocateSales(lots, [sale("a", 3, 20)]).states, now);
    const unsold = rows.find((r) => r.lotId === "unsold")!;
    assert.equal(unsold.category, "STAGNANT");
    assert.equal(unsold.marginIsExpected, true);
    assert.equal(unsold.margin, 90, "من سعر البيع الحالي");
  });

  it("المواد اللي ما انباعت ما تنزّل تصنيف المواد اللي تبيع", () => {
    // The shop's best seller must not be graded "low profit" just because two
    // unsold lots promise a higher margin on paper.
    const lots = [
      lot({ lotId: "star", productId: "a", costPerPiece: 400 }),
      lot({ lotId: "mid", productId: "b", costPerPiece: 600 }),
      lot({ lotId: "weak", productId: "c", costPerPiece: 900 }),
      lot({ lotId: "dream1", productId: "d", costPerPiece: 50 }),
      lot({ lotId: "dream2", productId: "e", costPerPiece: 60 }),
    ];
    const events = [sale("a", 2, 90), sale("b", 5, 40), sale("c", 20, 5)];
    const rows = gradeLots(allocateSales(lots, events).states, now);
    const star = rows.find((r) => r.lotId === "star")!;
    assert.equal(star.profitLevel, "HIGH");
    assert.equal(star.category, "BEST");
    assert.equal(rows.find((r) => r.lotId === "dream1")!.category, "STAGNANT");
  });

  it("الأوردر الجديد بلا بيع ما يعتبر راكد", () => {
    const rows = gradeLots(allocateSales([lot({ date: day(27) })], []).states, now);
    assert.equal(rows[0].category, "NEW");
    assert.equal(rows[0].score, -1);
  });

  it("الأوردر اللي خلص تنحسب مدته لحد آخر بيعة", () => {
    const rows = gradeLots(allocateSales([lot()], [sale("p1", 4, 100)]).states, now);
    assert.equal(rows[0].soldOut, true);
    assert.equal(rows[0].daysActive, 4);
    assert.equal(rows[0].piecesPerDay, 25);
    assert.equal(rows[0].daysToSellOut, null);
  });

  it("يقدّر متى يخلص الباقي", () => {
    const rows = gradeLots(allocateSales([lot()], [sale("p1", 5, 30)]).states, now);
    assert.equal(rows[0].piecesPerDay, 1);
    assert.equal(rows[0].daysToSellOut, 70);
  });
});
