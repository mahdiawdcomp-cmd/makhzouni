import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeArabic, scoreProduct, scoreCustomer } from "./arabic-search";

describe("normalizeArabic", () => {
  it("folds alef variants أ/إ/آ → ا", () => {
    assert.equal(normalizeArabic("أحمد"), normalizeArabic("احمد"));
    assert.equal(normalizeArabic("إبراهيم"), normalizeArabic("ابراهيم"));
    assert.equal(normalizeArabic("آدم"), normalizeArabic("ادم"));
  });
  it("treats ة/ه and ى/ي as the same", () => {
    assert.equal(normalizeArabic("مجنونة"), normalizeArabic("مجنونه"));
    assert.equal(normalizeArabic("كبرى"), normalizeArabic("كبري"));
  });
  it("strips tashkeel, tatweel and collapses spaces, normalizes digits", () => {
    assert.equal(normalizeArabic("مَكـتب"), "مكتب");
    assert.equal(normalizeArabic("  بيبسي   كبير "), "بيبسي كبير");
    assert.equal(normalizeArabic("٧٠٠"), "700");
  });
});

describe("scoreProduct ranking", () => {
  const p = (over: Partial<Parameters<typeof scoreProduct>[0]> = {}) => ({
    name: "مجنونة شحن ستيرن كبير",
    itemNumber: "AWD-700",
    qrCode: "PCS-abc",
    cartonQrCode: "CTN-xyz",
    category: "شواحن",
    ...over,
  });

  it("multi-term: 'مجنونة كبير' matches the spread-out name", () => {
    assert.ok(scoreProduct(p(), "مجنونة كبير") >= 3);
  });
  it("normalizes letters: 'مجنونه' finds 'مجنونة'", () => {
    assert.ok(scoreProduct(p(), "مجنونه") >= 2);
  });
  it("exact item number scores highest (6)", () => {
    assert.equal(scoreProduct(p(), "AWD-700"), 6);
  });
  it("code prefix scores 5", () => {
    assert.equal(scoreProduct(p(), "AWD"), 5);
  });
  it("whole phrase in name scores 4", () => {
    assert.equal(scoreProduct(p(), "شحن ستيرن"), 4);
  });
  it("non-matching query scores 0", () => {
    assert.equal(scoreProduct(p(), "بيبسي كولا غازية"), 0);
  });
  it("ranks exact code above name token match", () => {
    const exact = scoreProduct(p({ name: "شيء آخر" }), "AWD-700");
    const tokens = scoreProduct(p(), "مجنونة");
    assert.ok(exact > tokens);
  });
});

describe("scoreCustomer ranking", () => {
  const c = { name: "أحمد علي", phone: "07701234567", address: "بغداد" };
  it("exact phone scores 6", () => {
    assert.equal(scoreCustomer(c, "07701234567"), 6);
  });
  it("phone with separators still matches", () => {
    assert.ok(scoreCustomer(c, "0770 123 4567") >= 5);
  });
  it("normalized name: 'احمد' finds 'أحمد'", () => {
    assert.ok(scoreCustomer(c, "احمد") >= 2);
  });
});
