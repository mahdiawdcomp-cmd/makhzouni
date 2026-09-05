// ── Free-canvas invoice designer model + renderer (v2) ───────────────────────
// Elements are absolutely positioned on a paper canvas (px @ 96dpi, so the same
// coordinates print 1:1 at the right physical size). The same renderer feeds
// the editor preview and the real print. Stored as JSON in invoiceTemplate.

export type PaperSize = "80mm" | "a4"

export type FieldKey =
  | "storeName" | "storePhone" | "storeAddress"
  | "title" | "invoiceNumber" | "date" | "paymentType" | "itemCount"
  | "customerName" | "customerPhone" | "invoiceNotes"
  | "subtotal" | "discount" | "tax" | "total"
  | "paid" | "remaining" | "previousBalance" | "finalBalance" | "grandTotal"
  | "footer"

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
  followItems?: boolean // flow after items table in print (dynamic height)
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
  paymentType: "نوع الدفع (نقد/أجل/جزئي)",
  itemCount: "عدد الأصناف",
  customerName: "اسم الزبون",
  customerPhone: "هاتف الزبون",
  invoiceNotes: "ملاحظات الفاتورة",
  subtotal: "مجموع الأصناف",
  discount: "الخصم",
  tax: "الضريبة",
  total: "إجمالي الفاتورة",
  paid: "المبلغ المدفوع",
  remaining: "المتبقي على الفاتورة",
  previousBalance: "الرصيد السابق",
  finalBalance: "الرصيد النهائي للحساب",
  grandTotal: "المطلوب الكلّي",
  footer: "التذييل",
}

let _idc = 0
export const newId = () => `el_${Date.now().toString(36)}_${_idc++}`

// ── Data shapes ──────────────────────────────────────────────────────────────

export interface PrintLine { name: string; unit?: string; qty: number; price: number; notes?: string; itemNumber?: string; pcsPerCarton?: number }
export interface PrintInvoice {
  number: string; date: string; customerName: string; customerPhone?: string
  lines: PrintLine[]; notes?: string
  subtotal?: number; discount?: number; tax?: number; total?: number
  paid?: number; remaining?: number; previousBalance?: number; finalBalance?: number
  paymentType?: string
  invoiceType?: "SALE" | "PURCHASE" | "SALES_RETURN"
}
export interface PrintStore {
  storeName: string; storeLogo?: string; storePhone?: string; storeAddress?: string; currency?: string
}

export const SAMPLE_INVOICE: PrintInvoice = {
  number: "INV-1042", date: "2026-06-21",
  customerName: "محل الرافدين للتجارة", customerPhone: "0770 123 4567",
  lines: [
    { name: "شاحن سريع نوع C", unit: "قطعة", qty: 3, price: 7500, notes: "لون أسود" },
    { name: "كيبل بيانات مضفّر 1م", unit: "قطعة", qty: 5, price: 3000, notes: "" },
    { name: "سماعة بلوتوث رياضية", unit: "قطعة", qty: 2, price: 18000, notes: "فحص قبل التسليم" },
    { name: "حافظة موبايل شفافة", unit: "قطعة", qty: 10, price: 2000, notes: "" },
  ],
  notes: "البضاعة المباعة لا تُرد بعد 3 أيام.",
  subtotal: 93500, discount: 3500, total: 90000,
  paid: 50000, remaining: 40000, previousBalance: 25000, finalBalance: 65000,
  paymentType: "جزئي",
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
        { id: newId(), type: "field", field: "paymentType", x: 16, y: 116, w: 270, h: 16, fontSize: 11, align: "right", color: "#64748b", prefix: "نوع الدفع: " },
        { id: newId(), type: "items", x: 16, y: 138, w: 270, h: 180, fontSize: 11, accent, showQty: true, showPrice: true },
        { id: newId(), type: "field", field: "total", x: 16, y: 324, w: 270, h: 18, fontSize: 12, align: "right", color: "#0f172a", prefix: "إجمالي الفاتورة: ", followItems: true },
        { id: newId(), type: "field", field: "paid", x: 16, y: 344, w: 270, h: 18, fontSize: 12, align: "right", color: "#0d9488", prefix: "المدفوع: ", followItems: true },
        { id: newId(), type: "field", field: "previousBalance", x: 16, y: 364, w: 270, h: 18, fontSize: 12, align: "right", color: "#b45309", prefix: "رصيد سابق: ", followItems: true },
        { id: newId(), type: "field", field: "remaining", x: 16, y: 384, w: 270, h: 18, fontSize: 12, align: "right", color: "#dc2626", prefix: "المتبقي: ", followItems: true },
        { id: newId(), type: "field", field: "grandTotal", x: 16, y: 408, w: 270, h: 30, fontSize: 15, bold: true, align: "center", color: "#ffffff", bg: accent, radius: 6, prefix: "المطلوب الكلّي: ", followItems: true },
        { id: newId(), type: "field", field: "footer", x: 16, y: 448, w: 270, h: 20, fontSize: 11, align: "center", color: "#475569", followItems: true },
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
      { id: newId(), type: "field", field: "paymentType", x: 520, y: 232, w: 234, h: 22, fontSize: 14, align: "right", color: "#475569", prefix: "نوع الدفع: " },
      { id: newId(), type: "field", field: "customerName", x: 40, y: 160, w: 340, h: 24, fontSize: 15, bold: true, align: "right", color: "#0f172a", prefix: "الزبون: " },
      { id: newId(), type: "field", field: "customerPhone", x: 40, y: 188, w: 340, h: 22, fontSize: 13, align: "right", color: "#475569", prefix: "الهاتف: " },
      { id: newId(), type: "field", field: "invoiceNotes", x: 40, y: 214, w: 340, h: 42, fontSize: 13, align: "right", color: "#475569", prefix: "ملاحظات: " },
      { id: newId(), type: "items", x: 40, y: 270, w: 714, h: 420, fontSize: 13, accent, showQty: true, showPrice: true },
      { id: newId(), type: "field", field: "subtotal", x: 440, y: 706, w: 314, h: 24, fontSize: 14, align: "right", color: "#0f172a", prefix: "مجموع الأصناف: " },
      { id: newId(), type: "field", field: "discount", x: 440, y: 732, w: 314, h: 24, fontSize: 14, align: "right", color: "#475569", prefix: "الخصم: " },
      { id: newId(), type: "field", field: "total", x: 440, y: 758, w: 314, h: 24, fontSize: 14, bold: true, align: "right", color: "#0f172a", prefix: "إجمالي الفاتورة: " },
      { id: newId(), type: "field", field: "paid", x: 440, y: 784, w: 314, h: 24, fontSize: 14, align: "right", color: "#0d9488", prefix: "المدفوع: " },
      { id: newId(), type: "field", field: "previousBalance", x: 440, y: 810, w: 314, h: 24, fontSize: 14, align: "right", color: "#b45309", prefix: "رصيد سابق: " },
      { id: newId(), type: "field", field: "remaining", x: 440, y: 836, w: 314, h: 24, fontSize: 14, align: "right", color: "#dc2626", prefix: "المتبقي: " },
      { id: newId(), type: "field", field: "grandTotal", x: 440, y: 866, w: 314, h: 40, fontSize: 18, bold: true, align: "center", color: "#ffffff", bg: accent, radius: 8, prefix: "المطلوب الكلّي: " },
      { id: newId(), type: "field", field: "footer", x: 40, y: 1060, w: 714, h: 28, fontSize: 13, align: "center", color: "#475569" },
    ],
  }
}

// Parse both per-paper designs from the stored invoiceTemplate JSON.
export function parseDesigns(json?: string | null): Record<PaperSize, Design> {
  const r: Record<PaperSize, Design> = { a4: defaultDesign("a4"), "80mm": defaultDesign("80mm") }
  if (json) {
    try {
      const o = JSON.parse(json)
      if (o?.designs?.a4) r.a4 = upgradeDesign(o.designs.a4)
      if (o?.designs?.["80mm"]) r["80mm"] = upgradeDesign(o.designs["80mm"])
      else if (o?.v === 2 && o.paper) r[o.paper as PaperSize] = upgradeDesign(o as Design)
    } catch { /* defaults */ }
  }
  return r
}

export function upgradeDesign(design: Design): Design {
  if (design.paper !== "a4" || design.elements.some((el) => el.type === "field" && el.field === "invoiceNotes")) return design
  return {
    ...design,
    elements: [
      ...design.elements,
      {
        id: newId(), type: "field", field: "invoiceNotes",
        x: 40, y: 214, w: 340, h: 42, fontSize: 13,
        align: "right", color: "#475569", prefix: "ملاحظات: ",
      },
    ],
  }
}

// Print an HTML document via a throwaway hidden iframe (no popup blockers).
export function printHTML(html: string) {
  const iframe = document.createElement("iframe")
  iframe.style.cssText = "position:fixed;width:0;height:0;border:0;left:-9999px"
  document.body.appendChild(iframe)
  iframe.onload = () => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    setTimeout(() => iframe.remove(), 1500)
  }
  iframe.srcdoc = html
}

// Rasterize the EXACT custom-designed invoice HTML (same renderDesignHTML output
// used by "طباعة A4") into a real, single-page downloadable PDF — so the
// downloaded file always matches the shop's own invoice design, instead of a
// separate hardcoded template. html2canvas/jsPDF are dynamically imported so
// they never bloat the initial bundle.
export async function renderDesignToPdfBlob(html: string, width: number, height: number): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ])

  const iframe = document.createElement("iframe")
  iframe.style.cssText = `position:fixed;left:-9999px;top:0;width:${width}px;height:${height}px;border:0`
  document.body.appendChild(iframe)
  try {
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve()
      iframe.srcdoc = html
    })
    const doc = iframe.contentDocument
    if (!doc) throw new Error("PDF render frame failed to load")
    const paper = doc.querySelector(".paper") as HTMLElement | null
    if (!paper) throw new Error("Design has no .paper root")

    // Wait for images (logo/stamp) and the web font to finish loading — otherwise
    // html2canvas can capture a blank/placeholder frame.
    await Promise.all(
      Array.from(doc.images).map(
        (img) => (img.complete ? Promise.resolve() : new Promise<void>((res) => { img.onload = () => res(); img.onerror = () => res() })),
      ),
    )
    await (doc as Document & { fonts?: FontFaceSet }).fonts?.ready?.catch(() => {})

    const cssWidth = paper.scrollWidth
    const cssHeight = paper.scrollHeight
    const canvas = await html2canvas(paper, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      windowWidth: cssWidth,
      windowHeight: cssHeight,
      // html2canvas's own text engine mis-shapes/garbles Arabic (breaks letter
      // joining, drops parts of RTL runs) — foreignObjectRendering defers text
      // layout to the browser itself via an SVG <foreignObject>, which renders
      // Arabic correctly. storeLogo is always a same-origin data: URL, so this
      // never taints the canvas.
      foreignObjectRendering: true,
    })

    const pdf = new jsPDF({
      unit: "px",
      format: [cssWidth, cssHeight],
      orientation: cssWidth > cssHeight ? "landscape" : "portrait",
    })
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, cssWidth, cssHeight)
    return pdf.output("blob")
  } finally {
    iframe.remove()
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
  const lineSum = inv.lines.reduce((a, l) => a + l.qty * l.price, 0)
  const subtotal = inv.subtotal ?? lineSum
  const total = inv.total ?? subtotal
  const prev = inv.previousBalance ?? 0
  const paid = inv.paid ?? 0
  const remaining = inv.remaining ?? Math.max(0, total - paid)
  const finalBalance = inv.finalBalance ?? (prev + (total - paid))
  switch (f) {
    case "storeName": return store.storeName || "اسم المحل"
    case "storePhone": return store.storePhone ? `📞 ${store.storePhone}` : ""
    case "storeAddress": return store.storeAddress ? `📍 ${store.storeAddress}` : ""
    case "title":
      return inv.invoiceType === "PURCHASE" ? "فاتورة شراء"
        : inv.invoiceType === "SALES_RETURN" ? "مرتجع مبيعات"
        : "فاتورة بيع"
    case "invoiceNumber": return inv.number
    case "date": return inv.date
    case "paymentType": return inv.paymentType || "—"
    case "itemCount": return `${inv.lines.length}`
    case "customerName": return inv.customerName
    case "customerPhone": return inv.customerPhone || ""
    case "invoiceNotes": return inv.notes || ""
    case "subtotal": return money(subtotal, cur)
    case "discount": return money(inv.discount ?? 0, cur)
    case "tax": return money(inv.tax ?? 0, cur)
    case "total": return money(total, cur)
    case "paid": return money(paid, cur)
    case "remaining": return money(remaining, cur)
    case "previousBalance": {
      // Purchase invoices: balance is stored negative (supplier is creditor); negate for display
      const displayPrev = inv.invoiceType === "PURCHASE" ? -prev : prev
      return displayPrev ? money(displayPrev, cur) : "—"
    }
    case "finalBalance": {
      const displayFinal = inv.invoiceType === "PURCHASE" ? -finalBalance : finalBalance
      return money(displayFinal, cur)
    }
    case "grandTotal": {
      // What's owed overall after this invoice: previous balance + (this invoice's total minus what was paid on it)
      const displayGrand = inv.invoiceType === "PURCHASE" ? -finalBalance : finalBalance
      return money(displayGrand, cur)
    }
    case "footer": return "شكراً لتعاملكم معنا 🌟"
  }
}

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string))

function itemNameFontSize(name: string, base: number): number {
  const len = Array.from(String(name ?? "")).length
  if (len > 70) return Math.max(base - 2, 9)
  if (len > 42) return Math.max(base - 1, 9)
  return base
}

function itemsTableHTML(el: El, inv: PrintInvoice, store: PrintStore): string {
  const cur = store.currency || "د.ع"
  const accent = el.accent || "#4f46e5"
  const fs = el.fontSize || 12
  const fsSm = Math.max(fs - 2, 9)
  const hasItemNum = inv.lines.some((l) => l.itemNumber)
  // Cartons belong on a PURCHASE only: receiving a container is counted in
  // cartons, a sale is counted in pieces. And only when at least one line has a
  // carton size, or a shop selling loose pieces gets a column of dashes.
  const hasCartons = inv.invoiceType === "PURCHASE" && inv.lines.some((l) => (l.pcsPerCarton ?? 0) > 1)

  // Columns are declared with their share of the width instead of being matched
  // by position, so adding one (like الكراتين) can't silently shift every other
  // column's size. Shares are relative and normalised to 100% below.
  type Col = { key: string; label: string; share: number; right?: boolean }
  const colDefs: Col[] = [{ key: "idx", label: "#", share: 5 }]
  if (hasItemNum) colDefs.push({ key: "itemNumber", label: "رقم الايتم", share: 12 })
  colDefs.push({ key: "name", label: "الصنف", share: hasItemNum ? 38 : 44, right: true })
  colDefs.push({ key: "unit", label: "الوحدة", share: 8 })
  if (el.showQty) colDefs.push({ key: "qty", label: "الكمية", share: 7 })
  if (hasCartons) colDefs.push({ key: "cartons", label: "الكراتين", share: 8 })
  if (el.showPrice) colDefs.push({ key: "price", label: "السعر", share: 9 })
  colDefs.push({ key: "total", label: "المجموع", share: 10.5 })
  colDefs.push({ key: "notes", label: "الملاحظات", share: 11, right: true })

  const shareSum = colDefs.reduce((s, c) => s + c.share, 0)
  const colgroup = `<colgroup>${colDefs.map((c) => `<col style="width:${((c.share / shareSum) * 100).toFixed(2)}%" />`).join("")}</colgroup>`
  const head = `<thead><tr>${colDefs.map((c) => `<th style="background:${accent}14;color:${accent};border-bottom:2px solid ${accent};padding:6px 4px;text-align:${c.key === "name" ? "right" : "center"};font-size:${fs}px;line-height:1.25">${c.label}</th>`).join("")}</tr></thead>`

  const numFmt = (n: number) => Math.round(n).toLocaleString("en-US")
  const td = (content: string, right = false, extra = "") =>
    `<td style="padding:5px 4px;border-bottom:1px solid #cbd5e1;text-align:${right ? "right" : "center"};font-size:${fs}px;line-height:1.25;vertical-align:top;${extra}">${content}</td>`

  // Pieces on a line, whatever unit it was entered in — the carton column and
  // the carton total both have to agree with what the invoice actually says.
  const linePieces = (l: PrintLine) => {
    const per = Math.max(1, l.pcsPerCarton || 1)
    // Both spellings: the print payload says "كرتونة", older callers said "كرتون".
    if (l.unit === "كرتون" || l.unit === "كرتونة") return l.qty * per
    if (l.unit === "درزن") return l.qty * 12
    if (l.unit === "علبة") return l.qty * Math.ceil(per / 2)
    return l.qty
  }
  const lineCartons = (l: PrintLine) => {
    const per = Math.max(1, l.pcsPerCarton || 1)
    if (per <= 1) return { cartons: 0, loose: linePieces(l), text: "—" }
    const pieces = linePieces(l)
    const cartons = Math.floor(pieces / per)
    const loose = pieces % per
    return { cartons, loose, text: cartons && loose ? `${cartons} + ${loose}` : cartons ? `${cartons}` : `0 + ${loose}` }
  }

  let totalCartons = 0
  let totalLoose = 0

  const body = inv.lines.map((l, idx) => {
    const cells: string[] = [td(`${idx + 1}`, false, "vertical-align:middle")]
    if (hasItemNum) cells.push(td(`<span style="color:#6366f1;font-weight:700">${esc(l.itemNumber || "—")}</span>`, false, "vertical-align:middle"))
    const pcsHtml = l.pcsPerCarton && l.pcsPerCarton > 1
      ? ` <span style="font-size:${fsSm}px;color:#94a3b8">(${l.pcsPerCarton} ق/ك)</span>`
      : ""
    const nameFs = itemNameFontSize(l.name, fs)
    const nameHtml = `<span style="display:block;max-width:100%;white-space:normal;overflow-wrap:break-word;word-break:break-word;font-size:${nameFs}px;line-height:1.3">${esc(l.name)}${pcsHtml}</span>`
    cells.push(td(nameHtml, true))
    cells.push(td(esc(l.unit || "—"), false, "vertical-align:middle"))
    if (el.showQty) cells.push(td(`${l.qty}`, false, "vertical-align:middle"))
    if (hasCartons) {
      const c = lineCartons(l)
      totalCartons += c.cartons
      totalLoose += c.loose
      cells.push(td(`<b>${c.text}</b>`, false, "vertical-align:middle"))
    }
    if (el.showPrice) cells.push(td(numFmt(l.price), false, "vertical-align:middle"))
    cells.push(td(numFmt(l.qty * l.price), false, "vertical-align:middle"))
    cells.push(td(esc(l.notes || ""), true))
    return `<tr>${cells.join("")}</tr>`
  }).join("")
  const totalCols = colDefs.length
  const cartonRow = hasCartons
    ? `<tr><td colspan="${totalCols}" style="padding:4px;font-size:${fs}px;font-weight:700;text-align:center;border-top:2px solid ${accent};color:${accent}">مجموع الكراتين: ${totalCartons}${totalLoose ? ` كرتون + ${totalLoose} قطعة` : " كرتون"}</td></tr>`
    : ""
  const curRow = `<tfoot>${cartonRow}<tr><td colspan="${totalCols}" style="padding:2px 4px;font-size:${fsSm}px;color:#94a3b8;text-align:center">الأسعار والمجاميع بـ ${cur}</td></tr></tfoot>`
  return `<table class="invoice-items-table" style="width:100%;border-collapse:collapse;table-layout:fixed">${colgroup}${head}<tbody>${body}</tbody>${curRow}</table>`
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

  const itemsEl = design.elements.find((el) => el.type === "items")
  const useFlowLayout = !!itemsEl && (design.paper === "a4" || design.elements.some((el) => el.followItems))

  if (useFlowLayout && itemsEl) {
    const itemsBottom = itemsEl.y + itemsEl.h
    const flowsAfterItems = (el: El) => el.type !== "items" && (el.followItems || (!is80 && el.y >= itemsBottom - 4))
    const headerEls = design.elements.filter((el) => !flowsAfterItems(el) && el.type !== "items")
    const footerEls = [...design.elements.filter(flowsAfterItems)].sort((a, b) => a.y - b.y)

    const headerHTML = headerEls
      .map((el) => `<div style="${elBoxStyle(el)}">${elInnerHTML(el, inv, store)}</div>`)
      .join("")

    let prevBottom = itemsEl.y + itemsEl.h
    const footerHTML = footerEls.map((el) => {
      const rawGap = el.y - prevBottom
      const gap = is80 ? Math.max(4, rawGap) : 6
      prevBottom = el.y + el.h
      const compactHeight = is80
        ? el.h
        : el.field === "grandTotal" ? 30 : 24
      const compactWidth = is80 ? el.w : Math.min(el.w, el.field === "grandTotal" ? 300 : 282)
      const s = [
        `margin-top:${is80 ? gap : 3}px`,
        `margin-right:${el.x}px`,
        `width:${compactWidth}px`,
        `height:${compactHeight}px`,
        `font-size:${is80 ? el.fontSize || 13 : Math.min(el.fontSize || 13, el.field === "grandTotal" ? 16 : 13)}px`,
        el.bold ? "font-weight:800" : "font-weight:500",
        `color:${el.color || "#0f172a"}`,
        `text-align:${el.align || "right"}`,
        "display:flex", "align-items:center", "line-height:1.15",
        `justify-content:${el.align === "center" ? "center" : el.align === "left" ? "flex-start" : "flex-end"}`,
        "break-inside:avoid", "page-break-inside:avoid",
      ]
      if (el.bg) s.push(`background:${el.bg}`, `padding:0 ${is80 ? 4 : 6}px`)
      if (el.borderColor) s.push(`border:1px solid ${el.borderColor}`)
      if (el.radius) s.push(`border-radius:${el.radius}px`)
      return `<div class="avoid-break" style="${s.join(";")}">${elInnerHTML(el, inv, store)}</div>`
    }).join("")

    return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/><style>
      @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
      ${pageCss}
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:"Cairo","Segoe UI",Tahoma,sans-serif;background:#fff}
      .paper{position:relative;width:${design.width}px;min-height:${design.height}px;height:auto;background:#fff;overflow:visible;padding-bottom:${is80 ? 8 : 24}px}
      .invoice-items-table{page-break-inside:auto}
      .invoice-items-table thead{display:table-header-group}
      .invoice-items-table tfoot{display:table-row-group}
      .invoice-items-table tr{break-inside:avoid;page-break-inside:avoid}
    </style></head><body><div class="paper">
      ${headerHTML}
      <div class="invoice-flow" style="padding-top:${itemsEl.y}px">
        <div style="margin-right:${is80 ? itemsEl.x : Math.max(24, Math.min(itemsEl.x, 28))}px;width:${is80 ? itemsEl.w : Math.min(design.width - 48, Math.max(itemsEl.w, design.width - 48))}px;font-size:${itemsEl.fontSize || 12}px">${itemsTableHTML(itemsEl, inv, store)}</div>
        ${footerHTML}
      </div>
    </div></body></html>`
  }

  // Original absolute layout (A4 or designs without followItems)
  const bodyEls = design.elements
    .map((el) => `<div style="${elBoxStyle(el)}">${elInnerHTML(el, inv, store)}</div>`)
    .join("")
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8" /><style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
    ${pageCss}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"Cairo","Segoe UI",Tahoma,sans-serif;background:#fff}
    .paper{position:relative;width:${design.width}px;height:${is80 ? "auto" : design.height + "px"};min-height:${design.height}px;background:#fff;overflow:visible}
  </style></head><body><div class="paper">${bodyEls}</div></body></html>`
}
