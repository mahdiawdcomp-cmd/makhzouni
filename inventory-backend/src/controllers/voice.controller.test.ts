import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDeterministicDraftEdits,
  chooseMatch,
  matchScore,
  mergeDraftItems,
  normalizeIraqiText,
  resolvePendingCustomerSelection,
  resolvePendingProductSelection,
  resolveWarehouseSelection,
  shortReplyHint,
} from "./voice.controller";

test("normalizes common Arabic letter variants", () => {
  assert.equal(normalizeIraqiText("آلاء"), normalizeIraqiText("الاء"));
  assert.equal(normalizeIraqiText("طيّارة"), normalizeIraqiText("طياره"));
});

test("matches close Iraqi product and customer pronunciations", () => {
  assert.ok(matchScore("طياره", "طيارة أطفال") >= 0.48);
  assert.ok(matchScore("عباس", "عباس أحمد") >= 0.48);
  assert.ok(matchScore("محمد", "طائرة ريموت") < 0.48);
});

test("normalizes Iraqi keyboard letters and matches individual name tokens", () => {
  assert.equal(normalizeIraqiText("گارتون چاي"), normalizeIraqiText("كارتون جاي"));
  assert.ok(matchScore("شاي سيلاني", "شاي سيلاني ممتاز حجم كبير") >= 0.75);
  assert.ok(matchScore("ابو زهراء", "الحاج ابو زهراء الكرخي") >= 0.65);
});

test("keeps the invoice draft when the user gives a short Iraqi follow-up", () => {
  const draft = {
    type: "INVOICE" as const,
    customerName: "علي",
    items: [{ productName: "شاي", quantity: 2, unit: null, unitPrice: null }],
  };
  assert.match(shortReplyHint("آجل", draft), /CREDIT/);
  assert.match(shortReplyHint("كارتون", draft), /CARTON/);
  assert.match(shortReplyHint("نقد", draft), /CASH/);
});

test("resolves Iraqi confirmation and explicit names from pending customer suggestions", () => {
  const draft = {
    type: "INVOICE" as const,
    customerName: "مهدي",
    customerSuggestions: ["مهدي", "مرتضى ابو مهدي شارع السدره"],
    items: [{ productName: "سيارة", quantity: 10, unit: "PIECE" as const, unitPrice: null }],
  };

  assert.equal(resolvePendingCustomerSelection("اي هو", draft), "مهدي");
  assert.equal(resolvePendingCustomerSelection("لا فقط مهدي", draft), "مهدي");
  assert.equal(
    resolvePendingCustomerSelection("مرتضى ابو مهدي شارع السدرة", draft),
    "مرتضى ابو مهدي شارع السدره"
  );
});

test("prefers one exact normalized customer name over similar longer names", () => {
  const result = chooseMatch("مهدي", [
    { id: "1", name: "مرتضى ابو مهدي شارع السدره" },
    { id: "2", name: "مهدي" },
  ]);
  assert.equal(result.match?.id, "2");
});

test("resolves warehouse by Iraqi name, confirmation, and ordinal", () => {
  const warehouses = [
    { name: "المخزن الرئيسي" },
    { name: "مخزن العباسية" },
    { name: "مخزن شارع العباس" },
  ];
  assert.equal(
    resolveWarehouseSelection("اخذ من مخزن شارع العباس", { type: "INVOICE" }, warehouses),
    "مخزن شارع العباس"
  );
  assert.equal(
    resolveWarehouseSelection("اخذ من المخزن الثاني", { type: "INVOICE" }, warehouses),
    "مخزن العباسية"
  );
  assert.equal(
    resolveWarehouseSelection(
      "اي",
      { type: "INVOICE", warehouseSuggestions: ["مخزن شارع العباس"] },
      warehouses
    ),
    "مخزن شارع العباس"
  );
});

test("keeps the entered price and quantity when a warehouse follow-up omits item details", () => {
  const items = mergeDraftItems(
    {
      type: "INVOICE",
      customerName: "رسول ياباني",
      items: [{ productName: "سيارة", quantity: null, unit: null, unitPrice: null }],
      paymentType: "CASH",
    },
    {
      type: "INVOICE",
      customerName: "رسول ياباني",
      items: [{ productName: "سيارة", quantity: 5, unit: "PIECE", unitPrice: 1000 }],
      paymentType: "CASH",
      warehouseName: "مخزن شارع العباس",
    }
  );
  assert.equal(items?.[0].quantity, 5);
  assert.equal(items?.[0].unitPrice, 1000);
});

test("adds and removes invoice lines without replacing unrelated items", () => {
  const current = {
    type: "INVOICE" as const,
    items: [{ productName: "سيارة", quantity: 5, unit: "PIECE" as const, unitPrice: 1000 }],
  };
  const added = mergeDraftItems(
    {
      type: "INVOICE",
      items: [{ productName: "طيارة", quantity: 2, unit: "CARTON", unitPrice: 5000 }],
    },
    current,
    "ضيف وياها كارتونين طيارة"
  );
  assert.deepEqual(added?.map((item) => item.productName), ["سيارة", "طيارة"]);

  const removed = mergeDraftItems(
    {
      type: "INVOICE",
      items: [{ productName: "سيارة" }],
    },
    { ...current, items: added },
    "شيل سيارة"
  );
  assert.deepEqual(removed?.map((item) => item.productName), ["طيارة"]);
});

test("applies deterministic Iraqi edits for price, quantity, unit and payment", () => {
  const edited = applyDeterministicDraftEdits(
    "خلي العدد 7 كارتون وغير السعر 12000 آجل",
    {
      type: "INVOICE",
      items: [{ productName: "سيارة", quantity: 5, unit: "PIECE", unitPrice: 1000 }],
      paymentType: "CASH",
    }
  );
  assert.equal(edited.items?.[0].quantity, 7);
  assert.equal(edited.items?.[0].unit, "CARTON");
  assert.equal(edited.items?.[0].unitPrice, 12000);
  assert.equal(edited.paymentType, "CREDIT");
});

test("resolves a pending product suggestion by exact reply or confirmation", () => {
  const draft = {
    type: "INVOICE" as const,
    productSuggestions: ["سيارة أطفال", "سيارة ريموت"],
    pendingProductName: "سيارة",
  };
  assert.equal(resolvePendingProductSelection("سيارة ريموت", draft), "سيارة ريموت");
  assert.equal(resolvePendingProductSelection("اي هو", draft), "سيارة أطفال");
});
