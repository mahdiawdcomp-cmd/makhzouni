export type InvoiceFinancialType = "SALE" | "PURCHASE" | "SALES_RETURN"

/**
 * كل مبلغ نهائي دينار صحيح — نفس قاعدة السيرفر بالضبط.
 *
 * السعر نفسه يبقى مثل ما كتبته، كسراً كان أو لا. الي ينقرّب هو **مجموع
 * السطر**: ١٢ قطعة بسعر ٨٣٣٫٣٣ = ٩٩٩٩٫٩٦ → ١٠٬٠٠٠، ومجموع الفاتورة يصير
 * جمع سطور صحيحة، فالي ينطبع على الورقة يجمع بالضبط.
 *
 * كانت هنا نسخة تقرّب لخانتين بينما السيرفر يقرّب لدينار — فالشاشة تعرض
 * ١١٢٠٠٠٫٢٩ والسيرفر يحفظ ١١٢٠٠٠، ورقمان مختلفان لنفس الفاتورة.
 */
export function roundMoney(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.round(value + Number.EPSILON)
}

/**
 * مجموع سطر واحد بالدينار الصحيح. كل شاشة تحسب مجموع سطر لازم تمر من هنا،
 * وإلا تختلف شاشة عن شاشة بدينار — والزبون يجمع السطور بيده ويطلعله رقم
 * غير الي مكتوب بالمجموع.
 */
export function lineTotal(quantity: number, unitPrice: number) {
  return roundMoney((Number(quantity) || 0) * (Number(unitPrice) || 0))
}

/**
 * السعر يقبل الكسر — لحد خانتين، لأن عمود السعر بقاعدة البيانات خانتان.
 *
 * التقريب يصير هنا وإنت تشوفه، لا بصمت بعد الحفظ: بدونه تكتب ٨٣٣٫٣٣٣ وتشوفها
 * على الشاشة بينما المحفوظ ٨٣٣٫٣٣، ويطلع رقمان لنفس المادة.
 */
export function priceWithFils(value: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function calculateInvoiceFinancials(input: {
  type: InvoiceFinancialType
  subtotal: number
  discount?: number
  tax?: number
  paidAmount?: number
  previousBalance?: number
}) {
  const subtotal = roundMoney(Math.max(0, input.subtotal))
  const discount = roundMoney(Math.max(0, input.discount ?? 0))
  const tax = roundMoney(Math.max(0, input.tax ?? 0))
  const requestedPaid = roundMoney(Math.max(0, input.paidAmount ?? 0))
  const totalAmount = roundMoney(subtotal - discount + tax)
  const paidAmount = roundMoney(Math.min(requestedPaid, Math.max(0, totalAmount)))
  const overpayment = roundMoney(Math.max(0, requestedPaid - Math.max(0, totalAmount)))
  const remainingAmount = roundMoney(Math.max(0, totalAmount - paidAmount))
  const balanceDelta = roundMoney((input.type === "SALE" ? 1 : -1) * remainingAmount)

  return {
    subtotal,
    discount,
    tax,
    totalAmount,
    paidAmount,
    overpayment,
    remainingAmount,
    balanceDelta,
    finalBalance: roundMoney((input.previousBalance ?? 0) + balanceDelta),
    paymentType: remainingAmount <= 0 ? "CASH" as const : paidAmount > 0 ? "PARTIAL" as const : "CREDIT" as const,
  }
}
