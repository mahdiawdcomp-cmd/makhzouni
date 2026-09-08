/**
 * «الكشف العام» — the master statement, rendered as one self-contained HTML file.
 *
 * This lived only in the browser (inventory-web / inventory-desktop-trial
 * `utils/customerStatementExport.ts`). It had to move here so the nightly
 * Windows scheduled task can produce the same file with the app closed: an
 * installed machine has no Node and no node_modules, so nothing on it can run
 * the TypeScript builder. The clients call this endpoint too, which keeps the
 * file the merchant downloads by hand byte-identical to the archived one — a
 * second copy of this markup is exactly how the statement export grew three
 * diverging implementations before.
 *
 * No JavaScript in the output: <details> does the collapsing, so the file opens
 * offline, years later, in any browser.
 */

/** What the builder reads off a statement row. Deliberately loose — the row
 *  comes from buildCustomerStatement() and carries more than this. */
interface StatementRow {
  id: string;
  date: string | Date;
  type?: string | null;
  invoiceType?: string | null;
  status?: string | null;
  referenceNumber?: string | null;
  description?: string | null;
  debit?: unknown;
  credit?: unknown;
  runningBalance?: unknown;
  items?: Array<{
    productName?: string | null;
    itemNumber?: string | null;
    quantity?: unknown;
    unit?: string | null;
    unitPrice?: unknown;
    totalPrice?: unknown;
  }> | null;
}

export interface StatementExportEntry {
  customer: {
    name: string;
    phone?: string | null;
    openingBalance?: unknown;
    currentBalance?: unknown;
  };
  transactions: StatementRow[];
}

const UNIT_LABELS: Record<string, string> = {
  PIECE: "قطعة",
  DOZEN: "درزن",
  BOX: "علبة",
  CARTON: "كرتون",
};

/* ── Formatting ───────────────────────────────────────────────────────────
   The browser formatted in the merchant's own timezone. This runs on a UTC
   server, so a row booked at 9pm Baghdad would print as the NEXT day unless
   the caller says where it is being read. `timeZone` is passed in rather than
   assumed: this codebase is shared by every tenant, and a hardcoded Baghdad
   would be wrong for the next shop.                                        */

function fmt(value: unknown): string {
  const n = Number(value ?? 0);
  if (Number.isNaN(n)) return "0";
  return n.toLocaleString("en-US");
}

function formatDate(value: string | Date | null | undefined, timeZone: string): string {
  if (!value) return "-";
  const s = typeof value === "string" ? value : value.toISOString();
  // A date-only string is a calendar date, not an instant — shifting it into a
  // timezone is what turns "2026-09-01" into "8/31/2026".
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { dateStyle: "short", timeZone: "UTC" });
  }
  return new Date(s).toLocaleDateString("en-US", { dateStyle: "short", timeZone });
}

function formatDateTime(value: Date, timeZone: string): string {
  return value.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short", timeZone });
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/* ── Row labelling (mirrors translateRow / translateLastType) ───────────── */

function translateLastType(type: string): string {
  const t = type.toUpperCase();
  if (t === "RECEIPT") return "سند قبض";
  if (t === "PAYMENT") return "سند دفع";
  if (t === "EXPENSE") return "سند مصاريف";
  if (t === "SALE") return "فاتورة بيع";
  if (t === "PURCHASE") return "فاتورة شراء";
  if (t === "SALES_RETURN") return "فاتورة مرتجع";
  if (t.includes("INVOICE")) return "فاتورة";
  if (t.includes("VOUCHER")) return "سند";
  return type;
}

function translateRow(row: StatementRow): string {
  const t = String(row.type ?? "").toUpperCase();
  if (row.status === "CANCELLED") return "فاتورة ملغاة";
  if (t === "RECEIPT") return "سند قبض";
  if (t === "PAYMENT") return "سند دفع";
  if (t === "INVOICE_PAYMENT") return "دفعة";
  if (t === "EXPENSE") return "مصاريف";
  if (t === "SALE") return "فاتورة بيع";
  if (t === "PURCHASE") return "فاتورة شراء";
  if (t === "SALES_RETURN") return "فاتورة مرتجع";
  if (t.includes("INVOICE")) {
    // Read the actual invoice type instead of guessing from which side
    // (debit/credit) is non-zero — a paid PURCHASE invoice legitimately has
    // BOTH a debit (the folded payment) and a credit (the purchase amount)
    // on the same merged row, so a debit-first guess mislabels it "فاتورة بيع".
    if (row.invoiceType === "SALE") return "فاتورة بيع";
    if (row.invoiceType === "PURCHASE") return "فاتورة شراء";
    if (row.invoiceType === "SALES_RETURN") return "فاتورة مرتجع";
    return "فاتورة";
  }
  return translateLastType(String(row.type ?? ""));
}

/* ── Rendering ─────────────────────────────────────────────────────────── */

/**
 * Fold each invoice's own payment row back into the invoice line.
 *
 * The statement carries a paid invoice as two rows sharing one id: the invoice
 * and its INVOICE_PAYMENT. Printed separately they read as two dealings, and
 * the invoice line shows a running balance the payment has already moved on
 * from. Mirrors mergeStatementRows() on the clients — the two must agree or
 * the archived file stops matching the one the merchant downloads by hand.
 */
function mergeStatementRows(rows: StatementRow[]): StatementRow[] {
  const payments = new Map<string, StatementRow>();
  for (const row of rows) {
    if (row.type === "INVOICE_PAYMENT") payments.set(row.id, row);
  }
  return rows
    .filter((row) => row.type !== "INVOICE_PAYMENT")
    .map((row) => {
      if (row.type !== "INVOICE") return row;
      const payment = payments.get(row.id);
      if (!payment) return row;
      const paymentCredit = Number(payment.credit) || 0;
      const paymentDebit = Number(payment.debit) || 0;
      if (!paymentCredit && !paymentDebit) return row;
      return {
        ...row,
        credit: (Number(row.credit) || 0) + paymentCredit,
        debit: (Number(row.debit) || 0) + paymentDebit,
        runningBalance: payment.runningBalance,
      };
    });
}

function renderTransactionDetail(row: StatementRow): string {
  if (row.items?.length) {
    const itemsRows = row.items
      .map(
        (item) => `
      <tr>
        <td>${escapeHtml(item.productName)}${item.itemNumber ? ` <span class="muted">#${escapeHtml(item.itemNumber)}</span>` : ""}</td>
        <td>${escapeHtml(item.quantity)} ${UNIT_LABELS[String(item.unit ?? "")] ?? escapeHtml(item.unit)}</td>
        <td>${fmt(item.unitPrice)}</td>
        <td>${fmt(item.totalPrice)}</td>
      </tr>`,
      )
      .join("");
    return `<table class="items-table"><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>${itemsRows}</tbody></table>`;
  }
  if (row.description) {
    return `<div class="voucher-detail">${escapeHtml(row.description)}</div>`;
  }
  return `<div class="voucher-detail muted">لا توجد تفاصيل إضافية</div>`;
}

function renderCustomerSection(entry: StatementExportEntry, timeZone: string): string {
  const rows = mergeStatementRows(entry.transactions)
    .map(
      (row) => `
      <details class="tx-row">
        <summary>
          <span class="tx-date">${formatDate(row.date, timeZone)}</span>
          <span class="tx-type">${escapeHtml(translateRow(row))}</span>
          <span class="tx-ref">${escapeHtml(row.referenceNumber)}</span>
          <span class="tx-debit">${Number(row.debit ?? 0) ? fmt(row.debit) : ""}</span>
          <span class="tx-credit">${Number(row.credit ?? 0) ? fmt(row.credit) : ""}</span>
          <span class="tx-balance">${fmt(row.runningBalance)}</span>
        </summary>
        <div class="tx-detail">${renderTransactionDetail(row)}</div>
      </details>`,
    )
    .join("");

  return `
    <details class="customer-section">
      <summary>
        <span class="customer-name">${escapeHtml(entry.customer.name)}</span>
        <span class="customer-phone">${escapeHtml(entry.customer.phone || "")}</span>
        <span class="customer-balance">الرصيد: ${fmt(entry.customer.currentBalance)}</span>
      </summary>
      <div class="statement-header-row">الرصيد الافتتاحي: ${fmt(entry.customer.openingBalance)}</div>
      <div class="tx-list">${rows || '<div class="muted">لا توجد حركات</div>'}</div>
    </details>`;
}

/** One self-contained, offline-viewable HTML report (no JS — <details> collapses). */
export function buildStatementsHtmlReport(
  entries: StatementExportEntry[],
  store: { storeName?: string | null; storeLogo?: string | null },
  generatedAt: Date,
  timeZone = "UTC",
): string {
  const sections = entries.map((entry) => renderCustomerSection(entry, timeZone)).join("");
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
    ${store.storeLogo ? `<img src="${escapeHtml(store.storeLogo)}" alt="logo" />` : ""}
    <div>
      <h1>${escapeHtml(store.storeName || "الكشف العام")}</h1>
      <div class="meta">الكشف العام لكل الزبائن — تاريخ التوليد: ${formatDateTime(generatedAt, timeZone)}</div>
    </div>
  </div>
  ${sections || '<div class="muted">لا يوجد زبائن لديهم حركات</div>'}
</body>
</html>`;
}
