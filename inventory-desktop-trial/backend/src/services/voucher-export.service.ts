import sharp from "sharp";
import { getCustomerTransactions } from "./customer.service";
import { getSettings } from "./settings.service";
import { getVoucherById } from "./voucher.service";

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US").format(Number(value ?? 0));
}

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortText(value: unknown, max = 120) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function typeLabel(type: string) {
  if (type === "RECEIPT") return "سند قبض";
  if (type === "PAYMENT") return "سند دفع";
  return "سند مصاريف";
}

function partyLabel(type: string) {
  if (type === "PAYMENT") return "دفعنا إلى السيد / السادة:";
  if (type === "EXPENSE") return "وصف المصروف:";
  return "استلمنا من السيد / السادة:";
}

function formatDateTime(value: Date | string) {
  return new Date(value).toLocaleString("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

async function balanceSnapshot(voucher: any) {
  if (!voucher.customerId) {
    return { previous: null as number | null, final: null as number | null };
  }

  const statement = await getCustomerTransactions(voucher.customerId, { all: true });
  const row = statement.transactions.find(
    (transaction) =>
      transaction.id === voucher.id &&
      transaction.referenceNumber === voucher.voucherNumber
  );

  if (!row) {
    return { previous: null as number | null, final: null as number | null };
  }

  const debit = Number(row.debit ?? 0);
  const credit = Number(row.credit ?? 0);
  return {
    previous: Number(row.runningBalance) - debit + credit,
    final: Number(row.runningBalance),
  };
}

function buildVoucherHtml(voucher: any, options: {
  currency: string;
  storeName: string;
  storePhone?: string;
  storeAddress?: string;
  previous: number | null;
  final: number | null;
  includePrintButton?: boolean;
}) {
  const label = typeLabel(voucher.type);
  const partyName = voucher.customer?.name ?? voucher.description ?? "-";
  const paymentChecked = voucher.type === "RECEIPT" || voucher.type === "PAYMENT";
  const createdBy = voucher.creator?.name ?? voucher.creator?.username ?? "-";

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(label)} ${esc(voucher.voucherNumber)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: #f3f4f6;
      color: #1f2937;
      font-family: 'Cairo', Tahoma, Arial, sans-serif;
      padding: 32px 18px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      position: relative;
      max-width: 820px;
      margin: 0 auto;
      overflow: hidden;
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
    }
    .bar { height: 8px; background: #10b981; }
    .orb {
      position: absolute;
      top: -78px;
      right: -78px;
      width: 180px;
      height: 180px;
      border-radius: 999px;
      background: #ecfdf5;
      opacity: 0.8;
    }
    .header {
      position: relative;
      z-index: 1;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 18px;
      padding: 30px 32px 22px;
      border-bottom: 1px solid #e5e7eb;
    }
    h1 { margin: 0 0 4px; font-size: 32px; line-height: 1.2; font-weight: 800; }
    .store { color: #059669; font-size: 18px; font-weight: 800; }
    .store-meta { margin-top: 3px; color: #6b7280; font-size: 12px; }
    .amount {
      min-width: 180px;
      border: 1px solid #d1fae5;
      border-radius: 12px;
      background: #ecfdf5;
      padding: 14px 18px;
      text-align: center;
    }
    .amount .label { color: #6b7280; font-size: 12px; }
    .amount .value { color: #047857; font-size: 28px; font-weight: 800; }
    .content { position: relative; z-index: 1; padding: 28px 32px 30px; }
    .row {
      display: flex;
      gap: 10px;
      align-items: baseline;
      min-height: 44px;
      border-bottom: 2px dashed #9ca3af;
      padding: 6px 0 9px;
      font-size: 18px;
    }
    .row.two { gap: 28px; }
    .field { display: flex; flex: 1; gap: 10px; align-items: baseline; }
    .key { color: #4b5563; font-weight: 800; white-space: nowrap; }
    .value { flex: 1; color: #111827; font-weight: 800; }
    .green { color: #059669; }
    .muted { color: #6b7280; font-size: 14px; font-weight: 600; }
    .methods { display: flex; flex-wrap: wrap; gap: 20px; align-items: center; }
    .dot {
      display: inline-block;
      width: 14px;
      height: 14px;
      margin-left: 6px;
      border: 2px solid #9ca3af;
      border-radius: 999px;
      vertical-align: -2px;
    }
    .dot.checked { border-color: #059669; background: #10b981; }
    .print {
      margin: 0 auto 22px;
      display: block;
      border: 0;
      border-radius: 10px;
      background: #1f2937;
      color: #fff;
      cursor: pointer;
      padding: 10px 28px;
      font: inherit;
      font-weight: 800;
    }
    @media print {
      body { background: #fff; padding: 0; }
      .page { max-width: 100%; border-radius: 0; box-shadow: none; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  ${options.includePrintButton ? `<button class="print no-print" onclick="window.print()">طباعة / حفظ PDF</button>` : ""}
  <main class="page">
    <div class="bar"></div>
    <div class="orb"></div>
    <section class="header">
      <div>
        <h1>${esc(label)}</h1>
        <div class="store">${esc(options.storeName)}</div>
        ${options.storePhone ? `<div class="store-meta">${esc(options.storePhone)}</div>` : ""}
        ${options.storeAddress ? `<div class="store-meta">${esc(options.storeAddress)}</div>` : ""}
      </div>
      <div class="amount">
        <div class="label">المبلغ (${esc(options.currency)})</div>
        <div class="value">${money(voucher.amount)}</div>
      </div>
    </section>
    <section class="content">
      <div class="row two">
        <div class="field"><span class="key">رقم السند:</span><span class="value">${esc(voucher.voucherNumber)}</span></div>
        <div class="field"><span class="key">التاريخ والوقت:</span><span class="value">${formatDateTime(voucher.date)}</span></div>
      </div>
      <div class="row">
        <span class="key">${partyLabel(voucher.type)}</span>
        <span class="value">${esc(shortText(partyName, 80))}</span>
      </div>
      ${options.previous !== null ? `
      <div class="row">
        <span class="key">الحساب السابق (قبل السند):</span>
        <span class="value">${money(options.previous)} ${esc(options.currency)}</span>
      </div>
      <div class="row">
        <span class="key">الحساب النهائي (بعد السند):</span>
        <span class="value green">${money(options.final)} ${esc(options.currency)}</span>
      </div>` : ""}
      ${voucher.notes ? `
      <div class="row">
        <span class="key">الملاحظات:</span>
        <span class="value">${esc(shortText(voucher.notes, 110))}</span>
      </div>` : ""}
      <div class="row methods">
        <span class="key">طريقة الدفع:</span>
        <span><span class="dot ${paymentChecked ? "checked" : ""}"></span>نقدا</span>
        <span><span class="dot"></span>حوالة بنكية</span>
        <span><span class="dot"></span>شيك</span>
      </div>
      <div class="muted" style="margin-top:14px;">أنشأه: ${esc(createdBy)} | وقت الإدخال: ${formatDateTime(voucher.createdAt ?? voucher.date)}</div>
    </section>
  </main>
</body>
</html>`;
}

async function voucherContext(voucherId: string) {
  const [voucher, settings] = await Promise.all([
    getVoucherById(voucherId),
    getSettings().catch(() => null),
  ]);
  const snapshot = await balanceSnapshot(voucher);

  return {
    voucher,
    currency: settings?.currency ?? "د.ع",
    storeName: settings?.storeName ?? "مخزوني",
    storePhone: settings?.storePhone ?? "",
    storeAddress: settings?.storeAddress ?? "",
    ...snapshot,
  };
}

export async function generateVoucherPdf(voucherId: string) {
  const context = await voucherContext(voucherId);
  const html = buildVoucherHtml(context.voucher, { ...context, includePrintButton: true });
  return Buffer.from(html, "utf8");
}

export async function generateVoucherPng(voucherId: string) {
  const context = await voucherContext(voucherId);
  const voucher = context.voucher;
  const label = typeLabel(voucher.type);
  const partyName = voucher.customer?.name ?? voucher.description ?? "-";
  const createdBy = voucher.creator?.name ?? voucher.creator?.username ?? "-";
  const previousRow = context.previous !== null
    ? `<text x="770" y="356" text-anchor="end" class="key">الحساب السابق:</text>
       <text x="455" y="356" text-anchor="end" class="value">${money(context.previous)} ${esc(context.currency)}</text>
       <line x1="90" y1="374" x2="770" y2="374" class="dash"/>
       <text x="770" y="426" text-anchor="end" class="key">الحساب النهائي:</text>
       <text x="455" y="426" text-anchor="end" class="value green">${money(context.final)} ${esc(context.currency)}</text>
       <line x1="90" y1="444" x2="770" y2="444" class="dash"/>`
    : "";
  const notesRow = voucher.notes
    ? `<text x="770" y="496" text-anchor="end" class="key">الملاحظات:</text>
       <text x="455" y="496" text-anchor="end" class="value">${esc(shortText(voucher.notes, 70))}</text>
       <line x1="90" y1="514" x2="770" y2="514" class="dash"/>`
    : "";
  const svg = `<svg width="900" height="650" viewBox="0 0 900 650" xmlns="http://www.w3.org/2000/svg" direction="rtl">
    <defs>
      <style>
        text { font-family: Tahoma, Arial, sans-serif; }
        .key { font-size: 24px; font-weight: 700; fill: #4b5563; }
        .value { font-size: 25px; font-weight: 800; fill: #111827; }
        .green { fill: #059669; }
        .dash { stroke: #9ca3af; stroke-width: 2; stroke-dasharray: 8 7; }
      </style>
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#111827" flood-opacity="0.12"/>
      </filter>
    </defs>
    <rect width="900" height="650" fill="#f3f4f6"/>
    <rect x="70" y="46" width="760" height="560" rx="18" fill="#ffffff" filter="url(#shadow)"/>
    <rect x="70" y="46" width="760" height="9" fill="#10b981"/>
    <circle cx="820" cy="30" r="95" fill="#ecfdf5" opacity="0.8"/>

    <text x="770" y="118" text-anchor="end" font-size="38" font-weight="800" fill="#1f2937">${esc(label)}</text>
    <text x="770" y="154" text-anchor="end" font-size="21" font-weight="800" fill="#059669">${esc(context.storeName)}</text>
    <rect x="92" y="88" width="190" height="84" rx="12" fill="#ecfdf5" stroke="#d1fae5"/>
    <text x="187" y="116" text-anchor="middle" font-size="14" fill="#6b7280">المبلغ (${esc(context.currency)})</text>
    <text x="187" y="154" text-anchor="middle" font-size="30" font-weight="800" fill="#047857">${money(voucher.amount)}</text>
    <line x1="90" y1="200" x2="770" y2="200" stroke="#e5e7eb" stroke-width="2"/>

    <text x="770" y="256" text-anchor="end" class="key">رقم السند:</text>
    <text x="575" y="256" text-anchor="end" class="value">${esc(voucher.voucherNumber)}</text>
    <text x="380" y="256" text-anchor="end" class="key">التاريخ:</text>
    <text x="145" y="256" text-anchor="start" class="value">${formatDateTime(voucher.date)}</text>
    <line x1="90" y1="274" x2="770" y2="274" class="dash"/>

    <text x="770" y="326" text-anchor="end" class="key">${esc(partyLabel(voucher.type))}</text>
    <text x="420" y="326" text-anchor="end" class="value">${esc(shortText(partyName, 55))}</text>
    <line x1="90" y1="344" x2="770" y2="344" class="dash"/>
    ${previousRow}
    ${notesRow}

    <text x="770" y="560" text-anchor="end" class="key">طريقة الدفع:</text>
    <circle cx="570" cy="552" r="9" fill="#10b981" stroke="#059669" stroke-width="3"/>
    <text x="545" y="560" text-anchor="end" font-size="22" fill="#111827">نقدا</text>
    <circle cx="390" cy="552" r="9" fill="#ffffff" stroke="#9ca3af" stroke-width="3"/>
    <text x="365" y="560" text-anchor="end" font-size="22" fill="#111827">حوالة</text>
    <circle cx="235" cy="552" r="9" fill="#ffffff" stroke="#9ca3af" stroke-width="3"/>
    <text x="210" y="560" text-anchor="end" font-size="22" fill="#111827">شيك</text>
    <text x="450" y="590" text-anchor="middle" font-size="13" fill="#9ca3af">أنشأه: ${esc(createdBy)} | ${formatDateTime(voucher.createdAt ?? voucher.date)}</text>
  </svg>`;
  return sharp(Buffer.from(svg, "utf8")).png().toBuffer();
}
