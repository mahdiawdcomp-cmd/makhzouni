import sharp from "sharp";
import { getInvoiceById } from "./invoice.service";
import { getSettings } from "./settings.service";

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
      <td class="name">${esc(item.productName)}</td>
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
export async function generateInvoicePdf(invoiceId: string): Promise<Buffer> {
  const html = await buildInvoiceHtml(invoiceId);
  return Buffer.from(html, "utf8");
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
    <text x="56" y="${332 + i * 36}" font-size="13" fill="#111827" font-weight="600">${esc(item.productName).substring(0, 28)}</text>
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
