export type InvoiceFinancialType = "SALE" | "PURCHASE" | "SALES_RETURN"

export function roundMoney(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100) / 100
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
