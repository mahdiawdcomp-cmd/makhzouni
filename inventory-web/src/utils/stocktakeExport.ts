import type { StocktakeSessionDetail } from "../types/api"
import { fmt, fmtD } from "./fmt"

// Export / print for a stocktake session's results. Self-contained (no xlsx
// dependency) so the same file works in the web build and the Tauri desktop
// build: CSV with a UTF-8 BOM opens in Excel with Arabic intact, and printing
// goes through a hidden iframe because window.open is unreliable in WebView2.

type Item = StocktakeSessionDetail["items"][number]

// Excel only reads a CSV as UTF-8 (Arabic intact) when it starts with a BOM.
const BOM = String.fromCharCode(0xfeff)

const APPROVAL: Record<Item["approvalStatus"], string> = {
  PENDING: "بانتظار المراجعة",
  APPROVED: "موافق",
  REJECTED: "مرفوض",
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

function sessionTitle(session: StocktakeSessionDetail) {
  return `جرد ${session.createdAt.slice(0, 10)}${session.notes ? ` — ${session.notes}` : ""}`
}

function fileBase(session: StocktakeSessionDetail) {
  return `stocktake-${session.createdAt.slice(0, 10)}-${session.id.slice(0, 8)}`
}

function approvalLabel(item: Item) {
  return item.actualQty === null ? "لم يُحسب" : APPROVAL[item.approvalStatus]
}

/** Resolves to where the file went (a filename on the web). */
export async function exportStocktakeCsv(session: StocktakeSessionDetail): Promise<string> {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = ["المادة", "الفئة", "بالنظام", "فعلي", "الفرق", "كلفة الوحدة", "قيمة الفرق", "الحالة"]
  const rows = session.items.map((i) => [
    i.productName,
    i.category ?? "",
    i.systemQty,
    i.actualQty,
    i.variance,
    i.unitCost ?? "",
    i.varianceValue ?? "",
    approvalLabel(i),
  ])
  const csv = [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")
  const filename = `${fileBase(session)}.csv`
  const url = URL.createObjectURL(new Blob([BOM + csv], { type: "text/csv;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return filename
}

export function printStocktake(session: StocktakeSessionDetail) {
  const stats = session.stats
  const rows = session.items.map((i, idx) => {
    const v = i.variance
    const cls = v === null ? "" : v < 0 ? "neg" : v > 0 ? "pos" : "ok"
    return `<tr class="${cls}">
      <td class="c">${idx + 1}</td>
      <td>${esc(i.productName)}</td>
      <td>${esc(i.category ?? "—")}</td>
      <td class="c">${i.systemQty ?? "—"}</td>
      <td class="c">${i.actualQty ?? "—"}</td>
      <td class="c b">${v === null ? "—" : v > 0 ? `+${v}` : v}</td>
      <td class="c">${i.varianceValue === null || i.varianceValue === undefined ? "—" : fmtD(i.varianceValue)}</td>
      <td class="c">${approvalLabel(i)}</td>
    </tr>`
  }).join("")

  const summary = stats
    ? `<div class="sum">
        <span>المواد: ${fmt(stats.filled)}/${fmt(stats.total)}</span>
        <span>الفروقات: ${fmt(stats.errors ?? 0)}</span>
        <span>قيمة النقص: ${fmtD(stats.shortageValue ?? 0)}</span>
        <span>قيمة الزيادة: ${fmtD(stats.overageValue ?? 0)}</span>
        <span>الصافي: ${fmtD(stats.netVarianceValue ?? 0)}</span>
      </div>`
    : ""

  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(sessionTitle(session))}</title>
<style>
  @page { margin: 10mm }
  body { font-family: "Cairo", Tahoma, Arial, sans-serif; margin: 0; color: #000; font-size: 12px }
  h1 { font-size: 18px; margin: 0 0 4px }
  .meta { margin-bottom: 6px; color: #333 }
  .sum { display: flex; flex-wrap: wrap; gap: 14px; margin: 6px 0 10px; font-weight: 700 }
  table { width: 100%; border-collapse: collapse }
  th, td { border: 1px solid #999; padding: 3px 5px; text-align: right }
  th { background: #eee }
  .c { text-align: center } .b { font-weight: 700 }
  tr.neg td { background: #fde8e8 } tr.pos td { background: #e8f0fd }
  tr { page-break-inside: avoid }
</style></head><body>
  <h1>${esc(sessionTitle(session))}</h1>
  <div class="meta">${session.branch ? `المخزن: ${esc(session.branch.name)} · ` : ""}${esc(session.creator.name)}</div>
  ${summary}
  <table>
    <thead><tr><th>#</th><th>المادة</th><th>الفئة</th><th>بالنظام</th><th>فعلي</th><th>الفرق</th><th>قيمة الفرق</th><th>الحالة</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`

  const frame = document.createElement("iframe")
  frame.setAttribute("aria-hidden", "true")
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden"
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  const win = frame.contentWindow
  if (!doc || !win) {
    frame.remove()
    return false
  }
  doc.open()
  doc.write(html)
  doc.close()
  setTimeout(() => {
    win.focus()
    win.print()
    setTimeout(() => frame.remove(), 1000)
  }, 250)
  return true
}
