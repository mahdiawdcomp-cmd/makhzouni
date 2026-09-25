import { test } from "node:test"
import assert from "node:assert/strict"
import { calculateInvoiceFinancials, lineTotal, priceWithFils, roundMoney } from "./financial"

/**
 * قواعد الفلوس بالشاشة، ولازم تطابق السيرفر حرفياً:
 *
 *   • السعر يقبل الكسر (خانتان — نفس عمود قاعدة البيانات).
 *   • مجموع السطر دينار صحيح.
 *   • مجموع الفاتورة = جمع سطور صحيحة، فالي ينطبع يجمع بالضبط.
 *
 * كانت الشاشة تقرّب لخانتين والسيرفر لدينار، فنفس الفاتورة تطلع برقمين.
 */

test("المجاميع دنانير صحيحة", () => {
  assert.equal(roundMoney(112000.2898), 112000)
  assert.equal(roundMoney(0.6), 1)
  assert.equal(roundMoney(0.4), 0)
  assert.equal(roundMoney(-1234.567), -1235)
  assert.equal(roundMoney(Number.NaN), 0)
})

test("السعر المكسور ينقبل، ومجموع السطر يطلع نظيف", () => {
  // الحالة الي اشتكى منها: ١٢ قطعة بسعر ٨٣٣٫٣٣ لازم تطلع ١٠٬٠٠٠ لا ٩٩٩٩٫٩٦.
  assert.equal(lineTotal(12, 833.33), 10000)
  assert.equal(lineTotal(1, 833.33), 833)
  assert.equal(lineTotal(0, 999.99), 0)
  // السعر نفسه ما ينلمس — الي ينقرّب هو المجموع.
  assert.equal(priceWithFils(833.333), 833.33)
  assert.equal(priceWithFils(1583.5), 1583.5)
})

test("مجموع الفاتورة = جمع سطور مقرّبة، مو تقريب جمع مكسور", () => {
  const lines = [
    { quantity: 3, unitPrice: 0.5 },   // ١٫٥ → سطر بدينارين
    { quantity: 3, unitPrice: 0.5 },
  ]
  const sum = lines.reduce((total, line) => total + lineTotal(line.quantity, line.unitPrice), 0)
  // ٢ + ٢ = ٤، مو تقريب (١٫٥ + ١٫٥) = ٣. الفرق دينار، وهو بالضبط الي يخلي
  // الزبون يجمع السطور ويطلعله غير المكتوب بالمجموع.
  assert.equal(sum, 4)
})

test("حسبة الفاتورة كلها تبقى بدنانير صحيحة", () => {
  const result = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 112000,
    discount: 0.6,
    tax: 0,
    paidAmount: 50000.4,
    previousBalance: 0,
  })
  assert.equal(result.discount, 1)
  assert.equal(result.totalAmount, 111999)
  assert.equal(result.paidAmount, 50000)
  assert.equal(result.remainingAmount, 61999)
  for (const [name, value] of Object.entries(result)) {
    if (typeof value === "number") {
      assert.equal(value, Math.round(value), `${name} لازم يكون دينار صحيح`)
    }
  }
})
