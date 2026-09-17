/**
 * «مزاد تصفية الراكد» — the pricing rule, the one-hour extension and the phone
 * masking, without a database.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EXTENSION_MS, extendedEnd, maskPhone, nextBidAmount, toNationalPhone } from "./auction.service";

const base = { startPrice: 5000, incrementType: "AMOUNT" as const, incrementValue: 1000, currentPrice: null, bidCount: 0 };

describe("سعر المزايدة التالية", () => {
  it("أول مزايدة هي سعر البداية", () => {
    assert.equal(nextBidAmount(base), 5000);
  });

  it("مبلغ ثابت يضاف على أعلى سعر", () => {
    assert.equal(nextBidAmount({ ...base, currentPrice: 7000, bidCount: 3 }), 8000);
  });

  it("النسبة تنحسب من أعلى سعر وتتقرّب لفوق لأقرب ٢٥٠", () => {
    // 5% of 10,300 = 515 → 750
    assert.equal(nextBidAmount({ ...base, incrementType: "PERCENT", incrementValue: 5, currentPrice: 10300, bidCount: 1 }), 11050);
  });

  it("المزاد اللي يبدي من صفر ما يقبل مزايدة صفر", () => {
    assert.equal(nextBidAmount({ ...base, startPrice: 0 }), 1000);
    assert.equal(nextBidAmount({ ...base, startPrice: 0, incrementType: "PERCENT", incrementValue: 5 }), 250);
  });

  it("النسبة على سعر صغير ما تنزل تحت ٢٥٠", () => {
    assert.equal(nextBidAmount({ ...base, incrementType: "PERCENT", incrementValue: 5, currentPrice: 1000, bidCount: 1 }), 1250);
  });
});

describe("تمديد الوقت", () => {
  const end = new Date("2026-09-20T18:00:00.000Z");

  it("مزايدة بآخر ٥ دقايق تمدد ساعة كاملة", () => {
    const extended = extendedEnd(end, new Date("2026-09-20T17:56:00.000Z"));
    assert.equal(extended?.getTime(), end.getTime() + EXTENSION_MS);
  });

  it("بالضبط على حد ٥ دقايق تمدد", () => {
    assert.ok(extendedEnd(end, new Date("2026-09-20T17:55:00.000Z")));
  });

  it("قبل آخر ٥ دقايق ما تمدد", () => {
    assert.equal(extendedEnd(end, new Date("2026-09-20T17:54:59.000Z")), null);
  });

  it("بعد انتهاء الوقت ما تمدد", () => {
    assert.equal(extendedEnd(end, new Date("2026-09-20T18:00:01.000Z")), null);
  });
});

describe("الأرقام", () => {
  it("يخفي وسط الرقم للزوار", () => {
    assert.equal(maskPhone("9647701234567"), "0770•••••67");
  });

  it("يرجع الرقم بصيغة 07 للتاجر", () => {
    assert.equal(toNationalPhone("9647701234567"), "07701234567");
    assert.equal(toNationalPhone("07701234567"), "07701234567");
  });
});
