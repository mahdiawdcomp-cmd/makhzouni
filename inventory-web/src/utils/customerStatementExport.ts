import type { CustomerTransaction } from "../types/api"

export function translateLastType(type: string): string {
  const t = type.toUpperCase()
  if (t === "RECEIPT") return "سند قبض"
  if (t === "PAYMENT") return "سند دفع"
  if (t === "EXPENSE") return "سند مصاريف"
  if (t === "SALE") return "فاتورة بيع"
  if (t === "PURCHASE") return "فاتورة شراء"
  if (t === "SALES_RETURN") return "فاتورة مرتجع"
  if (t.includes("INVOICE")) return "فاتورة"
  if (t.includes("VOUCHER")) return "سند"
  return type
}

export function translateRow(row: CustomerTransaction): string {
  const t = String(row.type ?? "").toUpperCase()
  if (row.status === "CANCELLED") return "فاتورة ملغاة"
  if (t === "RECEIPT") return "سند قبض"
  if (t === "PAYMENT") return "سند دفع"
  if (t === "INVOICE_PAYMENT") return "دفعة"
  if (t === "EXPENSE") return "مصاريف"
  if (t === "SALE") return "فاتورة بيع"
  if (t === "PURCHASE") return "فاتورة شراء"
  if (t === "SALES_RETURN") return "فاتورة مرتجع"
  if (t.includes("INVOICE")) {
    // Read the actual invoice type instead of guessing from which side
    // (debit/credit) is non-zero — a paid PURCHASE invoice legitimately has
    // BOTH a debit (the folded payment) and a credit (the purchase amount)
    // on the same merged row, so a debit-first guess mislabels it "فاتورة بيع".
    if (row.invoiceType === "SALE") return "فاتورة بيع"
    if (row.invoiceType === "PURCHASE") return "فاتورة شراء"
    if (row.invoiceType === "SALES_RETURN") return "فاتورة مرتجع"
    return "فاتورة"
  }
  return translateLastType(row.type)
}

// Merge INVOICE + INVOICE_PAYMENT rows for the same invoice into one row.
// A SALE invoice paid upfront carries its payment as a CREDIT (reduces what
// the customer owes); a PURCHASE invoice paid upfront carries it as a DEBIT
// (reduces what we owe the supplier) — only one side is ever non-zero on the
// payment row, so fold whichever side it is instead of assuming credit.
// (Bug fixed 2026-08-07: the old code only ever copied `payment.credit`, so a
// paid PURCHASE invoice's payment silently disappeared from the statement —
// the row was always dropped by the filter below, but never folded back in
// because its amount lived in `debit`, not `credit`.)
// runningBalance = balance after both (i.e. from the INVOICE_PAYMENT row).
export function mergeStatementRows(rows: CustomerTransaction[]): CustomerTransaction[] {
  const payments = new Map<string, CustomerTransaction>()
  for (const row of rows) {
    if (row.type === "INVOICE_PAYMENT") payments.set(row.id, row)
  }
  return rows
    .filter((row) => row.type !== "INVOICE_PAYMENT")
    .map((row) => {
      if (row.type !== "INVOICE") return row
      const payment = payments.get(row.id)
      if (!payment) return row
      const paymentCredit = Number(payment.credit) || 0
      const paymentDebit = Number(payment.debit) || 0
      if (!paymentCredit && !paymentDebit) return row
      return {
        ...row,
        credit: (Number(row.credit) || 0) + paymentCredit,
        debit: (Number(row.debit) || 0) + paymentDebit,
        runningBalance: payment.runningBalance,
      }
    })
}

export function lastActivityLink(last: { type?: string; id?: string } | undefined | null): string | null {
  if (!last?.id || !last?.type) return null
  const t = String(last.type).toUpperCase()
  if (t.includes("VOUCHER") || t === "RECEIPT" || t === "PAYMENT" || t === "EXPENSE") return `/vouchers/${last.id}`
  if (t.includes("INVOICE") || t === "SALE" || t === "PURCHASE" || t === "SALES_RETURN") return `/invoices/${last.id}`
  return null
}

export function transactionLink(row: CustomerTransaction): string | null {
  if (!row.id || !row.type) return null
  const t = String(row.type).toUpperCase()
  if (t.includes("INVOICE") || t === "SALE" || t === "PURCHASE" || t === "SALES_RETURN") return `/invoices/${row.id}`
  if (t.includes("VOUCHER") || t === "RECEIPT" || t === "PAYMENT" || t === "EXPENSE") return `/vouchers/${row.id}`
  return null
}

export function transactionTone(row: CustomerTransaction) {
  const type = String(row.type ?? "").toUpperCase()
  const status = String(row.status ?? "").toUpperCase()
  const isInvoice = type.includes("INVOICE") || type === "SALE" || type === "PURCHASE" || type === "SALES_RETURN"
  const isVoucher = type.includes("VOUCHER") || type === "RECEIPT" || type === "PAYMENT" || type === "EXPENSE"

  if (status === "CANCELLED") {
    return {
      row: "border-r-4 border-rose-500 bg-rose-50/80 hover:bg-rose-100/80",
      style: { backgroundColor: "#FFF1F2", borderRight: "4px solid #F43F5E" },
      label: "bg-rose-100 text-rose-700 border border-rose-200",
    }
  }
  if (isInvoice) {
    return {
      row: "border-r-4 border-blue-500 bg-blue-50/70 hover:bg-blue-100/70",
      style: { backgroundColor: "#EFF6FF", borderRight: "4px solid #3B82F6" },
      label: "bg-blue-100 text-blue-700 border border-blue-200",
    }
  }
  if (isVoucher) {
    return {
      row: "border-r-4 border-emerald-500 bg-emerald-50/70 hover:bg-emerald-100/70",
      style: { backgroundColor: "#ECFDF5", borderRight: "4px solid #10B981" },
      label: "bg-emerald-100 text-emerald-700 border border-emerald-200",
    }
  }
  return {
    row: "border-r-4 border-slate-300 hover:bg-slate-50",
    style: { borderRight: "4px solid #CBD5E1" },
    label: "bg-slate-100 text-slate-700 border border-slate-200",
  }
}

// ---- "حفظ الكشف العام" — master statement HTML export ----

export interface StatementExportFilter {
  customerFilter?: "all" | "withBalance" | "inactive"
  inactiveDays?: number
  from?: string
  to?: string
  all?: boolean
}
