// ── Free-canvas invoice designer model + renderer (v2) ───────────────────────
// Elements are absolutely positioned on a paper canvas (px @ 96dpi, so the same
// coordinates print 1:1 at the right physical size). The same renderer feeds
// the editor preview and the real print. Stored as JSON in invoiceTemplate.

export type PaperSize = "80mm" | "a4"

export type FieldKey =
  | "storeName" | "storePhone" | "storeAddress"
  | "title" | "invoiceNumber" | "date"
  | "customerName" | "customerPhone"
  | "subtotal" | "previousBalance" | "grandTotal" | "footer"

export type ElType = "text" | "field" | "image" | "items" | "line" | "box"

export interface El {
  id: string
  type: ElType
  x: number
  y: number
  w: number
  h: number
  fontSize?: number
  bold?: boolean
  color?: string
  align?: "right" | "center" | "left"
  text?: string         // for "text"
  field?: FieldKey      // for "field"
  prefix?: string
  suffix?: string
  src?: "logo" | "stamp" // for "image"
  dataUrl?: string       // uploaded image (logo/stamp) as data URL
  bg?: string
  borderColor?: string
  radius?: number
  accent?: string       // for "items" header tint
  showQty?: boolean
  showPrice?: boolean
}

export interface Design {
  v: 2
  paper: PaperSize
  width: number
  height: number
  elements: El[]
}

// A4 @ 96dpi = 794 x 1123 ; 80mm = ~302 wide
export const PAPER_PX: Record<PaperSize, { width: number; height: number }> = {
  a4: { width: 794, height: 1123 },
  "80mm": { width: 302, height: 720 },
}

export const FIELD_LABELS: Record<FieldKey, string> = {
  storeName: "اسم المحل",
  storePhone: "هاتف المحل",
  storeAddress: "عنوان المحل",
  title: "عنوان الفاتورة",
  invoiceNumber: "رقم الفاتورة",
  date: "التاريخ",
  customerName: "اسم الزبون",
  customerPhone: "هاتف الزبون",
  subtotal: "المجموع الفرعي",
  previousBalance: "الرصيد السابق",
  grandTotal: "المطلوب الكلّي",
  footer: "التذييل",
}

let _idc = 0
export const newId = () => `el_${Date.now().toString(36)}_${_idc++}`

// ── Data shapes ──────────────────────────────────────────────────────────────

export interface PrintLine { name: string; qty: number; price: number }
export interface PrintInvoice {
  number: string; date: string; customerName: string; customerPhone?: string
  lines: PrintLine[]; notes?: string; previousBalance?: number
}
export interface PrintStore {
  storeName: string; storeLogo?: string; storePhone?: string; storeAddress?: string; currency?: string
}

export const SAMPLE_INVOICE: PrintInvoice = {
  number: "INV-1042", date: "2026-06-21",
  customerName: "محل الرافدين للتجارة", customerPhone: "0770 123 4567",
  lines: [
    { name: "شاحن سريع نوع C", qty: 3, price: 7500 },
    { name: "كيبل بيانات مضفّر 1م", qty: 5, price: 3000 },
    { name: "سماعة بلوتوث رياضية", qty: 2, price: 18000 },
    { name: "حافظة موبايل شفافة", qty: 10, price: 2000 },
  ],
  notes: "البضاعة المباعة لا تُرد بعد 3 أيام.",
  previousBalance: 25000,
}

// ── Default layouts ──────────────────────────────────────────────────────────

export function defaultDesign(paper: PaperSize): Design {
  const p = PAPER_PX[paper]
  const accent = "#4f46e5"
  if (paper === "80mm") {
    return {
      v: 2, paper, width: p.width, height: p.height,
      elements: [
        { id: newId(), type: "field", field: "storeName", x: 16, y: 12, w: 270, h: 28, fontSize: 18, bold: true, align: "center", color: "#0f172a" },
        { id: newId(), type: "field", field: "storePhone", x: 16, y: 42, w: 270, h: 18, fontSize: 11, align: "center", color: "#64748b" },
        { id: newId(), type: "line", x: 16, y: 64, w: 270, h: 2, color: accent },
        { id: newId(), type: "field", field: "title", x: 16, y: 74, w: 150, h: 20, fontSize: 13, bold: true, align: "right", color: accent },
        { id: newId(), type: "field", field: "invoiceNumber", x: 166, y: 74, w: 120, h: 20, fontSize: 11, align: "left", color: "#64748b" },
        { id: newId(), type: "field", field: "customerName", x: 16, y: 98, w: 270, h: 18, fontSize: 12, bold: true, align: "right", color: "#0f172a", prefix: "الزبون: " },
        { id: newId(), type: "items", x: 16, y: 122, w: 270, h: 220, fontSize: 11, accent, showQty: true, showPrice: true },
        { id: newId(), type: "field", field: "grandTotal", x: 16, y: 352, w: 270, h: 30, fontSize: 15, bold: true, align: "center", color: "#ffffff", bg: accent, radius: 6, prefix: "المطلوب: " },
        { id: newId(), type: "field", field: "footer", x: 16, y: 392, w: 270, h: 20, fontSize: 11, align: "center", color: "#475569" },
      ],
    }
  }
  // A4
  return {
    v: 2, paper, width: p.width, height: p.height,
    elements: [
      { id: newId(), type: "image", src: "logo", x: 40, y: 36, w: 120, h: 80 },
      { id: newId(), type: "field", field: "storeName", x: 300, y: 40, w: 454, h: 34, fontSize: 26, bold: true, align: "right", color: "#0f172a" },
      { id: newId(), type: "field", field: "storePhone", x: 300, y: 78, w: 454, h: 20, fontSize: 13, align: "right", color: "#64748b" },
      { id: newId(), type: "field", field: "storeAddress", x: 300, y: 100, w: 454, h: 20, fontSize: 13, align: "right", color: "#64748b" },
      { id: newId(), type: "line", x: 40, y: 134, w: 714, h: 3, color: accent },
      { id: newId(), type: "field", field: "title", x: 520, y: 150, w: 234, h: 30, fontSize: 22, bold: true, align: "right", color: accent },
      { id: newId(), type: "field", field: "invoiceNumber", x: 520, y: 184, w: 234, h: 22, fontSize: 14, align: "right", color: "#475569", prefix: "رقم: " },
      { id: newId(), type: "field", field: "date", x: 520, y: 208, w: 234, h: 22, fontSize: 14, align: "right", color: "#475569", prefix: "التاريخ: " },
      { id: newId(), type: "field", field: "customerName", x: 40, y: 160, w: 340, h: 24, fontSize: 15, bold: true, align: "right", color: "#0f172a", prefix: "الزبون: " },
      { id: newId(), type: "field", field: "customerPhone", x: 40, y: 188, w: 340, h: 22, fontSize: 13, align: "right", color: "#475569", prefix: "الهاتف: " },
      { id: newId(), type: "items", x: 40, y: 250, w: 714, h: 460, fontSize: 13, accent, showQty: true, showPrice: true },
      { id: newId(), type: "field", field: "subtotal", x: 440, y: 730, w: 314, h: 26, fontSize: 14, align: "right", color: "#0f172a", prefix: "المجموع الفرعي: " },
      { id: newId(), type: "field", field: "previousBalance", x: 440, y: 758, w: 314, h: 26, fontSize: 14, align: "right", color: "#b45309", prefix: "رصيد سابق: " },
      { id: newId(), type: "field", field: "grandTotal", x: 440, y: 790, w: 314, h: 40, fontSize: 18, bold: true, align: "center", color: "#ffffff", bg: accent, radius: 8, prefix: "المطلوب الكلّي: " },
      { id: newId(), type: "field", field: "footer", x: 40, y: 1060, w: 714, h: 28, fontSize: 13, align: "center", color: "#475569" },
    ],
  }
}

export function parseDesign(json?: string | null, paper: PaperSize = "80mm"): Design {
  if (json) {
    try {
      const d = JSON.parse(json) as Partial<Design>
      if (d && d.v === 2 && Array.isArray(d.elements) && d.paper) {
        const p = PAPER_PX[d.paper]
        return { v: 2, paper: d.paper, width: d.width || p.width, height: d.height || p.height, elements: d.elements as El[] }
      }
    } catch { /* fall through to default */ }
  }
  return defaultDesign(paper)
}

// ── Bindings ─────────────────────────────────────────────────────────────────

const money = (n: number, cur: string) => `${Math.round(n).toLocaleString("en-US")} ${cur}`

export function resolveField(f: FieldKey, inv: PrintInvoice, store: PrintStore): string {
  const cur = store.currency || "د.ع"
  const subtotal = inv.lines.reduce((a, l) => a + l.qty * l.price, 0)
  const prev = inv.previousBalance ?? 0
  switch (f) {
    case "storeName": return store.storeName || "اسم المحل"
    case "storePhone": return store.storePhone ? `📞 ${store.storePhone}` : ""
    case "storeAddress": return store.storeAddress ? `📍 ${store.storeAddress}` : ""
    case "title": return "فاتورة بيع"
    case "invoiceNumber": return inv.number
    case "date": return inv.date
    case "customerName": return inv.customerName
    case "customerPhone": return inv.customerPhone || ""
    case "subtotal": return money(subtotal, cur)
    case "previousBalance": return prev ? money(prev, cur) : "—"
    case "grandTotal": return money(subtotal + prev, cur)
    case "footer": return "شكراً لتعاملكم معنا 🌟"
  }
}

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string))

function itemsTableHTML(el: El, inv: PrintInvoice, store: PrintStore): string {
  const cur = store.currency || "د.ع"
  const accent = el.accent || "#4f46e5"
  const fs = el.fontSize || 12
  const cols = ["#", "الصنف"]
  if (el.showQty) cols.push("الكمية")
  if (el.showPrice) cols.push("السعر")
  cols.push("المجموع")
  const head = `<tr>${cols.map((c, i) => `<th style="background:${accent}14;color:${accent};border-bottom:2px solid ${accent};padding:6px 4px;text-align:${i === 1 ? "right" : "center"};font-size:${fs}px">${c}</th>`).join("")}</tr>`
  const body = inv.lines.map((l, idx) => {
    const cells = [`${idx + 1}`, esc(l.name)]
    if (el.showQty) cells.push(`${l.qty}`)
    if (el.showPrice) cells.push(money(l.price, cur))
    cells.push(money(l.qty * l.price, cur))
    return `<tr>${cells.map((c, i) => `<td style="padding:5px 4px;border-bottom:1px solid #e5e7eb;text-align:${i === 1 ? "right" : "center"};font-size:${fs}px">${c}</td>`).join("")}</tr>`
  }).join("")
  return `<table style="width:100%;border-collapse:collapse">${head}${body}</table>`
}

function elInnerHTML(el: El, inv: PrintInvoice, store: PrintStore): string {
  switch (el.type) {
    case "text": return esc(el.text || "")
    case "field": {
      const v = resolveField(el.field || "storeName", inv, store)
      if (!v) return ""
      return `${esc(el.prefix || "")}${esc(v)}${esc(el.suffix || "")}`
    }
    case "image": {
      const src = el.dataUrl || (el.src === "logo" ? store.storeLogo : undefined)
      return src ? `<img src="${esc(src)}" style="max-width:100%;max-height:100%;object-fit:contain" />`
                 : `<div style="width:100%;height:100%;border:2px dashed #cbd5e1;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px">${el.src === "logo" ? "شعار" : "ختم"}</div>`
    }
    case "items": return itemsTableHTML(el, inv, store)
    case "line": return ""
    case "box": return ""
  }
}

function elBoxStyle(el: El): string {
  const s: string[] = [
    "position:absolute",
    `right:${el.x}px`, `top:${el.y}px`, `width:${el.w}px`, `height:${el.h}px`,
    `font-size:${el.fontSize || 13}px`,
    el.bold ? "font-weight:800" : "font-weight:500",
    `text-align:${el.align || "right"}`,
    `color:${el.color || "#0f172a"}`,
    "overflow:hidden",
    "display:flex", "align-items:center",
    `justify-content:${el.align === "center" ? "center" : el.align === "left" ? "flex-start" : "flex-end"}`,
  ]
  if (el.type === "line") { s.push(`background:${el.color || "#4f46e5"}`); s.push("height:" + Math.max(2, el.h) + "px") }
  if (el.bg) s.push(`background:${el.bg}`)
  if (el.borderColor) s.push(`border:1px solid ${el.borderColor}`)
  if (el.radius) s.push(`border-radius:${el.radius}px`)
  if (el.type === "items" || el.type === "image") { s.push("align-items:flex-start"); s.push("display:block") }
  if (el.bg && (el.align === "center")) s.push("padding:0 6px")
  return s.join(";")
}

export function renderDesignHTML(design: Design, inv: PrintInvoice, store: PrintStore): string {
  const is80 = design.paper === "80mm"
  const pageCss = is80
    ? `@page { size: 80mm auto; margin:0 } body{width:80mm}`
    : `@page { size:A4; margin:0 }`
  const bodyEls = design.elements
    .map((el) => `<div style="${elBoxStyle(el)}">${elInnerHTML(el, inv, store)}</div>`)
    .join("")
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8" /><style>
    ${pageCss}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"Cairo","Segoe UI",Tahoma,sans-serif;background:#fff}
    .paper{position:relative;width:${design.width}px;height:${is80 ? "auto" : design.height + "px"};min-height:${design.height}px;background:#fff;overflow:hidden}
  </style></head><body><div class="paper">${bodyEls}</div></body></html>`
}
