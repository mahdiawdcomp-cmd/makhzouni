// ── Server-side renderer for the shop's OWN invoice design ───────────────────
// The invoice designer stores a free-canvas layout (absolutely positioned
// elements, px @ 96dpi) in AppSettings.invoiceDesign. The web/desktop clients
// render it to HTML for printing; this module renders the SAME JSON to SVG so
// the backend produces the exact same invoice for every send path (WhatsApp,
// wa.me, worker notify, order-approved) WITHOUT a headless browser.
//
// Why SVG and not HTML: the layout is absolute, so there is no reflow to
// emulate — only the items table has dynamic row heights, and those are
// computed here. sharp/librsvg rasterises it with real Arabic shaping as long
// as an Arabic font is installed system-wide (see the Dockerfile: Cairo.ttf is
// copied into /usr/share/fonts and registered with fc-cache).
//
// The element model, field bindings and layout rules below MUST stay in step
// with inventory-web/src/print/invoiceDesign.ts — that file is the source of
// truth for what the designer can produce.

import sharp from "sharp";

export type PaperSize = "80mm" | "a4";

export type FieldKey =
  | "storeName" | "storePhone" | "storeAddress"
  | "title" | "invoiceNumber" | "date" | "paymentType" | "itemCount"
  | "customerName" | "customerPhone" | "invoiceNotes"
  | "subtotal" | "discount" | "tax" | "total"
  | "paid" | "remaining" | "previousBalance" | "finalBalance" | "grandTotal"
  | "footer";

export type ElType = "text" | "field" | "image" | "items" | "line" | "box";

export interface El {
  id: string;
  type: ElType;
  x: number; y: number; w: number; h: number;
  fontSize?: number;
  bold?: boolean;
  color?: string;
  align?: "right" | "center" | "left";
  text?: string;
  field?: FieldKey;
  prefix?: string;
  suffix?: string;
  src?: "logo" | "stamp";
  dataUrl?: string;
  bg?: string;
  borderColor?: string;
  radius?: number;
  accent?: string;
  showQty?: boolean;
  showPrice?: boolean;
  followItems?: boolean;
}

export interface Design {
  v: 2;
  paper: PaperSize;
  width: number;
  height: number;
  elements: El[];
}

export const PAPER_PX: Record<PaperSize, { width: number; height: number }> = {
  a4: { width: 794, height: 1123 },
  "80mm": { width: 302, height: 720 },
};

export interface PrintLine {
  name: string; unit?: string; qty: number; price: number;
  notes?: string; itemNumber?: string; pcsPerCarton?: number;
}

export interface PrintInvoice {
  number: string; date: string; customerName: string; customerPhone?: string;
  lines: PrintLine[]; notes?: string;
  subtotal?: number; discount?: number; tax?: number; total?: number;
  paid?: number; remaining?: number; previousBalance?: number; finalBalance?: number;
  paymentType?: string;
  invoiceType?: "SALE" | "PURCHASE" | "SALES_RETURN";
}

export interface PrintStore {
  storeName: string; storeLogo?: string; storePhone?: string; storeAddress?: string; currency?: string;
}

let idCounter = 0;
const newId = () => `el_${Date.now().toString(36)}_${idCounter++}`;

// ── Default layouts (mirror of the web designer's defaults) ──────────────────

export function defaultDesign(paper: PaperSize): Design {
  const p = PAPER_PX[paper];
  const accent = "#4f46e5";
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
    };
  }
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
  };
}

function upgradeDesign(design: Design): Design {
  if (design.paper !== "a4" || design.elements.some((el) => el.type === "field" && el.field === "invoiceNotes")) return design;
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
  };
}

/** Parse both per-paper designs out of the stored settings.invoiceDesign JSON. */
export function parseDesigns(json?: string | null): Record<PaperSize, Design> {
  const r: Record<PaperSize, Design> = { a4: defaultDesign("a4"), "80mm": defaultDesign("80mm") };
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (parsed?.designs?.a4) r.a4 = upgradeDesign(parsed.designs.a4);
      if (parsed?.designs?.["80mm"]) r["80mm"] = upgradeDesign(parsed.designs["80mm"]);
      else if (parsed?.v === 2 && parsed.paper) r[parsed.paper as PaperSize] = upgradeDesign(parsed as Design);
    } catch { /* keep defaults */ }
  }
  return r;
}

// ── Field bindings (mirror of the web resolveField) ──────────────────────────

const money = (n: number, cur: string) => `${Math.round(n).toLocaleString("en-US")} ${cur}`;

export function resolveField(f: FieldKey, inv: PrintInvoice, store: PrintStore): string {
  const cur = store.currency || "د.ع";
  const lineSum = inv.lines.reduce((a, l) => a + l.qty * l.price, 0);
  const subtotal = inv.subtotal ?? lineSum;
  const total = inv.total ?? subtotal;
  const prev = inv.previousBalance ?? 0;
  const paid = inv.paid ?? 0;
  const remaining = inv.remaining ?? Math.max(0, total - paid);
  const finalBalance = inv.finalBalance ?? (prev + (total - paid));
  switch (f) {
    case "storeName": return store.storeName || "اسم المحل";
    case "storePhone": return store.storePhone ? `\u{1F4DE} ${store.storePhone}` : "";
    case "storeAddress": return store.storeAddress ? `\u{1F4CD} ${store.storeAddress}` : "";
    case "title":
      return inv.invoiceType === "PURCHASE" ? "فاتورة شراء"
        : inv.invoiceType === "SALES_RETURN" ? "مرتجع مبيعات"
        : "فاتورة بيع";
    case "invoiceNumber": return inv.number;
    case "date": return inv.date;
    case "paymentType": return inv.paymentType || "—";
    case "itemCount": return `${inv.lines.length}`;
    case "customerName": return inv.customerName;
    case "customerPhone": return inv.customerPhone || "";
    case "invoiceNotes": return inv.notes || "";
    case "subtotal": return money(subtotal, cur);
    case "discount": return money(inv.discount ?? 0, cur);
    case "tax": return money(inv.tax ?? 0, cur);
    case "total": return money(total, cur);
    case "paid": return money(paid, cur);
    case "remaining": return money(remaining, cur);
    case "previousBalance": {
      // Purchase invoices store the balance negated (supplier is the creditor)
      const displayPrev = inv.invoiceType === "PURCHASE" ? -prev : prev;
      return displayPrev ? money(displayPrev, cur) : "—";
    }
    case "finalBalance": {
      const displayFinal = inv.invoiceType === "PURCHASE" ? -finalBalance : finalBalance;
      return money(displayFinal, cur);
    }
    case "grandTotal": {
      const displayGrand = inv.invoiceType === "PURCHASE" ? -finalBalance : finalBalance;
      return money(displayGrand, cur);
    }
    case "footer": return "شكراً لتعاملكم معنا";
    default: return "";
  }
}

// ── SVG primitives ───────────────────────────────────────────────────────────

const FONT_STACK = "Cairo, 'Noto Naskh Arabic', 'Noto Sans Arabic', Tahoma, DejaVu Sans, sans-serif";

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Approximate advance width per character. librsvg does the real shaping, but
// wrapping has to be decided before the SVG is handed over, so the table's
// column widths are honoured using an estimate calibrated for Cairo: Arabic
// letters join and sit narrower than Latin ones, digits are the widest.
export function textWidth(text: string, fontSize: number, bold = false): number {
  let units = 0;
  for (const ch of String(text ?? "")) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === " ") units += 0.26;
    else if (code >= 0x0600 && code <= 0x06ff) units += 0.46;      // Arabic
    else if (code >= 0x0030 && code <= 0x0039) units += 0.56;      // digits
    else if (code >= 0x0041 && code <= 0x005a) units += 0.66;      // A-Z
    else if (code >= 0x0061 && code <= 0x007a) units += 0.52;      // a-z
    else if (code > 0x2000) units += 1.0;                          // emoji / symbols
    else units += 0.42;
  }
  return units * fontSize * (bold ? 1.05 : 1);
}

/** Greedy word wrap that falls back to breaking inside an over-long word. */
export function wrapText(text: string, maxWidth: number, fontSize: number, bold = false, maxLines = 99): string[] {
  const source = String(text ?? "").trim();
  if (!source) return [];
  const lines: string[] = [];
  let current = "";
  const flush = () => { if (current) { lines.push(current); current = ""; } };

  for (const word of source.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, fontSize, bold) <= maxWidth || !current) {
      if (textWidth(candidate, fontSize, bold) <= maxWidth) { current = candidate; continue; }
      // Single word wider than the column — break it by characters.
      let chunk = "";
      for (const ch of word) {
        if (textWidth(chunk + ch, fontSize, bold) > maxWidth && chunk) { lines.push(chunk); chunk = ch; }
        else chunk += ch;
      }
      current = chunk;
      continue;
    }
    flush();
    current = word;
  }
  flush();

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, Math.max(1, kept[maxLines - 1].length - 1))}…`;
    return kept;
  }
  return lines;
}

interface TextOpts {
  x: number;             // anchor position in SVG coordinates
  y: number;             // baseline
  size: number;
  color?: string;
  bold?: boolean;
  align?: "right" | "center" | "left";
}

// With direction:rtl the inline progression runs right-to-left, so text-anchor
// "start" pins the RIGHT edge and "end" the LEFT one. Mapping it here keeps
// every call site thinking in plain right/center/left terms.
const ANCHOR: Record<"right" | "center" | "left", string> = {
  right: "start",
  center: "middle",
  left: "end",
};

function svgText(content: string, o: TextOpts): string {
  if (!content) return "";
  return `<text x="${o.x.toFixed(1)}" y="${o.y.toFixed(1)}" font-family="${FONT_STACK}" font-size="${o.size}" `
    + `font-weight="${o.bold ? 800 : 500}" fill="${o.color || "#0f172a"}" text-anchor="${ANCHOR[o.align || "right"]}" `
    + `style="direction:rtl">${esc(content)}</text>`;
}

function svgRect(x: number, y: number, w: number, h: number, fill: string, radius = 0, stroke?: string): string {
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" `
    + `${radius ? `rx="${radius}" ` : ""}fill="${fill}"${stroke ? ` stroke="${stroke}"` : ""}/>`;
}

// ── Items table ──────────────────────────────────────────────────────────────

interface Col { key: string; label: string; share: number; right?: boolean }

const numFmt = (n: number) => Math.round(n).toLocaleString("en-US");

// Pieces on a line, whatever unit it was entered in — the carton column and the
// carton total both have to agree with what the invoice actually says. Both
// spellings of the carton label are accepted because the print payload and the
// invoice screen have historically disagreed ("كرتون" vs "كرتونة").
function linePieces(l: PrintLine): number {
  const per = Math.max(1, l.pcsPerCarton || 1);
  if (l.unit === "كرتون" || l.unit === "كرتونة") return l.qty * per;
  if (l.unit === "درزن") return l.qty * 12;
  if (l.unit === "علبة") return l.qty * Math.ceil(per / 2);
  return l.qty;
}

function lineCartons(l: PrintLine): { cartons: number; loose: number; text: string } {
  const per = Math.max(1, l.pcsPerCarton || 1);
  if (per <= 1) return { cartons: 0, loose: linePieces(l), text: "—" };
  const pieces = linePieces(l);
  const cartons = Math.floor(pieces / per);
  const loose = pieces % per;
  return { cartons, loose, text: cartons && loose ? `${cartons} + ${loose}` : cartons ? `${cartons}` : `0 + ${loose}` };
}

function itemNameFontSize(name: string, base: number): number {
  const len = Array.from(String(name ?? "")).length;
  if (len > 70) return Math.max(base - 2, 9);
  if (len > 42) return Math.max(base - 1, 9);
  return base;
}

// HTML tables reflow to fit their column; SVG text does not, so a value that is
// wider than its column has to be shrunk here or it will run across its
// neighbours. This is what keeps a narrow 80mm receipt legible.
function fitSize(text: string, maxWidth: number, size: number, bold = false, min = 8): number {
  let s = size;
  while (s > min && textWidth(text, s, bold) > maxWidth) s -= 0.5;
  return s;
}

interface TableResult { svg: string; height: number }

function renderItemsTable(el: El, x: number, y: number, width: number, inv: PrintInvoice, store: PrintStore): TableResult {
  const cur = store.currency || "د.ع";
  const accent = el.accent || "#4f46e5";
  const fs = el.fontSize || 12;
  const fsSm = Math.max(fs - 2, 9);
  const hasItemNum = inv.lines.some((l) => l.itemNumber);
  // Cartons belong on a PURCHASE only: receiving a container is counted in
  // cartons, a sale is counted in pieces.
  const hasCartons = inv.invoiceType === "PURCHASE" && inv.lines.some((l) => (l.pcsPerCarton ?? 0) > 1);

  const colDefs: Col[] = [{ key: "idx", label: "#", share: 5 }];
  if (hasItemNum) colDefs.push({ key: "itemNumber", label: "رقم الايتم", share: 12 });
  colDefs.push({ key: "name", label: "الصنف", share: hasItemNum ? 38 : 44, right: true });
  colDefs.push({ key: "unit", label: "الوحدة", share: 8 });
  if (el.showQty) colDefs.push({ key: "qty", label: "الكمية", share: 7 });
  if (hasCartons) colDefs.push({ key: "cartons", label: "الكراتين", share: 8 });
  if (el.showPrice) colDefs.push({ key: "price", label: "السعر", share: 9 });
  colDefs.push({ key: "total", label: "المجموع", share: 10.5 });
  colDefs.push({ key: "notes", label: "الملاحظات", share: 11, right: true });

  const shareSum = colDefs.reduce((s, c) => s + c.share, 0);
  // Columns run right-to-left: the first column sits at the right edge.
  const right = x + width;
  let cursor = right;
  const geom = colDefs.map((c) => {
    const w = (c.share / shareSum) * width;
    const box = { ...c, left: cursor - w, right: cursor, width: w };
    cursor -= w;
    return box;
  });

  const pad = 4;
  const lineH = fs * 1.32;
  const parts: string[] = [];

  // Header — labels wrap and shrink so a narrow column cannot overrun its neighbour
  const headCells = geom.map((g) => {
    const size = fitSize(g.label, g.width - pad * 2, fs, true, 8);
    return { g, size, lines: wrapText(g.label, g.width - pad * 2, size, true, 2) };
  });
  const headH = Math.max(
    fs * 1.25 + 12,
    24,
    ...headCells.map((c) => c.lines.length * c.size * 1.3 + 10),
  );
  parts.push(svgRect(x, y, width, headH, `${accent}14`));
  parts.push(`<rect x="${x.toFixed(1)}" y="${(y + headH - 2).toFixed(1)}" width="${width.toFixed(1)}" height="2" fill="${accent}"/>`);
  for (const { g, size, lines } of headCells) {
    const isName = g.key === "name";
    const blockH = lines.length * size * 1.3;
    lines.forEach((label, i) => {
      parts.push(svgText(label, {
        x: isName ? g.right - pad : g.left + g.width / 2,
        y: y + (headH - blockH) / 2 + size * 1.02 + i * size * 1.3,
        size, color: accent, bold: true, align: isName ? "right" : "center",
      }));
    });
  }

  // Body
  let rowY = y + headH;
  let totalCartons = 0;
  let totalLoose = 0;

  inv.lines.forEach((l, idx) => {
    const nameCol = geom.find((g) => g.key === "name")!;
    const notesCol = geom.find((g) => g.key === "notes")!;
    const nameFs = itemNameFontSize(l.name, fs);
    const pcsSuffix = l.pcsPerCarton && l.pcsPerCarton > 1 ? ` (${l.pcsPerCarton} ق/ك)` : "";
    const nameLines = wrapText(`${l.name}${pcsSuffix}`, nameCol.width - pad * 2, nameFs, false, 4);
    const noteLines = wrapText(l.notes || "", notesCol.width - pad * 2, fsSm, false, 3);
    const rowH = Math.max(
      fs * 1.25 + 10,
      nameLines.length * (nameFs * 1.32) + 10,
      noteLines.length * (fsSm * 1.32) + 10,
    );

    if (idx % 2 === 1) parts.push(svgRect(x, rowY, width, rowH, "#f8fafc"));
    parts.push(`<rect x="${x.toFixed(1)}" y="${(rowY + rowH - 1).toFixed(1)}" width="${width.toFixed(1)}" height="1" fill="#cbd5e1"/>`);

    const centered = (key: string, value: string, color = "#0f172a", bold = false) => {
      const g = geom.find((c) => c.key === key);
      if (!g) return;
      const size = fitSize(value, g.width - pad, fs, bold, 8);
      parts.push(svgText(value, {
        x: g.left + g.width / 2,
        y: rowY + rowH / 2 + size * 0.36,
        size, color, bold, align: "center",
      }));
    };

    centered("idx", `${idx + 1}`, "#475569");
    if (hasItemNum) centered("itemNumber", l.itemNumber || "—", "#6366f1", true);

    // Name — wrapped, top-aligned like the printed table
    nameLines.forEach((text, i) => {
      parts.push(svgText(text, {
        x: nameCol.right - pad,
        y: rowY + 5 + nameFs * 1.05 + i * (nameFs * 1.32),
        size: nameFs, color: "#0f172a", align: "right",
      }));
    });

    centered("unit", l.unit || "—", "#475569");
    if (el.showQty) centered("qty", `${l.qty}`, "#0f172a", true);
    if (hasCartons) {
      const c = lineCartons(l);
      totalCartons += c.cartons;
      totalLoose += c.loose;
      centered("cartons", c.text, "#0f172a", true);
    }
    if (el.showPrice) centered("price", numFmt(l.price), "#334155");
    centered("total", numFmt(l.qty * l.price), "#0f172a", true);

    noteLines.forEach((text, i) => {
      parts.push(svgText(text, {
        x: notesCol.right - pad,
        y: rowY + 5 + fsSm * 1.05 + i * (fsSm * 1.32),
        size: fsSm, color: "#475569", align: "right",
      }));
    });

    rowY += rowH;
  });

  // Footer rows
  if (hasCartons) {
    const h = fs * 1.4 + 8;
    parts.push(`<rect x="${x.toFixed(1)}" y="${rowY.toFixed(1)}" width="${width.toFixed(1)}" height="2" fill="${accent}"/>`);
    parts.push(svgText(
      `مجموع الكراتين: ${totalCartons}${totalLoose ? ` كرتون + ${totalLoose} قطعة` : " كرتون"}`,
      { x: x + width / 2, y: rowY + h / 2 + fs * 0.36, size: fs, color: accent, bold: true, align: "center" },
    ));
    rowY += h;
  }
  const curH = fsSm * 1.6;
  parts.push(svgText(`الأسعار والمجاميع بـ ${cur}`, {
    x: x + width / 2, y: rowY + curH * 0.72, size: fsSm, color: "#94a3b8", align: "center",
  }));
  rowY += curH;

  return { svg: parts.join("\n"), height: rowY - y };
}

// ── Element rendering ────────────────────────────────────────────────────────

interface Box { x: number; y: number; w: number; h: number; fontSize: number }

function renderPlainElement(el: El, box: Box, inv: PrintInvoice, store: PrintStore, canvasWidth: number): string {
  // The designer positions elements by their distance from the RIGHT edge.
  const left = canvasWidth - box.x - box.w;
  const right = canvasWidth - box.x;
  const parts: string[] = [];

  if (el.type === "line") {
    const h = Math.max(2, box.h);
    return svgRect(left, box.y, box.w, h, el.color || "#4f46e5", el.radius ?? 0);
  }

  if (el.bg || el.borderColor) {
    parts.push(svgRect(left, box.y, box.w, box.h, el.bg || "none", el.radius ?? 0, el.borderColor));
  }

  if (el.type === "box") return parts.join("\n");

  if (el.type === "image") {
    const src = el.dataUrl || (el.src === "logo" ? store.storeLogo : undefined);
    if (src && /^data:image\//i.test(src)) {
      parts.push(`<image href="${esc(src)}" x="${left.toFixed(1)}" y="${box.y.toFixed(1)}" `
        + `width="${box.w.toFixed(1)}" height="${box.h.toFixed(1)}" preserveAspectRatio="xMidYMid meet"/>`);
    }
    return parts.join("\n");
  }

  const raw = el.type === "text"
    ? (el.text || "")
    : (() => {
        const value = resolveField(el.field || "storeName", inv, store);
        return value ? `${el.prefix || ""}${value}${el.suffix || ""}` : "";
      })();
  if (!raw) return parts.join("\n");

  const fs = box.fontSize;
  const align = el.align || "right";
  const anchorX = align === "right" ? right : align === "left" ? left : left + box.w / 2;
  const padded = el.bg && align === "center" ? 6 : 0;
  const maxLines = Math.max(1, Math.floor(box.h / (fs * 1.25)));
  const lines = wrapText(raw, box.w - padded * 2, fs, el.bold, maxLines);
  const blockH = lines.length * fs * 1.25;
  const firstBaseline = box.y + (box.h - blockH) / 2 + fs * 1.0;

  lines.forEach((text, i) => {
    parts.push(svgText(text, {
      x: anchorX,
      y: firstBaseline + i * fs * 1.25,
      size: fs, color: el.color, bold: el.bold, align,
    }));
  });
  return parts.join("\n");
}

// ── Whole-document layout ────────────────────────────────────────────────────

export interface RenderedDesign { svg: string; width: number; height: number }

export function renderDesignSvg(design: Design, inv: PrintInvoice, store: PrintStore): RenderedDesign {
  const width = design.width;
  const is80 = design.paper === "80mm";
  const itemsEl = design.elements.find((el) => el.type === "items");
  const useFlow = !!itemsEl && (design.paper === "a4" || design.elements.some((el) => el.followItems));
  const body: string[] = [];
  let contentBottom = design.height;

  if (useFlow && itemsEl) {
    const itemsBottom = itemsEl.y + itemsEl.h;
    const flowsAfterItems = (el: El) => el.type !== "items" && (el.followItems || (!is80 && el.y >= itemsBottom - 4));
    const headerEls = design.elements.filter((el) => !flowsAfterItems(el) && el.type !== "items");
    const footerEls = design.elements.filter(flowsAfterItems).slice().sort((a, b) => a.y - b.y);

    for (const el of headerEls) {
      body.push(renderPlainElement(el, { x: el.x, y: el.y, w: el.w, h: el.h, fontSize: el.fontSize || 13 }, inv, store, width));
    }

    const tableX = is80 ? itemsEl.x : Math.max(24, Math.min(itemsEl.x, 28));
    const tableW = is80 ? itemsEl.w : Math.min(width - 48, Math.max(itemsEl.w, width - 48));
    const table = renderItemsTable(itemsEl, width - tableX - tableW, itemsEl.y, tableW, inv, store);
    body.push(table.svg);

    let cursorY = itemsEl.y + table.height;
    let prevBottom = itemsEl.y + itemsEl.h;
    for (const el of footerEls) {
      const gap = is80 ? Math.max(4, el.y - prevBottom) : 3;
      prevBottom = el.y + el.h;
      const h = is80 ? el.h : el.field === "grandTotal" ? 30 : 24;
      const w = is80 ? el.w : Math.min(el.w, el.field === "grandTotal" ? 300 : 282);
      const fontSize = is80
        ? el.fontSize || 13
        : Math.min(el.fontSize || 13, el.field === "grandTotal" ? 16 : 13);
      cursorY += gap;
      body.push(renderPlainElement(el, { x: el.x, y: cursorY, w, h, fontSize }, inv, store, width));
      cursorY += h;
    }
    contentBottom = Math.max(design.height, cursorY + (is80 ? 8 : 24));
  } else {
    for (const el of design.elements) {
      if (el.type === "items") {
        const table = renderItemsTable(el, width - el.x - el.w, el.y, el.w, inv, store);
        body.push(table.svg);
        contentBottom = Math.max(contentBottom, el.y + table.height + 12);
        continue;
      }
      body.push(renderPlainElement(el, { x: el.x, y: el.y, w: el.w, h: el.h, fontSize: el.fontSize || 13 }, inv, store, width));
    }
  }

  const height = Math.ceil(Math.max(design.height, contentBottom));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="${width}" height="${height}" fill="#ffffff"/>`
    + body.join("\n")
    + `</svg>`;
  return { svg, width, height };
}

/**
 * Rasterise the shop's own design. `scale` renders at a multiple of the paper
 * size so the sent image stays sharp on a phone; the logical page size is
 * returned separately so a PDF can be laid out at the real paper dimensions.
 */
export async function renderDesignPng(
  design: Design,
  inv: PrintInvoice,
  store: PrintStore,
  scale = 2,
): Promise<{ png: Buffer; pageWidth: number; pageHeight: number }> {
  const { svg, width, height } = renderDesignSvg(design, inv, store);
  const png = await sharp(Buffer.from(svg), { density: 72 * scale })
    .resize({ width: Math.round(width * scale), height: Math.round(height * scale), fit: "fill" })
    .png()
    .toBuffer();
  return { png, pageWidth: width, pageHeight: height };
}
