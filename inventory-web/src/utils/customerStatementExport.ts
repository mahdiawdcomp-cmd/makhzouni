import { getCustomerStatementsExport } from "../api/endpoints"
import type { CustomerStatementsExportEntry, CustomerTransaction } from "../types/api"
import { fmt } from "./fmt"
import { formatDate, formatDateTime } from "./date"
import { UNIT_LABELS } from "./units"

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
  if (t.includes("INVOICE")) return Number(row.debit) > 0 ? "فاتورة بيع" : Number(row.credit) > 0 ? "فاتورة شراء" : "فاتورة"
  return translateLastType(row.type)
}

// Merge INVOICE + INVOICE_PAYMENT rows for the same invoice into one row.
// The merged row shows: debit = invoice total, credit = amount paid on that invoice,
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
      if (!payment || !Number(payment.credit)) return row
      return { ...row, credit: payment.credit, runningBalance: payment.runningBalance }
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

/** Fetches every page of the bulk statement export, reporting progress as pages land. */
export async function fetchAllCustomerStatements(
  onProgress?: (done: number, total: number) => void,
): Promise<CustomerStatementsExportEntry[]> {
  const limit = 50
  let page = 1
  let pages = 1
  const all: CustomerStatementsExportEntry[] = []
  do {
    const { entries, pagination } = await getCustomerStatementsExport({ page, limit })
    all.push(...entries)
    pages = pagination?.pages ?? 1
    onProgress?.(all.length, pagination?.total ?? all.length)
    page += 1
  } while (page <= pages)
  return all
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch)
}

function renderTransactionDetail(row: CustomerTransaction): string {
  if (row.items?.length) {
    const itemsRows = row.items
      .map(
        (item) => `
      <tr>
        <td>${escapeHtml(item.productName)}${item.itemNumber ? ` <span class="muted">#${escapeHtml(item.itemNumber)}</span>` : ""}</td>
        <td>${item.quantity} ${UNIT_LABELS[item.unit as keyof typeof UNIT_LABELS] ?? item.unit}</td>
        <td>${fmt(item.unitPrice)}</td>
        <td>${fmt(item.totalPrice)}</td>
      </tr>`,
      )
      .join("")
    return `<table class="items-table"><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>${itemsRows}</tbody></table>`
  }
  if (row.description) {
    return `<div class="voucher-detail">${escapeHtml(row.description)}</div>`
  }
  return `<div class="voucher-detail muted">لا توجد تفاصيل إضافية</div>`
}

function renderCustomerSection(entry: CustomerStatementsExportEntry): string {
  const merged = mergeStatementRows(entry.transactions)
  const rows = merged
    .map(
      (row) => `
      <details class="tx-row">
        <summary>
          <span class="tx-date">${formatDate(row.date)}</span>
          <span class="tx-type">${escapeHtml(translateRow(row))}</span>
          <span class="tx-ref">${escapeHtml(row.referenceNumber)}</span>
          <span class="tx-debit">${row.debit ? fmt(row.debit) : ""}</span>
          <span class="tx-credit">${row.credit ? fmt(row.credit) : ""}</span>
          <span class="tx-balance">${fmt(row.runningBalance)}</span>
        </summary>
        <div class="tx-detail">${renderTransactionDetail(row)}</div>
      </details>`,
    )
    .join("")

  return `
    <details class="customer-section">
      <summary>
        <span class="customer-name">${escapeHtml(entry.customer.name)}</span>
        <span class="customer-phone">${escapeHtml(entry.customer.phone || "")}</span>
        <span class="customer-balance">الرصيد: ${fmt(entry.customer.currentBalance)}</span>
      </summary>
      <div class="statement-header-row">الرصيد الافتتاحي: ${fmt(entry.customer.openingBalance)}</div>
      <div class="tx-list">${rows || '<div class="muted">لا توجد حركات</div>'}</div>
    </details>`
}

/** Builds the single self-contained, offline-viewable HTML report (no JS needed — <details> handles collapse). */
export function buildStatementsHtmlReport(
  entries: CustomerStatementsExportEntry[],
  store: { storeName?: string; storeLogo?: string },
  generatedAt: Date,
): string {
  const sections = entries.map(renderCustomerSection).join("")
  return `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<title>الكشف العام</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
  * { box-sizing: border-box; }
  body { font-family: "Cairo","Segoe UI",Tahoma,sans-serif; background:#f8fafc; color:#0f172a; margin:0; padding:24px; }
  .report-header { display:flex; align-items:center; gap:12px; margin-bottom:20px; padding-bottom:16px; border-bottom:2px solid #4f46e5; }
  .report-header img { height:40px; width:40px; object-fit:contain; border-radius:8px; }
  .report-header h1 { font-size:20px; margin:0; color:#4f46e5; }
  .report-header .meta { font-size:12px; color:#64748b; margin-top:2px; }
  .customer-section { background:#fff; border:1px solid #e2e8f0; border-radius:10px; margin-bottom:10px; overflow:hidden; }
  .customer-section > summary { cursor:pointer; list-style:none; padding:12px 16px; display:flex; align-items:center; gap:16px; font-weight:700; }
  .customer-section > summary::-webkit-details-marker { display:none; }
  .customer-section > summary:hover { background:#f8fafc; }
  .customer-phone { color:#64748b; font-weight:500; font-size:13px; }
  .customer-balance { margin-inline-start:auto; color:#4f46e5; }
  .statement-header-row { padding:0 16px 8px; font-size:12px; color:#64748b; }
  .tx-list { padding:0 16px 16px; }
  .tx-row { border-top:1px solid #f1f5f9; }
  .tx-row > summary { cursor:pointer; list-style:none; display:grid; grid-template-columns: 90px 110px 1fr 100px 100px 110px; gap:8px; padding:8px 4px; font-size:13px; align-items:center; }
  .tx-row > summary::-webkit-details-marker { display:none; }
  .tx-row > summary:hover { background:#f8fafc; }
  .tx-detail { padding:8px 12px 14px; background:#f8fafc; border-radius:8px; margin:4px 0 8px; }
  .items-table { width:100%; border-collapse:collapse; font-size:12px; }
  .items-table th, .items-table td { padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right; }
  .voucher-detail { font-size:13px; color:#334155; }
  .muted { color:#94a3b8; }
</style>
</head>
<body>
  <div class="report-header">
    ${store.storeLogo ? `<img src="${store.storeLogo}" alt="logo" />` : ""}
    <div>
      <h1>${escapeHtml(store.storeName || "الكشف العام")}</h1>
      <div class="meta">الكشف العام لكل الزبائن — تاريخ التوليد: ${formatDateTime(generatedAt.toISOString())}</div>
    </div>
  </div>
  ${sections || '<div class="muted">لا يوجد زبائن لديهم حركات</div>'}
</body>
</html>`
}
