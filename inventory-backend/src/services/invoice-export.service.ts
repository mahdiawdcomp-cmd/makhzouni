import sharp from "sharp";
import ExcelJS from "exceljs";
import { getInvoiceById } from "./invoice.service";
import { getSettings } from "./settings.service";
import { pngToPdf } from "../utils/png-to-pdf";
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

function paymentTypeAr(type: string) {
  if (type === "CASH")    return "نقد كامل";
  if (type === "PARTIAL") return "دفع جزئي";
  if (type === "CREDIT")  return "آجل";
  return type;
}

function unitAr(unit: string) {
  if (unit === "CARTON") return "كرتونة";
  if (unit === "BOX") return "علبة";
  if (unit === "DOZEN")  return "درزن";
  return "قطعة";
}

/** Generate a beautiful HTML invoice that the browser can print as PDF */
async function buildInvoiceHtml(invoiceId: string): Promise<string> {
  const [invoice, settings] = await Promise.all([
    getInvoiceById(invoiceId),
    getSettings().catch(() => null),
  ]);

  const storeName    = settings?.storeName    ?? "مخزوني";
  const storeLogo    = settings?.storeLogo    ?? "";
  const storePhone   = settings?.storePhone   ?? "";
  const storeAddress = settings?.storeAddress ?? "";
  const currency     = settings?.currency     ?? "د.ع";
  const isPurchase   = invoice.type === "PURCHASE";
  const accentColor  = isPurchase ? "#D97706" : "#1D4ED8";
  const typeLabel    = isPurchase ? "فاتورة شراء" : "فاتورة بيع";

  const itemsHtml = (invoice.items ?? []).map((item: any, i: number) => `
    <tr class="${i % 2 === 0 ? "even" : ""}">
      <td class="num">${i + 1}</td>
      <td class="name">${esc(item.productName)}${item.notes ? `<div style="font-size:11px;color:#B45309;margin-top:2px">📝 ${esc(item.notes)}</div>` : ""}</td>
      <td class="center">${unitAr(item.unit)}</td>
      <td class="center">${item.quantity}</td>
      <td class="num">${money(item.unitPrice)} ${currency}</td>
      <td class="num total">${money(item.totalPrice)} ${currency}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>فاتورة ${esc(invoice.invoiceNumber)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Cairo', Tahoma, Arial, sans-serif;
      background: #F3F4F6;
      color: #1F2937;
      min-height: 100vh;
      padding: 32px 20px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      max-width: 820px;
      margin: 0 auto;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.10);
      overflow: hidden;
    }
    /* ── Top accent bar ── */
    .accent-bar {
      height: 6px;
      background: ${accentColor};
    }
    /* ── Header ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 28px 32px 20px;
      border-bottom: 1px solid #E5E7EB;
    }
    .store-name { font-size: 22px; font-weight: 800; color: ${accentColor}; }
    .store-meta { font-size: 12px; color: #6B7280; margin-top: 4px; }
    .invoice-meta { text-align: left; }
    .inv-number { font-size: 18px; font-weight: 700; color: #111827; }
    .inv-date   { font-size: 12px; color: #6B7280; margin-top: 4px; }
    .inv-type {
      display: inline-block;
      background: ${accentColor}18;
      color: ${accentColor};
      font-size: 11px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 20px;
      margin-top: 6px;
    }
    /* ── Customer section ── */
    .customer-section {
      padding: 16px 32px;
      background: #F9FAFB;
      border-bottom: 1px solid #E5E7EB;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .customer-label { font-size: 11px; color: #9CA3AF; margin-bottom: 4px; }
    .customer-name  { font-size: 16px; font-weight: 700; }
    .customer-phone { font-size: 12px; color: #6B7280; }
    .status-badge {
      display: inline-block;
      padding: 5px 14px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 700;
      background: ${invoice.status === "ACTIVE" ? "#DCFCE7" : "#FEE2E2"};
      color: ${invoice.status === "ACTIVE" ? "#15803D" : "#B91C1C"};
    }
    /* ── Items table ── */
    .items-section { padding: 24px 32px; }
    .section-title { font-size: 13px; font-weight: 700; color: #374151; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    thead tr { background: ${accentColor}; color: #fff; }
    th { padding: 10px 12px; font-weight: 600; font-size: 12px; }
    td { padding: 10px 12px; border-bottom: 1px solid #F3F4F6; }
    tr.even td { background: #FAFAFA; }
    tbody tr:hover td { background: ${accentColor}08; }
    .center { text-align: center; }
    .num    { text-align: left; font-variant-numeric: tabular-nums; }
    .name   { font-weight: 600; }
    .total  { font-weight: 700; color: ${accentColor}; }
    /* ── Summary ── */
    .summary-section {
      padding: 20px 32px 28px;
      display: flex;
      justify-content: space-between;
      gap: 32px;
      border-top: 1px solid #E5E7EB;
    }
    .summary-box {
      background: #F9FAFB;
      border: 1px solid #E5E7EB;
      border-radius: 10px;
      padding: 16px 20px;
      min-width: 260px;
    }
    .summary-box h3 { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #9CA3AF; margin-bottom: 12px; }
    .summary-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
    .summary-row + .summary-row { border-top: 1px solid #F3F4F6; }
    .summary-label { color: #6B7280; }
    .summary-value { font-weight: 600; }
    .summary-divider { border: none; border-top: 2px solid #E5E7EB; margin: 8px 0; }
    .final-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: ${accentColor};
      color: #fff;
      border-radius: 8px;
      padding: 12px 16px;
      margin-top: 10px;
    }
    .final-row .label { font-size: 14px; font-weight: 600; }
    .final-row .value { font-size: 18px; font-weight: 800; }
    /* ── Footer ── */
    .footer {
      padding: 16px 32px;
      border-top: 1px solid #E5E7EB;
      text-align: center;
      font-size: 12px;
      color: #9CA3AF;
    }
    /* ── Print ── */
    @media print {
      body { background: white; padding: 0; }
      .page { max-width: 100%; border-radius: 0; box-shadow: none; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="text-align:center;margin-bottom:16px;">
    <button onclick="window.print()" style="background:${accentColor};color:#fff;border:none;border-radius:8px;padding:10px 28px;font-size:14px;font-family:inherit;cursor:pointer;font-weight:700;">
      🖨 طباعة / حفظ PDF
    </button>
  </div>

  <div class="page">
    <div class="accent-bar"></div>

    <!-- Header -->
    <div class="header">
      <div style="display:flex;align-items:center;gap:12px;">
        ${storeLogo ? `<img src="${storeLogo}" style="max-height:56px;max-width:80px;object-fit:contain;border-radius:8px;" alt="logo" />` : ""}
        <div>
          <div class="store-name">${esc(storeName)}</div>
          ${storePhone   ? `<div class="store-meta">📞 ${esc(storePhone)}</div>` : ""}
          ${storeAddress ? `<div class="store-meta">📍 ${esc(storeAddress)}</div>` : ""}
        </div>
      </div>
      <div class="invoice-meta">
        <div class="inv-number">${esc(invoice.invoiceNumber)}</div>
        <div class="inv-date">📅 ${formatDate(invoice.date)}</div>
        <div class="inv-type">${typeLabel}</div>
      </div>
    </div>

    <!-- Customer -->
    <div class="customer-section">
      <div>
        <div class="customer-label">${isPurchase ? "المورّد" : "الزبون"}</div>
        <div class="customer-name">${esc(invoice.customer?.name ?? "—")}</div>
        ${invoice.customer?.phone ? `<div class="customer-phone">${esc(invoice.customer.phone)}</div>` : ""}
      </div>
      <div>
        <div class="customer-label">طريقة الدفع</div>
        <div style="font-weight:700;font-size:13px;">${paymentTypeAr(invoice.paymentType)}</div>
        <div class="status-badge" style="margin-top:6px;">${invoice.status === "ACTIVE" ? "✓ نشطة" : "✗ ملغاة"}</div>
      </div>
    </div>

    <!-- Items -->
    <div class="items-section">
      <div class="section-title">الأصناف</div>
      <table>
        <thead>
          <tr>
            <th class="center" style="width:40px">#</th>
            <th>اسم الصنف</th>
            <th class="center">الوحدة</th>
            <th class="center">الكمية</th>
            <th class="num">سعر المفرد</th>
            <th class="num">الإجمالي</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
    </div>

    ${invoice.notes ? `
    <!-- Invoice notes -->
    <div style="margin:12px 32px 0;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:10px 14px;font-size:12px;color:#92400E">
      <b>📝 ملاحظات:</b> ${esc(invoice.notes)}
    </div>` : ""}

    <!-- Summary -->
    <div class="summary-section">
      <div style="flex:1"></div>
      <div class="summary-box">
        <h3>الملخص المالي</h3>
        <div class="summary-row">
          <span class="summary-label">قيمة الأصناف</span>
          <span class="summary-value">${money(invoice.subtotal)} ${currency}</span>
        </div>
        ${Number(invoice.discount) > 0 ? `
        <div class="summary-row">
          <span class="summary-label">الخصم</span>
          <span class="summary-value" style="color:#DC2626">- ${money(invoice.discount)} ${currency}</span>
        </div>` : ""}
        ${Number(invoice.tax) > 0 ? `
        <div class="summary-row">
          <span class="summary-label">الضريبة</span>
          <span class="summary-value">${money(invoice.tax)} ${currency}</span>
        </div>` : ""}
        <hr class="summary-divider" />
        <div class="summary-row">
          <span class="summary-label" style="font-weight:700">الإجمالي</span>
          <span class="summary-value" style="font-size:15px">${money(invoice.totalAmount)} ${currency}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">المدفوع</span>
          <span class="summary-value" style="color:#059669">${money(invoice.paidAmount)} ${currency}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">الباقي</span>
          <span class="summary-value" style="color:${Number(invoice.remainingAmount) > 0 ? "#DC2626" : "#059669"}">${money(invoice.remainingAmount)} ${currency}</span>
        </div>
        <hr class="summary-divider" />
        <div class="summary-row">
          <span class="summary-label">الرصيد السابق</span>
          <span class="summary-value">${money(invoice.previousBalance)} ${currency}</span>
        </div>
        <div class="final-row">
          <span class="label">الرصيد النهائي</span>
          <span class="value">${money(invoice.finalBalance)} ${currency}</span>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      شكراً لتعاملكم — ${esc(storeName)}${storePhone ? ` | ${esc(storePhone)}` : ""}
    </div>
  </div>
</body>
</html>`;
}

/** Return the invoice as a beautiful HTML page (browser can print/save as PDF) */
export async function generateInvoiceHtml(invoiceId: string): Promise<Buffer> {
  const html = await buildInvoiceHtml(invoiceId);
  return Buffer.from(html, "utf8");
}

/** Return the invoice as a REAL PDF (image-backed, single page) */
export async function generateInvoicePdf(invoiceId: string): Promise<Buffer> {
  const png = await generateInvoicePng(invoiceId);
  return pngToPdf(png);
}

/** Return invoice as PNG image (used for WhatsApp sharing) */
export async function generateInvoicePng(invoiceId: string): Promise<Buffer> {
  const [invoice, settings] = await Promise.all([
    getInvoiceById(invoiceId),
    getSettings().catch(() => null),
  ]);

  const storeName  = settings?.storeName  ?? "مخزوني";
  const currency   = settings?.currency   ?? "د.ع";
  const isPurchase = invoice.type === "PURCHASE";
  const accent     = isPurchase ? "#D97706" : "#1D4ED8";
  const typeLabel  = isPurchase ? "فاتورة شراء" : "فاتورة بيع";

  const itemRows = (invoice.items ?? []).map((item: any, i: number) => `
    <rect x="40" y="${310 + i * 36}" width="820" height="36" fill="${i % 2 === 0 ? "#F9FAFB" : "#FFFFFF"}"/>
    <text x="56" y="${332 + i * 36}" font-size="13" fill="#111827" font-weight="600">${esc(item.productName).substring(0, item.notes ? 22 : 28)}${item.notes ? ` <tspan font-size="11" fill="#B45309">📝 ${esc(String(item.notes)).substring(0, 18)}</tspan>` : ""}</text>
    <text x="430" y="${332 + i * 36}" font-size="12" fill="#6B7280" text-anchor="middle">${unitAr(item.unit)}</text>
    <text x="520" y="${332 + i * 36}" font-size="12" fill="#111827" text-anchor="middle" font-weight="700">${item.quantity}</text>
    <text x="630" y="${332 + i * 36}" font-size="12" fill="#374151" text-anchor="end">${money(item.unitPrice)}</text>
    <text x="845" y="${332 + i * 36}" font-size="13" fill="${accent}" text-anchor="end" font-weight="700">${money(item.totalPrice)}</text>
  `).join("");

  const itemCount = (invoice.items ?? []).length;
  const bodyH = Math.max(520, 350 + itemCount * 36 + 240);

  const svg = `<svg width="900" height="${bodyH}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>text { font-family: Arial, sans-serif; }</style>
    </defs>
    <!-- Background -->
    <rect width="900" height="${bodyH}" fill="#F3F4F6"/>
    <rect x="24" y="24" width="852" height="${bodyH - 48}" rx="12" fill="#FFFFFF" stroke="#E5E7EB"/>
    <!-- Accent bar -->
    <rect x="24" y="24" width="852" height="6" rx="12" fill="${accent}"/>

    <!-- Store name -->
    <text x="56" y="82" font-size="20" font-weight="800" fill="${accent}">${esc(storeName)}</text>
    ${settings?.storePhone ? `<text x="56" y="104" font-size="12" fill="#9CA3AF">${esc(settings.storePhone)}</text>` : ""}

    <!-- Invoice number + type -->
    <text x="844" y="72" font-size="17" font-weight="700" fill="#111827" text-anchor="end">${esc(invoice.invoiceNumber)}</text>
    <text x="844" y="92" font-size="11" fill="#9CA3AF" text-anchor="end">${new Date(invoice.date).toLocaleDateString("en-US")}</text>
    <rect x="${844 - esc(typeLabel).length * 7 - 16}" y="100" width="${esc(typeLabel).length * 7 + 24}" height="20" rx="10" fill="${accent}18"/>
    <text x="844" y="114" font-size="11" fill="${accent}" text-anchor="end" font-weight="700">${typeLabel}</text>

    <!-- Divider -->
    <line x1="40" y1="130" x2="860" y2="130" stroke="#E5E7EB"/>

    <!-- Customer -->
    <text x="56" y="158" font-size="11" fill="#9CA3AF">${isPurchase ? "المورّد" : "الزبون"}</text>
    <text x="56" y="180" font-size="16" font-weight="700" fill="#111827">${esc(invoice.customer?.name ?? "—")}</text>
    ${invoice.customer?.phone ? `<text x="56" y="198" font-size="12" fill="#6B7280">${esc(invoice.customer.phone)}</text>` : ""}

    <!-- Payment type badge -->
    <text x="844" y="158" font-size="11" fill="#9CA3AF" text-anchor="end">طريقة الدفع</text>
    <text x="844" y="180" font-size="13" fill="#111827" text-anchor="end" font-weight="700">${paymentTypeAr(invoice.paymentType)}</text>

    <!-- Divider -->
    <line x1="40" y1="220" x2="860" y2="220" stroke="#E5E7EB"/>

    <!-- Table header -->
    <rect x="40" y="236" width="820" height="36" fill="${accent}"/>
    <text x="56" y="258" font-size="12" fill="#FFFFFF" font-weight="600">الصنف</text>
    <text x="430" y="258" font-size="12" fill="#FFFFFF" font-weight="600" text-anchor="middle">الوحدة</text>
    <text x="520" y="258" font-size="12" fill="#FFFFFF" font-weight="600" text-anchor="middle">الكمية</text>
    <text x="630" y="258" font-size="12" fill="#FFFFFF" font-weight="600" text-anchor="end">السعر</text>
    <text x="845" y="258" font-size="12" fill="#FFFFFF" font-weight="600" text-anchor="end">الإجمالي</text>

    ${itemRows}

    ${invoice.notes ? `
    <!-- Invoice notes (left of the summary box) -->
    <text x="56" y="${310 + itemCount * 36 + 46}" font-size="11" fill="#9CA3AF">📝 ملاحظات</text>
    <text x="56" y="${310 + itemCount * 36 + 66}" font-size="12" fill="#92400E">${esc(String(invoice.notes)).substring(0, 55)}</text>
    <text x="56" y="${310 + itemCount * 36 + 84}" font-size="12" fill="#92400E">${esc(String(invoice.notes)).substring(55, 110)}</text>` : ""}

    <!-- Summary section -->
    <rect x="480" y="${310 + itemCount * 36 + 20}" width="380" height="160" rx="10" fill="#F9FAFB" stroke="#E5E7EB"/>
    <text x="496" y="${310 + itemCount * 36 + 46}" font-size="11" fill="#9CA3AF">قيمة الأصناف</text>
    <text x="844" y="${310 + itemCount * 36 + 46}" font-size="13" fill="#111827" text-anchor="end">${money(invoice.subtotal)} ${esc(currency)}</text>
    <text x="496" y="${310 + itemCount * 36 + 72}" font-size="11" fill="#6B7280">المدفوع</text>
    <text x="844" y="${310 + itemCount * 36 + 72}" font-size="13" fill="#059669" text-anchor="end" font-weight="600">${money(invoice.paidAmount)} ${esc(currency)}</text>
    <text x="496" y="${310 + itemCount * 36 + 98}" font-size="11" fill="#6B7280">الباقي</text>
    <text x="844" y="${310 + itemCount * 36 + 98}" font-size="13" fill="${Number(invoice.remainingAmount) > 0 ? "#DC2626" : "#059669"}" text-anchor="end" font-weight="600">${money(invoice.remainingAmount)} ${esc(currency)}</text>
    <line x1="496" y1="${310 + itemCount * 36 + 110}" x2="844" y2="${310 + itemCount * 36 + 110}" stroke="#E5E7EB"/>
    <!-- Final balance box -->
    <rect x="480" y="${310 + itemCount * 36 + 122}" width="380" height="42" rx="8" fill="${accent}"/>
    <text x="496" y="${310 + itemCount * 36 + 148}" font-size="13" fill="#FFFFFF">الرصيد النهائي</text>
    <text x="844" y="${310 + itemCount * 36 + 150}" font-size="17" fill="#FFFFFF" text-anchor="end" font-weight="800">${money(invoice.finalBalance)} ${esc(currency)}</text>

    <!-- Footer -->
    <text x="450" y="${bodyH - 20}" font-size="11" fill="#9CA3AF" text-anchor="middle">شكراً لتعاملكم — ${esc(storeName)}</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── Customer-safe image invoice (optional "send with images" WhatsApp option) ──
//
// SECURITY: this DTO is built from an explicit narrow Prisma `select` — never
// from the full invoice/product objects used elsewhere in this file — so
// purchasePrice/costPrice/profit/internal notes/audit fields structurally
// cannot leak into the customer-facing renderer below, even by accident.
// Does NOT touch generateInvoicePng/generateInvoicePdf (old WhatsApp flow).

export interface CustomerSafeInvoiceLine {
  productName: string;
  imageDataUrl: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface CustomerSafeInvoiceDto {
  storeName: string;
  storeLogo: string | null;
  invoiceNumber: string;
  customerName: string;
  date: string;
  currency: string;
  lines: CustomerSafeInvoiceLine[];
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
}

// Only a real data: URI can be embedded/rasterized offline; a bare http(s)
// product image URL is dropped in favor of the placeholder rather than risk
// a broken/unfetchable reference in the rendered image.
function embeddableImage(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^data:image\//i.test(url) ? url : null;
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
        totalAmount: true,
        paidAmount: true,
        remainingAmount: true,
        customer: { select: { name: true } },
        items: {
          select: {
            productName: true,
            unit: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
            product: { select: { thumbnailUrl: true, imageUrl: true } },
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

  return {
    storeName: settings?.storeName ?? "مخزوني",
    storeLogo: settings?.storeLogo ?? null,
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.customer?.name ?? "—",
    date: formatDate(invoice.date),
    currency: settings?.currency ?? "د.ع",
    lines: invoice.items.map((item) => ({
      productName: item.productName,
      imageDataUrl: embeddableImage(item.product?.thumbnailUrl ?? item.product?.imageUrl),
      unit: unitAr(item.unit),
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      totalPrice: Number(item.totalPrice),
    })),
    totalAmount: Number(invoice.totalAmount),
    paidAmount: Number(invoice.paidAmount),
    remainingAmount: Number(invoice.remainingAmount),
  };
}

const PLACEHOLDER_ICON = `<rect width="64" height="64" rx="10" fill="#E5E7EB"/>
  <path d="M20 40 L27 31 L33 37 L40 27 L46 40" stroke="#9CA3AF" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="24" cy="24" r="4" fill="#9CA3AF"/>`;

function itemImageSvg(dataUrl: string | null, x: number, y: number): string {
  if (dataUrl) {
    return `<clipPath id="clip-${x}-${y}"><rect x="${x}" y="${y}" width="64" height="64" rx="10"/></clipPath>
      <image href="${dataUrl}" x="${x}" y="${y}" width="64" height="64" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-${x}-${y})"/>`;
  }
  return `<g transform="translate(${x}, ${y})">${PLACEHOLDER_ICON}</g>`;
}

/**
 * Render a clean, customer-safe invoice image (with product thumbnails) for
 * the optional "إرسال فاتورة بالصور" WhatsApp option. Never includes
 * purchase price, cost price, profit, margin, or internal notes — the DTO
 * above physically cannot carry them.
 */
export async function generateCustomerImageInvoiceWithProducts(invoiceId: string): Promise<Buffer> {
  const dto = await buildCustomerSafeInvoiceDto(invoiceId);
  const accent = "#1D4ED8";
  const rowH = 84;
  const bodyH = Math.max(560, 300 + dto.lines.length * rowH + 220);

  const rows = dto.lines
    .map((line, i) => {
      const y = 250 + i * rowH;
      return `
    <rect x="40" y="${y}" width="820" height="${rowH - 8}" rx="10" fill="${i % 2 === 0 ? "#F9FAFB" : "#FFFFFF"}" stroke="#F1F5F9"/>
    ${itemImageSvg(line.imageDataUrl, 52, y + 6)}
    <text x="130" y="${y + 28}" font-size="14" fill="#111827" font-weight="700">${esc(line.productName).slice(0, 40)}</text>
    <text x="130" y="${y + 50}" font-size="12" fill="#6B7280">${esc(line.unit)} × ${line.quantity} — ${money(line.unitPrice)} ${esc(dto.currency)}</text>
    <text x="845" y="${y + 40}" font-size="15" fill="${accent}" text-anchor="end" font-weight="800">${money(line.totalPrice)} ${esc(dto.currency)}</text>`;
    })
    .join("");

  const summaryY = 250 + dto.lines.length * rowH + 20;

  const svg = `<svg width="900" height="${bodyH}" xmlns="http://www.w3.org/2000/svg">
    <defs><style>text { font-family: Arial, sans-serif; }</style></defs>
    <rect width="900" height="${bodyH}" fill="#F3F4F6"/>
    <rect x="24" y="24" width="852" height="${bodyH - 48}" rx="14" fill="#FFFFFF" stroke="#E5E7EB"/>
    <rect x="24" y="24" width="852" height="7" rx="14" fill="${accent}"/>

    <text x="56" y="84" font-size="22" font-weight="800" fill="${accent}">${esc(dto.storeName)}</text>
    <text x="844" y="76" font-size="17" font-weight="700" fill="#111827" text-anchor="end">${esc(dto.invoiceNumber)}</text>
    <text x="844" y="96" font-size="12" fill="#9CA3AF" text-anchor="end">${esc(dto.date)}</text>

    <line x1="40" y1="112" x2="860" y2="112" stroke="#E5E7EB"/>
    <text x="56" y="140" font-size="11" fill="#9CA3AF">الزبون</text>
    <text x="56" y="162" font-size="16" font-weight="700" fill="#111827">${esc(dto.customerName)}</text>
    <line x1="40" y1="190" x2="860" y2="190" stroke="#E5E7EB"/>

    ${rows}

    <rect x="480" y="${summaryY}" width="380" height="140" rx="10" fill="#F9FAFB" stroke="#E5E7EB"/>
    <text x="496" y="${summaryY + 28}" font-size="11" fill="#9CA3AF">الإجمالي</text>
    <text x="844" y="${summaryY + 28}" font-size="14" fill="#111827" text-anchor="end" font-weight="700">${money(dto.totalAmount)} ${esc(dto.currency)}</text>
    <text x="496" y="${summaryY + 54}" font-size="11" fill="#6B7280">المدفوع</text>
    <text x="844" y="${summaryY + 54}" font-size="13" fill="#059669" text-anchor="end" font-weight="600">${money(dto.paidAmount)} ${esc(dto.currency)}</text>
    <line x1="496" y1="${summaryY + 66}" x2="844" y2="${summaryY + 66}" stroke="#E5E7EB"/>
    <rect x="480" y="${summaryY + 78}" width="380" height="46" rx="8" fill="${accent}"/>
    <text x="496" y="${summaryY + 106}" font-size="13" fill="#FFFFFF">الباقي</text>
    <text x="844" y="${summaryY + 108}" font-size="18" fill="#FFFFFF" text-anchor="end" font-weight="800">${money(dto.remainingAmount)} ${esc(dto.currency)}</text>

    <text x="450" y="${bodyH - 20}" font-size="11" fill="#9CA3AF" text-anchor="middle">شكراً لتعاملكم — ${esc(dto.storeName)}</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Customer-safe invoice as a real PDF (same rendering as the WhatsApp image
 * invoice above, wrapped in a single-page PDF instead of a PNG). Built from
 * the same allowlist DTO — no purchase price/cost/profit can leak in.
 */
export async function generateCustomerImagePdf(invoiceId: string): Promise<Buffer> {
  const png = await generateCustomerImageInvoiceWithProducts(invoiceId);
  return pngToPdf(png);
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
    { width: 12 },  // الوحدة
    { width: 10 },  // الكمية
    { width: 16 },  // سعر المفرد
    { width: 18 },  // الإجمالي
  ];

  const logoImageId = addEmbeddedImage(workbook, embeddableImage(dto.storeLogo));
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
  sheet.getCell("A3").value = `التاريخ: ${dto.date}`;

  sheet.mergeCells("A4:D4");
  sheet.getCell("A4").value = `الزبون: ${dto.customerName}`;
  sheet.getCell("A4").font = { bold: true };

  const headerRowIndex = 6;
  const headerRow = sheet.getRow(headerRowIndex);
  headerRow.values = ["#", "صورة", "اسم الصنف", "الوحدة", "الكمية", "سعر المفرد", "الإجمالي"];
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
    row.getCell(3).value = line.productName;
    row.getCell(4).value = line.unit;
    row.getCell(5).value = line.quantity;
    row.getCell(6).value = line.unitPrice;
    row.getCell(6).numFmt = currencyFmt;
    row.getCell(7).value = line.totalPrice;
    row.getCell(7).numFmt = currencyFmt;
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
  const summaryRows: Array<[string, number]> = [
    ["الإجمالي", dto.totalAmount],
    ["المدفوع", dto.paidAmount],
    ["الباقي", dto.remainingAmount],
  ];
  for (const [label, value] of summaryRows) {
    sheet.mergeCells(`C${rowIndex}:D${rowIndex}`);
    sheet.getCell(`C${rowIndex}`).value = label;
    sheet.getCell(`C${rowIndex}`).font = { bold: true };
    sheet.getCell(`C${rowIndex}`).alignment = { horizontal: "left" };
    sheet.getCell(`G${rowIndex}`).value = value;
    sheet.getCell(`G${rowIndex}`).numFmt = currencyFmt;
    sheet.getCell(`G${rowIndex}`).font = { bold: true };
    rowIndex += 1;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
