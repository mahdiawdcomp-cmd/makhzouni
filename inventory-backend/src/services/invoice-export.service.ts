import sharp from "sharp";
import ExcelJS from "exceljs";
import { getInvoiceById } from "./invoice.service";
import { getSettings } from "./settings.service";
import { pngToPdf } from "../utils/png-to-pdf";
import { embedImage } from "../utils/embed-image";
import {
  parseDesigns,
  renderDesignPng,
  wrapText,
  type PaperSize,
  type PrintInvoice,
  type PrintStore,
} from "./invoice-design-render";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";

function money(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(date: unknown) {
  try {
    return new Date(String(date)).toLocaleDateString("en-US", {
      year: "numeric", month: "2-digit", day: "2-digit",
    });
  } catch { return String(date).slice(0, 10); }
}

function unitAr(unit: string) {
  if (unit === "CARTON") return "كرتونة";
  if (unit === "BOX") return "علبة";
  if (unit === "DOZEN")  return "درزن";
  return "قطعة";
}

function paymentTypeAr(type: string) {
  if (type === "CASH")    return "نقد كامل";
  if (type === "PARTIAL") return "دفع جزئي";
  if (type === "CREDIT")  return "آجل";
  return type;
}

// ── The shop's own design is the ONLY invoice that leaves the building ───────
// Every send path (WhatsApp, wa.me, worker notify, order-approved) and the PDF
// download rasterise the very layout the shop drew in the invoice designer and
// prints on paper. There is deliberately no second hardcoded template any more:
// what the customer receives is what the shop sees.

/** Unit label used by the print payload — matches the invoice screen. */
function unitPrintLabel(unit: string) {
  if (unit === "CARTON") return "كرتونة";
  if (unit === "DOZEN") return "درزن";
  if (unit === "BOX") return "علبة";
  return "قطعة";
}

function paymentPrintLabel(type: string) {
  if (type === "CASH") return "نقد";
  if (type === "PARTIAL") return "جزئي";
  return "أجل";
}

/**
 * Build the exact payload the web/desktop printers build, so the same invoice
 * reads identically whether it was printed on paper or sent to the customer.
 * Mirrors buildDesignPrintPayload() in InvoiceDetailPage.
 */
async function buildDesignPayload(invoiceId: string, paper: PaperSize = "a4") {
  const [invoice, settings] = await Promise.all([
    getInvoiceById(invoiceId),
    getSettings().catch(() => null),
  ]);

  const design = parseDesigns(settings?.invoiceDesign)[paper];

  const inv: PrintInvoice = {
    number: invoice.invoiceNumber,
    date: String(invoice.date).slice(0, 10),
    customerName: invoice.customer?.name ?? "",
    customerPhone: invoice.customer?.phone ?? "",
    lines: (invoice.items ?? []).map((item: any) => ({
      name: item.productName ?? "",
      unit: unitPrintLabel(item.unit),
      qty: Number(item.quantity),
      price: Number(item.unitPrice),
      notes: item.notes ?? "",
      itemNumber: item.itemNumber ?? item.product?.itemNumber ?? undefined,
      pcsPerCarton: item.product?.pcsPerCarton ?? undefined,
    })),
    notes: invoice.notes ?? "",
    subtotal: Number(invoice.subtotal),
    discount: Number(invoice.discount),
    tax: Number(invoice.tax),
    total: Number(invoice.totalAmount),
    paid: Number(invoice.paidAmount),
    remaining: Number(invoice.remainingAmount),
    previousBalance: Number(invoice.previousBalance ?? 0),
    finalBalance: Number(invoice.finalBalance ?? 0),
    paymentType: paymentPrintLabel(invoice.paymentType),
    invoiceType: invoice.type as "SALE" | "PURCHASE" | "SALES_RETURN",
  };

  const store: PrintStore = {
    storeName: settings?.storeName ?? "",
    // The logo may be stored as a URL; librsvg can only draw an inlined image.
    storeLogo: (await embedImage(settings?.storeLogo)) ?? "",
    storePhone: settings?.storePhone ?? "",
    storeAddress: settings?.storeAddress ?? "",
    currency: settings?.currency ?? "د.ع",
  };

  return { design, inv, store };
}

/** The invoice as a PNG image, drawn from the shop's saved design. */
export async function generateInvoicePng(invoiceId: string, paper: PaperSize = "a4"): Promise<Buffer> {
  const { design, inv, store } = await buildDesignPayload(invoiceId, paper);
  const { png } = await renderDesignPng(design, inv, store);
  return png;
}

/** The invoice as a real single-page PDF, drawn from the shop's saved design. */
export async function generateInvoicePdf(invoiceId: string, paper: PaperSize = "a4"): Promise<Buffer> {
  const { design, inv, store } = await buildDesignPayload(invoiceId, paper);
  const { png, pageWidth, pageHeight } = await renderDesignPng(design, inv, store);
  return pngToPdf(png, { width: pageWidth, height: pageHeight });
}

// ── Customer-safe image invoice ("الفاتورة أم الصور") ────────────────────────
//
// A wide, high-resolution picture of the invoice with a photo of every product,
// meant to be read on a phone. It carries the same figures as the printed
// invoice — item number, unit, carton size, line notes, discount, tax, previous
// and final balance — but it is built from an explicit narrow Prisma `select`,
// never from the full invoice/product objects, so purchasePrice / costPrice /
// profit / internal fields structurally cannot leak into it even by accident.

export interface CustomerSafeInvoiceLine {
  productName: string;
  itemNumber: string | null;
  imageDataUrl: string | null;
  unit: string;
  pcsPerCarton: number | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface CustomerSafeInvoiceDto {
  storeName: string;
  storeLogo: string | null;
  storePhone: string | null;
  storeAddress: string | null;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string | null;
  date: string;
  paymentType: string;
  currency: string;
  accent: string;
  lines: CustomerSafeInvoiceLine[];
  subtotal: number;
  discount: number;
  tax: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  previousBalance: number;
  finalBalance: number;
}

/**
 * The accent colour the shop chose in the invoice designer, so the picture
 * invoice carries the same brand colour as the printed one.
 */
function designAccent(invoiceDesign: string | null | undefined): string {
  const items = parseDesigns(invoiceDesign).a4.elements.find((el) => el.type === "items");
  const accent = items?.accent;
  return accent && /^#[0-9a-f]{3,8}$/i.test(accent) ? accent : "#1D4ED8";
}

export async function buildCustomerSafeInvoiceDto(
  invoiceId: string,
  db: Pick<typeof prisma, "invoice"> = prisma,
): Promise<CustomerSafeInvoiceDto> {
  const [invoice, settings] = await Promise.all([
    db.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        invoiceNumber: true,
        date: true,
        type: true,
        paymentType: true,
        subtotal: true,
        discount: true,
        tax: true,
        totalAmount: true,
        paidAmount: true,
        remainingAmount: true,
        previousBalance: true,
        finalBalance: true,
        customer: { select: { name: true, phone: true } },
        items: {
          select: {
            productName: true,
            itemNumber: true,
            unit: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
            product: { select: { thumbnailUrl: true, imageUrl: true, itemNumber: true, pcsPerCarton: true } },
          },
        },
      },
    }),
    getSettings().catch(() => null),
  ]);

  if (!invoice) throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
  if (invoice.type !== "SALE") {
    throw new AppError("صور الفاتورة بالمنتجات متاحة لفواتير البيع فقط", 400, "NOT_A_SALE_INVOICE");
  }

  // Pictures are fetched once here rather than dropped: a shop that stores its
  // images as URLs used to get a grid of grey placeholders.
  const [storeLogo, ...lineImages] = await Promise.all([
    embedImage(settings?.storeLogo),
    ...invoice.items.map((item) => embedImage(item.product?.thumbnailUrl ?? item.product?.imageUrl)),
  ]);

  return {
    storeName: settings?.storeName ?? "مخزوني",
    storeLogo,
    storePhone: settings?.storePhone ?? null,
    storeAddress: settings?.storeAddress ?? null,
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.customer?.name ?? "—",
    customerPhone: invoice.customer?.phone ?? null,
    date: formatDate(invoice.date),
    paymentType: paymentTypeAr(invoice.paymentType),
    currency: settings?.currency ?? "د.ع",
    accent: designAccent(settings?.invoiceDesign),
    lines: invoice.items.map((item, i) => ({
      productName: item.productName,
      itemNumber: item.itemNumber ?? item.product?.itemNumber ?? null,
      imageDataUrl: lineImages[i] ?? null,
      unit: unitAr(item.unit),
      pcsPerCarton: item.product?.pcsPerCarton ?? null,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      totalPrice: Number(item.totalPrice),
    })),
    subtotal: Number(invoice.subtotal),
    discount: Number(invoice.discount),
    tax: Number(invoice.tax),
    totalAmount: Number(invoice.totalAmount),
    paidAmount: Number(invoice.paidAmount),
    remainingAmount: Number(invoice.remainingAmount),
    previousBalance: Number(invoice.previousBalance ?? 0),
    finalBalance: Number(invoice.finalBalance ?? 0),
  };
}

// ── Picture invoice renderer ─────────────────────────────────────────────────

const IMG_CANVAS_W = 1240;   // logical width; rasterised at 2x for phone screens
const IMG_SCALE = 2;
const IMG_PAD = 28;          // outer margin
const IMG_THUMB = 96;        // product photo box

const PLACEHOLDER_ICON = `<rect width="96" height="96" rx="12" fill="#EEF2F7"/>
  <path d="M28 62 L42 46 L52 56 L64 40 L74 62" stroke="#A3AFC0" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="36" cy="34" r="6" fill="#A3AFC0"/>`;

function productThumbSvg(dataUrl: string | null, x: number, y: number): string {
  if (!dataUrl) return `<g transform="translate(${x},${y})">${PLACEHOLDER_ICON}</g>`;
  return `<clipPath id="cp_${x}_${y}"><rect x="${x}" y="${y}" width="${IMG_THUMB}" height="${IMG_THUMB}" rx="12"/></clipPath>`
    + `<image href="${esc(dataUrl)}" x="${x}" y="${y}" width="${IMG_THUMB}" height="${IMG_THUMB}" `
    + `preserveAspectRatio="xMidYMid slice" clip-path="url(#cp_${x}_${y})"/>`
    + `<rect x="${x}" y="${y}" width="${IMG_THUMB}" height="${IMG_THUMB}" rx="12" fill="none" stroke="#E2E8F0"/>`;
}

const IMG_FONT = "Cairo, 'Noto Naskh Arabic', 'Noto Sans Arabic', Tahoma, DejaVu Sans, sans-serif";

// Right-to-left anchors: with direction:rtl, "start" pins the right edge.
function txt(
  content: string,
  x: number,
  y: number,
  size: number,
  opts: { color?: string; bold?: boolean; align?: "right" | "center" | "left" } = {},
): string {
  if (content === "" || content === null || content === undefined) return "";
  const anchor = opts.align === "center" ? "middle" : opts.align === "left" ? "end" : "start";
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${IMG_FONT}" font-size="${size}" `
    + `font-weight="${opts.bold ? 800 : 500}" fill="${opts.color || "#0F172A"}" text-anchor="${anchor}" `
    + `style="direction:rtl">${esc(content)}</text>`;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * The picture invoice. Wide, high-resolution and detailed on purpose: the
 * customer reads it on a phone, so every figure the paper invoice shows has to
 * survive the trip.
 */
export async function generateCustomerImageInvoiceWithProducts(invoiceId: string): Promise<Buffer> {
  return renderCustomerImageFromDto(await buildCustomerSafeInvoiceDto(invoiceId));
}

// Split out from generateCustomerImageInvoiceWithProducts so the drawing can be
// exercised against a hand-built DTO, without a database.
export async function renderCustomerImageFromDto(dto: CustomerSafeInvoiceDto): Promise<Buffer> {
  const accent = dto.accent;
  const W = IMG_CANVAS_W;
  const inner = W - IMG_PAD * 2;
  const left = IMG_PAD;
  const right = W - IMG_PAD;

  const body: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  let y = IMG_PAD;
  const headerH = 150;
  body.push(`<rect x="${left}" y="${y}" width="${inner}" height="${headerH}" rx="18" fill="#FFFFFF" stroke="#E2E8F0"/>`);
  body.push(`<path d="M${left + 18},${y} h${inner - 36} a18,18 0 0 1 18,18 v6 h-${inner} v-6 a18,18 0 0 1 18,-18 z" fill="${accent}"/>`);

  if (dto.storeLogo) {
    body.push(`<image href="${esc(dto.storeLogo)}" x="${left + 24}" y="${y + 30}" width="110" height="90" preserveAspectRatio="xMidYMid meet"/>`);
  }
  body.push(txt(dto.storeName, right - 24, y + 58, 32, { bold: true, color: accent }));
  if (dto.storePhone) body.push(txt(`\u{1F4DE} ${dto.storePhone}`, right - 24, y + 88, 17, { color: "#64748B" }));
  if (dto.storeAddress) body.push(txt(`\u{1F4CD} ${dto.storeAddress}`, right - 24, y + 114, 17, { color: "#64748B" }));

  // Invoice identity block, pinned left inside the header
  const idX = left + 150;
  body.push(txt(`فاتورة رقم ${dto.invoiceNumber}`, idX, y + 58, 22, { bold: true, align: "left" }));
  body.push(txt(`التاريخ: ${dto.date}`, idX, y + 86, 16, { color: "#64748B", align: "left" }));
  const badgeW = 150;
  body.push(`<rect x="${idX}" y="${y + 98}" width="${badgeW}" height="30" rx="15" fill="${accent}1A"/>`);
  body.push(txt(`الدفع: ${dto.paymentType}`, idX + badgeW / 2, y + 118, 15, { color: accent, bold: true, align: "center" }));

  y += headerH + 14;

  // ── Customer strip ────────────────────────────────────────────────────────
  const custH = 74;
  body.push(`<rect x="${left}" y="${y}" width="${inner}" height="${custH}" rx="14" fill="#F8FAFC" stroke="#E2E8F0"/>`);
  body.push(txt("الزبون", right - 20, y + 28, 15, { color: "#94A3B8" }));
  body.push(txt(dto.customerName, right - 20, y + 56, 22, { bold: true }));
  if (dto.customerPhone) body.push(txt(dto.customerPhone, left + 20, y + 56, 18, { color: "#475569", align: "left" }));
  body.push(txt(`عدد الأصناف: ${dto.lines.length}`, left + 20, y + 28, 15, { color: "#94A3B8", align: "left" }));
  y += custH + 16;

  // ── Items table ───────────────────────────────────────────────────────────
  // Columns run right-to-left; widths are shares of the printable width.
  const cols = [
    { key: "idx", label: "#", share: 4, center: true },
    { key: "img", label: "صورة", share: 10, center: true },
    { key: "name", label: "الصنف", share: 41 },
    { key: "unit", label: "الوحدة", share: 9, center: true },
    { key: "qty", label: "الكمية", share: 8, center: true },
    { key: "price", label: "السعر", share: 13, center: true },
    { key: "total", label: "المجموع", share: 15, center: true },
  ];
  const shareSum = cols.reduce((s, c) => s + c.share, 0);
  let cursor = right;
  const geom = cols.map((c) => {
    const w = (c.share / shareSum) * inner;
    const box = { ...c, right: cursor, left: cursor - w, width: w };
    cursor -= w;
    return box;
  });

  const headH = 46;
  body.push(`<rect x="${left}" y="${y}" width="${inner}" height="${headH}" rx="12" fill="${accent}"/>`);
  for (const g of geom) {
    body.push(txt(g.label, g.center ? g.left + g.width / 2 : g.right - 14, y + 30, 17, {
      color: "#FFFFFF", bold: true, align: g.center ? "center" : "right",
    }));
  }
  y += headH;

  const nameCol = geom.find((g) => g.key === "name")!;
  const imgCol = geom.find((g) => g.key === "img")!;

  dto.lines.forEach((line, i) => {
    const nameLines = wrapText(line.productName, nameCol.width - 28, 19, true, 3);
    const metaBits: string[] = [];
    if (line.itemNumber) metaBits.push(`رقم الايتم: ${line.itemNumber}`);
    if (line.pcsPerCarton && line.pcsPerCarton > 1) metaBits.push(`${line.pcsPerCarton} قطعة بالكرتون`);
    const metaLines = wrapText(metaBits.join("  •  "), nameCol.width - 28, 15, false, 1);

    const textH = 16 + nameLines.length * 26 + metaLines.length * 22;
    const rowH = Math.max(IMG_THUMB + 24, textH + 14);

    if (i % 2 === 1) body.push(`<rect x="${left}" y="${y}" width="${inner}" height="${rowH}" fill="#F8FAFC"/>`);
    body.push(`<rect x="${left}" y="${y + rowH - 1}" width="${inner}" height="1" fill="#E2E8F0"/>`);

    const mid = y + rowH / 2;
    body.push(txt(`${i + 1}`, geom[0].left + geom[0].width / 2, mid + 7, 17, { color: "#94A3B8", align: "center" }));
    body.push(productThumbSvg(line.imageDataUrl, imgCol.left + (imgCol.width - IMG_THUMB) / 2, y + (rowH - IMG_THUMB) / 2));

    let textY = y + 34;
    for (const text of nameLines) {
      body.push(txt(text, nameCol.right - 14, textY, 19, { bold: true }));
      textY += 26;
    }
    for (const text of metaLines) {
      body.push(txt(text, nameCol.right - 14, textY, 15, { color: accent }));
      textY += 22;
    }
    const centerAt = (key: string, value: string, opts: { color?: string; bold?: boolean } = {}) => {
      const g = geom.find((c) => c.key === key)!;
      body.push(txt(value, g.left + g.width / 2, mid + 7, 18, { ...opts, align: "center" }));
    };
    centerAt("unit", line.unit, { color: "#475569" });
    centerAt("qty", `${line.quantity}`, { bold: true });
    centerAt("price", fmt(line.unitPrice), { color: "#334155" });
    centerAt("total", fmt(line.totalPrice), { color: accent, bold: true });

    y += rowH;
  });

  y += 10;
  body.push(txt(`كل الأسعار والمجاميع بـ ${dto.currency}`, left + inner / 2, y + 16, 15, { color: "#94A3B8", align: "center" }));
  y += 40;

  // ── Summary block ────────────────────────
  const summaryW = 480;
  const summaryX = right - summaryW;
  const summaryTop = y;

  const summaryRows: Array<{ label: string; value: number; color?: string; bold?: boolean }> = [
    { label: "مجموع الأصناف", value: dto.subtotal },
  ];
  if (dto.discount) summaryRows.push({ label: "الخصم المطروح", value: dto.discount, color: "#B45309" });
  if (dto.tax) summaryRows.push({ label: "الضريبة", value: dto.tax, color: "#475569" });
  summaryRows.push({ label: "إجمالي الفاتورة", value: dto.totalAmount, bold: true });
  summaryRows.push({ label: "المدفوع", value: dto.paidAmount, color: "#0D9488" });
  summaryRows.push({ label: "المتبقي من الفاتورة", value: dto.remainingAmount, color: "#DC2626" });
  if (dto.previousBalance) summaryRows.push({ label: "الرصيد السابق", value: dto.previousBalance, color: "#B45309" });

  const rowStep = 38;
  const grandH = 68;
  const summaryH = 18 + summaryRows.length * rowStep + 14 + grandH + 16;

  // ── Summary card ──────────────────────────────────────────────────────────
  body.push(`<rect x="${summaryX}" y="${summaryTop}" width="${summaryW}" height="${summaryH}" rx="16" fill="#F8FAFC" stroke="#E2E8F0"/>`);
  let sy = summaryTop + 18;
  for (const row of summaryRows) {
    body.push(txt(row.label, right - 22, sy + 24, 17, { color: "#64748B" }));
    body.push(txt(`${fmt(row.value)} ${dto.currency}`, summaryX + 22, sy + 24, 19, {
      color: row.color || "#0F172A", bold: row.bold, align: "left",
    }));
    sy += rowStep;
  }
  body.push(`<rect x="${summaryX + 22}" y="${sy + 2}" width="${summaryW - 44}" height="1" fill="#CBD5E1"/>`);
  sy += 14;
  body.push(`<rect x="${summaryX + 18}" y="${sy}" width="${summaryW - 36}" height="${grandH}" rx="12" fill="${accent}"/>`);
  body.push(txt("المطلوب الكلّي", right - 40, sy + 42, 20, { color: "#FFFFFF" }));
  body.push(txt(`${fmt(dto.finalBalance)} ${dto.currency}`, summaryX + 40, sy + 44, 28, { color: "#FFFFFF", bold: true, align: "left" }));

  y = summaryTop + summaryH + 26;

  // ── Footer ────────────────────────────────────────────────────────────────
  body.push(`<rect x="${left}" y="${y}" width="${inner}" height="1" fill="#E2E8F0"/>`);
  body.push(txt(
    `شكراً لتعاملكم — ${dto.storeName}${dto.storePhone ? ` | ${dto.storePhone}` : ""}`,
    left + inner / 2, y + 32, 17, { color: "#94A3B8", align: "center" },
  ));
  const H = Math.ceil(y + 56);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" fill="#F1F5F9"/>`
    + `<rect x="${left - 8}" y="${IMG_PAD - 8}" width="${inner + 16}" height="${H - IMG_PAD * 2 + 16}" rx="22" fill="#FFFFFF"/>`
    + body.join("\n")
    + `</svg>`;

  return sharp(Buffer.from(svg), { density: 72 * IMG_SCALE })
    .resize({ width: W * IMG_SCALE, height: H * IMG_SCALE, fit: "fill" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Customer-safe invoice as a real PDF — the same picture as above laid out on a
 * page of the logical (unscaled) size, so the file opens at a sane zoom.
 */
export async function generateCustomerImagePdf(invoiceId: string): Promise<Buffer> {
  const png = await generateCustomerImageInvoiceWithProducts(invoiceId);
  const meta = await sharp(png).metadata();
  return pngToPdf(png, {
    width: Math.round((meta.width ?? IMG_CANVAS_W * IMG_SCALE) / IMG_SCALE),
    height: Math.round((meta.height ?? 1600) / IMG_SCALE),
  });
}

function imageExtensionFromDataUrl(dataUrl: string): "jpeg" | "png" | "gif" | null {
  const match = /^data:image\/(jpeg|jpg|png|gif);base64,/i.exec(dataUrl);
  if (!match) return null;
  const type = match[1].toLowerCase();
  return type === "jpg" ? "jpeg" : (type as "jpeg" | "png" | "gif");
}

function addEmbeddedImage(workbook: ExcelJS.Workbook, dataUrl: string | null): number | null {
  if (!dataUrl) return null;
  const extension = imageExtensionFromDataUrl(dataUrl);
  if (!extension) return null;
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return workbook.addImage({ base64, extension });
}

/**
 * Customer-safe invoice as an .xlsx workbook, with product thumbnails
 * embedded per row. Built from the exact same allowlist DTO as the PDF/PNG
 * above — purchase price/cost price/profit/margin/internal notes physically
 * cannot appear because the DTO never carries them.
 */
export async function generateCustomerImageExcel(invoiceId: string): Promise<Buffer> {
  const dto = await buildCustomerSafeInvoiceDto(invoiceId);
  return buildCustomerImageExcelFromDto(dto);
}

// Split out from generateCustomerImageExcel so the workbook-building logic can
// be unit-tested against a hand-built DTO, without a real database.
export async function buildCustomerImageExcelFromDto(dto: CustomerSafeInvoiceDto): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("فاتورة", { views: [{ rightToLeft: true }] });
  sheet.columns = [
    { width: 4 },   // #
    { width: 12 },  // صورة
    { width: 34 },  // اسم الصنف
    { width: 14 },  // رقم الايتم
    { width: 12 },  // الوحدة
    { width: 10 },  // الكمية
    { width: 16 },  // سعر المفرد
    { width: 18 },  // الإجمالي
  ];

  // storeLogo is already resolved to a data URI by the DTO builder.
  const logoImageId = addEmbeddedImage(workbook, dto.storeLogo);
  if (logoImageId !== null) {
    sheet.addImage(logoImageId, { tl: { col: 5.2, row: 0.1 }, ext: { width: 90, height: 60 } });
  }

  sheet.mergeCells("A1:D1");
  sheet.getCell("A1").value = dto.storeName;
  sheet.getCell("A1").font = { bold: true, size: 16 };

  sheet.mergeCells("A2:D2");
  sheet.getCell("A2").value = `فاتورة رقم ${dto.invoiceNumber}`;
  sheet.getCell("A2").font = { bold: true, size: 12 };

  sheet.mergeCells("A3:D3");
  sheet.getCell("A3").value = `التاريخ: ${dto.date}  |  الدفع: ${dto.paymentType}`;

  sheet.mergeCells("A4:D4");
  sheet.getCell("A4").value = `الزبون: ${dto.customerName}${dto.customerPhone ? ` (${dto.customerPhone})` : ""}`;
  sheet.getCell("A4").font = { bold: true };

  const headerRowIndex = 6;
  const headerRow = sheet.getRow(headerRowIndex);
  headerRow.values = ["#", "صورة", "اسم الصنف", "رقم الايتم", "الوحدة", "الكمية", "سعر المفرد", "الإجمالي"];
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });

  const currencyFmt = `#,##0 "${dto.currency}"`;
  let rowIndex = headerRowIndex + 1;
  dto.lines.forEach((line, i) => {
    const row = sheet.getRow(rowIndex);
    row.height = 48;
    row.getCell(1).value = i + 1;
    row.getCell(3).value = line.pcsPerCarton && line.pcsPerCarton > 1
      ? `${line.productName} (${line.pcsPerCarton} ق/ك)`
      : line.productName;
    row.getCell(4).value = line.itemNumber ?? "";
    row.getCell(5).value = line.unit;
    row.getCell(6).value = line.quantity;
    row.getCell(7).value = line.unitPrice;
    row.getCell(7).numFmt = currencyFmt;
    row.getCell(8).value = line.totalPrice;
    row.getCell(8).numFmt = currencyFmt;
    row.eachCell((cell) => { cell.alignment = { horizontal: "center", vertical: "middle" }; });

    const imageId = addEmbeddedImage(workbook, line.imageDataUrl);
    if (imageId !== null) {
      sheet.addImage(imageId, {
        tl: { col: 1.15, row: rowIndex - 1 + 0.1 },
        ext: { width: 44, height: 44 },
      });
    }
    rowIndex += 1;
  });

  rowIndex += 1;
  const summaryRows: Array<[string, number]> = [["مجموع الأصناف", dto.subtotal]];
  if (dto.discount) summaryRows.push(["الخصم", dto.discount]);
  if (dto.tax) summaryRows.push(["الضريبة", dto.tax]);
  summaryRows.push(["إجمالي الفاتورة", dto.totalAmount]);
  summaryRows.push(["المدفوع", dto.paidAmount]);
  summaryRows.push(["المتبقي من الفاتورة", dto.remainingAmount]);
  if (dto.previousBalance) summaryRows.push(["الرصيد السابق", dto.previousBalance]);
  summaryRows.push(["المطلوب الكلّي", dto.finalBalance]);

  for (const [label, value] of summaryRows) {
    sheet.mergeCells(`C${rowIndex}:E${rowIndex}`);
    sheet.getCell(`C${rowIndex}`).value = label;
    sheet.getCell(`C${rowIndex}`).font = { bold: true };
    sheet.getCell(`C${rowIndex}`).alignment = { horizontal: "left" };
    sheet.getCell(`H${rowIndex}`).value = value;
    sheet.getCell(`H${rowIndex}`).numFmt = currencyFmt;
    sheet.getCell(`H${rowIndex}`).font = { bold: true };
    rowIndex += 1;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
