import type { PrepSnapshot } from "./prepScreen"

// «ورقة تجهيز» — the paper fallback for the prep screen (internet down, phone
// dead): pictures, big Western-digit quantities, English unit tags, no prices.
// Built from the cashier's own snapshot, so it needs no server at all.

const UNIT: Record<string, string> = { PIECE: "PCS", DOZEN: "DOZEN", BOX: "BOX", CARTON: "CARTON" }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

export function printPrepSlip(snapshot: PrepSnapshot, opts: { note?: string | null; urgent?: boolean } = {}) {
  const w = window.open("", "prep-slip", "width=800,height=900")
  if (!w) return false
  const rows = snapshot.lines.map((l, i) => `
    <tr>
      <td class="n">${i + 1}</td>
      <td class="img">${l.imageUrl ? `<img src="${esc(l.imageUrl)}" alt="">` : ""}</td>
      <td class="name" dir="rtl">${esc(l.name)}${l.notes ? `<div class="ln">⚠ ${esc(l.notes)}</div>` : ""}</td>
      <td class="unit">${UNIT[l.unit] ?? l.unit}</td>
      <td class="qty">${l.quantity}</td>
      <td class="chk"></td>
    </tr>`).join("")
  const time = new Date().toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })
  w.document.open()
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Prep slip</title>
<style>
  @page { margin: 10mm }
  body { font-family: "Cairo", Arial, sans-serif; margin: 0; color: #000 }
  h1 { font-size: 26px; margin: 0 0 4px }
  .meta { font-size: 14px; margin-bottom: 8px }
  .urgent { display: inline-block; border: 3px solid #000; padding: 2px 10px; font-weight: 900; font-size: 22px; margin-bottom: 6px }
  .note { border: 2px dashed #000; padding: 6px 10px; font-size: 18px; font-weight: 700; margin-bottom: 8px }
  table { width: 100%; border-collapse: collapse }
  td { border: 1px solid #000; padding: 4px; vertical-align: middle }
  .n { width: 28px; text-align: center; font-weight: 700 }
  .img { width: 90px; text-align: center } .img img { max-width: 86px; max-height: 86px; object-fit: contain }
  .name { font-size: 14px } .ln { font-size: 12px; font-weight: 700 }
  .unit { width: 70px; text-align: center; font-weight: 900; font-size: 15px }
  .qty { width: 80px; text-align: center; font-weight: 900; font-size: 34px }
  .chk { width: 44px }
  tr { page-break-inside: avoid }
</style></head><body>
  ${opts.urgent ? '<div class="urgent">🔥 URGENT</div>' : ""}
  <h1>PREP ORDER — ${snapshot.lines.length} ITEMS</h1>
  <div class="meta" dir="rtl">${snapshot.customerName ? esc(snapshot.customerName) + " · " : ""}${time}</div>
  ${opts.note ? `<div class="note" dir="rtl">📝 ${esc(opts.note)}</div>` : ""}
  <table>${rows}</table>
  <script>
    // Print once every picture has loaded (or failed) — otherwise blank boxes.
    const imgs = [...document.images];
    Promise.all(imgs.map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r })))
      .then(() => { window.focus(); window.print(); });
  </script>
</body></html>`)
  w.document.close()
  return true
}
