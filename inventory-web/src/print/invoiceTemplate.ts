// ── Invoice template model + HTML renderer ──────────────────────────────────
// The template is stored as JSON in AppSettings.invoiceTemplate so every device
// (web + desktop) shares the same design. renderInvoiceHTML() produces a full,
// self-contained HTML document (with @page sizing) used for BOTH the live
// designer preview (iframe srcDoc) and the actual print (hidden iframe).

export type PaperSize = "58mm" | "80mm" | "a4"

export interface InvoiceTemplate {
  paper: PaperSize
  accent: string
  fontScale: number          // 0.8 .. 1.3
  title: string              // e.g. "فاتورة بيع"
  showLogo: boolean
  showCustomer: boolean
  showQtyCol: boolean
  showPriceCol: boolean
  showNotes: boolean
  footer: string
  showStamp: boolean
  stampText: string
}

export const DEFAULT_TEMPLATE: InvoiceTemplate = {
  paper: "58mm",
  accent: "#4f46e5",
  fontScale: 1,
  title: "فاتورة بيع",
  showLogo: true,
  showCustomer: true,
  showQtyCol: true,
  showPriceCol: true,
  showNotes: true,
  footer: "شكراً لتعاملكم معنا 🌟",
  showStamp: false,
  stampText: "ختم المحل",
}

export function parseTemplate(json?: string | null): InvoiceTemplate {
  if (!json) return { ...DEFAULT_TEMPLATE }
  try {
    const parsed = JSON.parse(json) as Partial<InvoiceTemplate>
    return { ...DEFAULT_TEMPLATE, ...parsed }
  } catch {
    return { ...DEFAULT_TEMPLATE }
  }
}

// ── Data shapes used for rendering (real invoice or sample) ──────────────────

export interface PrintLine {
  name: string
  qty: number
  price: number
}

export interface PrintInvoice {
  number: string
  date: string
  customerName: string
  customerPhone?: string
  lines: PrintLine[]
  notes?: string
  previousBalance?: number
  paidAmount?: number
  remainingAmount?: number
}

export interface PrintStore {
  storeName: string
  storeLogo?: string
  storePhone?: string
  storeAddress?: string
  currency?: string
}

export const SAMPLE_INVOICE: PrintInvoice = {
  number: "INV-1042",
  date: "2026-06-21",
  customerName: "محل الرافدين للتجارة",
  customerPhone: "0770 123 4567",
  lines: [
    { name: "شاحن سريع نوع C", qty: 3, price: 7500 },
    { name: "كيبل بيانات مضفّر 1م", qty: 5, price: 3000 },
    { name: "سماعة بلوتوث رياضية", qty: 2, price: 18000 },
    { name: "حافظة موبايل شفافة", qty: 10, price: 2000 },
  ],
  notes: "البضاعة المباعة لا تُرد بعد 3 أيام.",
  previousBalance: 25000,
}

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string),
  )

const money = (n: number, cur: string) =>
  `${Math.round(n).toLocaleString("en-US")} ${cur}`

export function renderInvoiceHTML(
  t: InvoiceTemplate,
  inv: PrintInvoice,
  store: PrintStore,
): string {
  const cur = store.currency || "د.ع"
  const subtotal = inv.lines.reduce((a, l) => a + l.qty * l.price, 0)
  const prev = inv.previousBalance ?? 0
  const grand = subtotal + prev
  const isThermal = t.paper === "80mm" || t.paper === "58mm"
  const thermalWidth = t.paper === "58mm" ? "58mm" : "80mm"
  const is80 = isThermal  // keep variable name for all thermal-width branches
  const base = (isThermal ? 11 : 13) * t.fontScale

  const pageCss = isThermal
    ? `@page { size: ${thermalWidth} auto; margin: 0; } body { width: ${thermalWidth}; }`
    : `@page { size: A4; margin: 12mm; }`

  const logo =
    t.showLogo && store.storeLogo
      ? `<img src="${esc(store.storeLogo)}" alt="logo" style="max-height:${is80 ? 54 : 80}px;max-width:${is80 ? 160 : 240}px;object-fit:contain;margin:0 auto 6px;display:block" />`
      : ""

  const cols = ["#", "الصنف"]
  if (t.showQtyCol) cols.push("الكمية")
  if (t.showPriceCol) cols.push("السعر")
  cols.push("المجموع")

  const rows = inv.lines
    .map((l, i) => {
      const cells = [`${i + 1}`, esc(l.name)]
      if (t.showQtyCol) cells.push(`${l.qty}`)
      if (t.showPriceCol) cells.push(money(l.price, cur))
      cells.push(money(l.qty * l.price, cur))
      return `<tr>${cells
        .map(
          (c, ci) =>
            `<td style="padding:${is80 ? "3px 2px" : "7px 8px"};border-bottom:1px solid #e5e7eb;${ci === 1 ? "text-align:right" : "text-align:center"};white-space:${ci === 1 ? "normal" : "nowrap"}">${c}</td>`,
        )
        .join("")}</tr>`
    })
    .join("")

  const customer = t.showCustomer
    ? `<div style="margin:6px 0;font-size:${base}px;line-height:1.7">
         <div><b>الزبون:</b> ${esc(inv.customerName)}</div>
         ${inv.customerPhone ? `<div><b>الهاتف:</b> ${esc(inv.customerPhone)}</div>` : ""}
       </div>`
    : ""

  const paid = inv.paidAmount ?? 0
  const remaining = inv.remainingAmount ?? 0
  const totals = `
    <div style="margin-top:8px;font-size:${base}px">
      <div style="display:flex;justify-content:space-between;padding:2px 0">
        <span>إجمالي الفاتورة</span><b>${money(subtotal, cur)}</b>
      </div>
      ${
        prev
          ? `<div style="display:flex;justify-content:space-between;padding:2px 0;color:#b45309">
               <span>رصيد سابق</span><span>${money(prev, cur)}</span>
             </div>`
          : ""
      }
      <div style="display:flex;justify-content:space-between;padding:6px 4px;margin-top:4px;background:${t.accent};color:#fff;border-radius:6px;font-size:${base + 2}px">
        <span>المطلوب الكلّي</span><b>${money(grand, cur)}</b>
      </div>
      ${paid > 0 ? `<div style="display:flex;justify-content:space-between;padding:3px 4px;margin-top:3px;background:#dcfce7;color:#166534;border-radius:6px">
        <span>المدفوع</span><b>${money(paid, cur)}</b>
      </div>` : ""}
      ${remaining > 0 ? `<div style="display:flex;justify-content:space-between;padding:3px 4px;margin-top:3px;background:#fee2e2;color:#991b1b;border-radius:6px">
        <span>المتبقي</span><b>${money(remaining, cur)}</b>
      </div>` : ""}
    </div>`

  const stamp =
    t.showStamp
      ? `<div style="margin-top:18px;display:flex;justify-content:${is80 ? "center" : "flex-start"}">
           <div style="border:2px dashed ${t.accent};color:${t.accent};border-radius:8px;padding:12px 20px;font-size:${base}px;font-weight:700;opacity:.85">${esc(t.stampText || "ختم المحل")}</div>
         </div>`
      : ""

  const notes =
    t.showNotes && inv.notes
      ? `<div style="margin-top:8px;font-size:${base - 1}px;color:#475569">📝 ${esc(inv.notes)}</div>`
      : ""

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8" />
<style>
  ${pageCss}
  * { box-sizing: border-box; }
  body { margin:0; font-family:"Cairo","Segoe UI",Tahoma,sans-serif; color:#0f172a; font-size:${base}px; background:#fff; }
  .wrap { padding:${isThermal ? "5mm 3mm" : "0"}; max-width:${isThermal ? thermalWidth : "100%"}; margin:0 auto; }
  table { width:100%; border-collapse:collapse; margin-top:6px; font-size:${base - 1}px; }
  th { background:${t.accent}11; color:${t.accent}; padding:${is80 ? "4px 2px" : "8px"}; text-align:center; border-bottom:2px solid ${t.accent}; }
  th:nth-child(2){ text-align:right; }
  h1 { font-size:${base + 6}px; margin:0; color:${t.accent}; }
  .muted { color:#64748b; }
</style></head><body><div class="wrap">

  <div style="text-align:center;border-bottom:2px solid ${t.accent};padding-bottom:8px;margin-bottom:8px">
    ${logo}
    <div style="font-size:${base + 4}px;font-weight:800">${esc(store.storeName || "اسم المحل")}</div>
    ${store.storePhone ? `<div class="muted" style="font-size:${base - 1}px">📞 ${esc(store.storePhone)}</div>` : ""}
    ${store.storeAddress ? `<div class="muted" style="font-size:${base - 1}px">📍 ${esc(store.storeAddress)}</div>` : ""}
  </div>

  <div style="display:flex;justify-content:space-between;font-size:${base}px;margin-bottom:4px">
    <span><b>${esc(t.title)}</b></span>
    <span class="muted">${esc(inv.number)}</span>
  </div>
  <div class="muted" style="font-size:${base - 1}px;margin-bottom:6px">📅 ${esc(inv.date)}</div>

  ${customer}

  <table>
    <thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody>
  </table>

  ${totals}
  ${notes}
  ${stamp}

  <div style="margin-top:14px;text-align:center;border-top:1px dashed #cbd5e1;padding-top:8px;font-size:${base - 1}px;color:#475569">
    ${esc(t.footer)}
  </div>

</div></body></html>`
}
