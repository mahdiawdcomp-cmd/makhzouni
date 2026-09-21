import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeArabic, scoreProduct } from "./search"

test("Iraqi and Persian-keyboard letters fold to their Arabic base", () => {
  assert.equal(normalizeArabic("ڤيمتو"), normalizeArabic("فيمتو"))
  assert.equal(normalizeArabic("گلاص"), normalizeArabic("كلاص"))
  assert.equal(normalizeArabic("پيبسي"), normalizeArabic("بيبسي"))
  assert.equal(normalizeArabic("چاي"), normalizeArabic("جاي"))
  assert.equal(normalizeArabic("کیک"), normalizeArabic("كيك"))
})

test("a rep's spelling finds the shop's spelling", () => {
  const product = { name: "بيبسي علبة", itemNumber: "P-100", category: "مشروبات" }
  assert.ok(scoreProduct(product, "بيبسى") > 0, "ى must match ي")
  assert.ok(scoreProduct({ ...product, name: "ڤيمتو" }, "فيمتو") > 0, "ڤ must match ف")
  assert.equal(scoreProduct(product, "شاي"), 0, "an unrelated word must not match")
})

test("the closest match ranks first", () => {
  const exact = scoreProduct({ name: "بيبسي", itemNumber: "1" }, "بيبسي")
  const contains = scoreProduct({ name: "علبة بيبسي كبيرة", itemNumber: "2" }, "بيبسي")
  assert.ok(exact > contains)
})
