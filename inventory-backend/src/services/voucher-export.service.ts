import sharp from "sharp";
import { getCustomerTransactions } from "./customer.service";
import { getSettings } from "./settings.service";
import { getVoucherById } from "./voucher.service";
import { pngToPdf } from "../utils/png-to-pdf";

export function money(value: number | null | undefined) {
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

// The three lines of the "account story" — worded per voucher type so the
// customer reads it like a sentence, not an accounting table.
function storyLabels(type: string) {
  if (type === "PAYMENT") {
    return { before: "الحساب قبل السند", amount: "دفعنا لكم", after: "الحساب بعد السند" };
  }
  return { before: "كان بذمتكم قبل السند", amount: "استلمنا منكم", after: "الباقي بذمتكم بعد السند" };
}

function partyLabel(type: string) {
  if (type === "PAYMENT") return "دفعنا إلى السيد / السادة";
  if (type === "EXPENSE") return "وصف المصروف";
  return "استلمنا من السيد / السادة";
}

// "عليه / له / صفر" wording for a balance figure (positive = customer owes us).
function balanceWord(value: number) {
  if (value > 0) return "عليه";
  if (value < 0) return "له";
  return "";
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
  const createdBy = voucher.creator?.name ?? voucher.creator?.username ?? "-";
  const story = storyLabels(voucher.type);
  const cur = esc(options.currency);
  const settled = options.final !== null && Math.abs(options.final) < 0.01;

  // The story block: three big stacked lines the customer can read top-down.
  const storyBlock = options.previous !== null ? `
      <section class="story">
        <div class="step">
          <div class="step-label">${esc(story.before)}</div>
          <div class="step-value muted-num">${money(Math.abs(options.previous))} ${cur} ${esc(balanceWord(options.previous))}</div>
        </div>
        <div class="step amount-step">
          <div class="step-label">${esc(story.amount)}</div>
          <div class="step-value">${money(voucher.amount)} ${cur}</div>
        </div>
        <div class="step after-step ${settled ? "settled" : ""}">
          <div class="step-label">${esc(story.after)}</div>
          <div class="step-value">${settled
            ? `صفر — تمت تسوية الحساب بالكامل ✓`
            : `${money(Math.abs(options.final ?? 0))} ${cur} ${esc(balanceWord(options.final ?? 0))}`}</div>
        </div>
      </section>` : `
      <section class="story">
        <div class="step amount-step">
          <div class="step-label">${esc(voucher.type === "EXPENSE" ? "مبلغ المصروف" : story.amount)}</div>
          <div class="step-value">${money(voucher.amount)} ${cur}</div>
        </div>
      </section>`;

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
      max-width: 680px;
      margin: 0 auto;
      overflow: hidden;
      border-radius: 16px;
      background: #fff;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
    }
    .head {
      background: linear-gradient(135deg, #059669, #10b981);
      color: #fff;
      padding: 22px 28px;
      text-align: center;
    }
    .head .store { font-size: 22px; font-weight: 800; }
    .head .store-meta { margin-top: 2px; font-size: 13px; opacity: 0.9; }
    .head .doc {
      margin-top: 12px;
      display: inline-block;
      background: rgba(255,255,255,0.16);
      border-radius: 999px;
      padding: 6px 22px;
      font-size: 20px;
      font-weight: 800;
    }
    .head .doc-meta { margin-top: 8px; font-size: 14px; font-weight: 600; opacity: 0.95; }
    .party {
      padding: 18px 28px 6px;
      text-align: center;
    }
    .party .plabel { color: #6b7280; font-size: 14px; font-weight: 700; }
    .party .pname { margin-top: 2px; font-size: 24px; font-weight: 800; color: #111827; }
    .story { padding: 14px 28px 6px; }
    .step {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      background: #f9fafb;
      padding: 14px 18px;
      margin-bottom: 10px;
    }
    .step-label { color: #4b5563; font-size: 17px; font-weight: 800; }
    .step-value { font-size: 24px; font-weight: 800; color: #111827; white-space: nowrap; }
    .muted-num { color: #6b7280; }
    .amount-step { background: #ecfdf5; border-color: #a7f3d0; }
    .amount-step .step-label { color: #047857; }
    .amount-step .step-value { color: #047857; font-size: 28px; }
    .after-step { background: #fff7ed; border-color: #fed7aa; }
    .after-step .step-label { color: #9a3412; }
    .after-step .step-value { color: #9a3412; }
    .after-step.settled { background: #ecfdf5; border-color: #6ee7b7; }
    .after-step.settled .step-label, .after-step.settled .step-value { color: #047857; }
    .notes {
      margin: 4px 28px 0;
      border-radius: 10px;
      background: #f9fafb;
      border: 1px dashed #d1d5db;
      color: #4b5563;
      font-size: 14px;
      font-weight: 600;
      padding: 10px 14px;
    }
    .foot {
      margin-top: 16px;
      border-top: 1px solid #e5e7eb;
      color: #9ca3af;
      font-size: 12.5px;
      text-align: center;
      padding: 12px 20px 18px;
    }
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
    <section class="head">
      <div class="store">${esc(options.storeName)}</div>
      ${options.storePhone || options.storeAddress ? `<div class="store-meta">${esc([options.storeAddress, options.storePhone].filter(Boolean).join(" — "))}</div>` : ""}
      <div class="doc">${esc(label)} ${esc(voucher.voucherNumber)}</div>
      <div class="doc-meta">${formatDateTime(voucher.date)}</div>
    </section>
    <section class="party">
      <div class="plabel">${esc(partyLabel(voucher.type))}</div>
      <div class="pname">${esc(shortText(partyName, 60))}</div>
    </section>
    ${storyBlock}
    ${voucher.cancelledAt ? `<div class="notes" style="color:#e11d48;border-color:#fecaca;background:#fef2f2;text-align:center;font-weight:800;">⚠ هذا السند معطل — لا يؤثر على الحساب</div>` : ""}
    ${voucher.notes ? `<div class="notes">ملاحظات: ${esc(shortText(voucher.notes, 140))}</div>` : ""}
    <div class="foot">أنشأه: ${esc(createdBy)} — وقت الإدخال: ${formatDateTime(voucher.createdAt ?? voucher.date)}<br/>شكراً لتعاملكم معنا</div>
  </main>
</body>
</html>`;
}

export async function voucherContext(voucherId: string) {
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

export async function generateVoucherHtml(voucherId: string) {
  const context = await voucherContext(voucherId);
  const html = buildVoucherHtml(context.voucher, { ...context, includePrintButton: true });
  return Buffer.from(html, "utf8");
}

/** Return the voucher as a REAL PDF (image-backed, single page) */
export async function generateVoucherPdf(voucherId: string) {
  const png = await generateVoucherPng(voucherId);
  return pngToPdf(png);
}

export async function generateVoucherPng(voucherId: string) {
  const context = await voucherContext(voucherId);
  const voucher = context.voucher;
  const label = typeLabel(voucher.type);
  const partyName = voucher.customer?.name ?? voucher.description ?? "-";
  const createdBy = voucher.creator?.name ?? voucher.creator?.username ?? "-";
  const story = storyLabels(voucher.type);
  const cur = esc(context.currency);
  const hasStory = context.previous !== null;
  const settled = context.final !== null && Math.abs(context.final) < 0.01;

  // Vertical "account story" layout: one centered column, three stacked bands.
  // Every band is a full-width box — nothing overlaps, nothing side-by-side.
  const W = 760;
  const boxX = 60;
  const boxW = W - boxX * 2;
  let y = 300; // first band start (below header + party)

  // Two centered lines per band (label above, value below): centered anchors
  // render identically regardless of how the SVG engine resolves RTL/bidi, so
  // nothing can overflow the box edges.
  function band(labelText: string, valueText: string, colors: { bg: string; border: string; label: string; value: string }, big = false) {
    const h = big ? 118 : 104;
    const block = `
      <rect x="${boxX}" y="${y}" width="${boxW}" height="${h}" rx="14" fill="${colors.bg}" stroke="${colors.border}" stroke-width="2"/>
      <text x="${W / 2}" y="${y + 38}" text-anchor="middle" font-size="22" font-weight="700" fill="${colors.label}">${labelText}</text>
      <text x="${W / 2}" y="${y + h - 26}" text-anchor="middle" font-size="${big ? 36 : 30}" font-weight="800" fill="${colors.value}">${valueText}</text>`;
    y += h + 14;
    return block;
  }

  const gray = { bg: "#f9fafb", border: "#e5e7eb", label: "#4b5563", value: "#6b7280" };
  const green = { bg: "#ecfdf5", border: "#a7f3d0", label: "#047857", value: "#047857" };
  const orange = { bg: "#fff7ed", border: "#fed7aa", label: "#9a3412", value: "#9a3412" };

  let bands = "";
  if (hasStory) {
    const prev = context.previous ?? 0;
    const fin = context.final ?? 0;
    bands += band(esc(story.before), `${money(Math.abs(prev))} ${cur} ${esc(balanceWord(prev))}`, gray);
    bands += band(esc(story.amount), `${money(voucher.amount)} ${cur}`, green, true);
    bands += settled
      ? band(esc(story.after), "صفر — تمت التسوية ✓", green, true)
      : band(esc(story.after), `${money(Math.abs(fin))} ${cur} ${esc(balanceWord(fin))}`, orange, true);
  } else {
    bands += band(esc(voucher.type === "EXPENSE" ? "مبلغ المصروف" : story.amount), `${money(voucher.amount)} ${cur}`, green, true);
  }
  if (voucher.cancelledAt) {
    bands += `<text x="${W / 2}" y="${y + 12}" text-anchor="middle" font-size="20" font-weight="800" fill="#e11d48">⚠ هذا السند معطل — لا يؤثر على الحساب</text>`;
    y += 40;
  }

  const notesBlock = voucher.notes
    ? `<text x="${W / 2}" y="${y + 16}" text-anchor="middle" font-size="18" fill="#6b7280">ملاحظات: ${esc(shortText(voucher.notes, 70))}</text>`
    : "";
  const footY = y + (voucher.notes ? 52 : 24);
  const H = footY + 60;

  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" direction="rtl">
    <defs>
      <style>
        text { font-family: Tahoma, Arial, sans-serif; }
      </style>
      <linearGradient id="head" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#059669"/>
        <stop offset="1" stop-color="#10b981"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="#ffffff"/>
    <rect x="0" y="0" width="${W}" height="150" fill="url(#head)"/>
    <text x="${W / 2}" y="46" text-anchor="middle" font-size="28" font-weight="800" fill="#ffffff">${esc(context.storeName)}</text>
    <text x="${W / 2}" y="98" text-anchor="middle" font-size="30" font-weight="800" fill="#ffffff">${esc(label)} ${esc(voucher.voucherNumber)}</text>
    <text x="${W / 2}" y="132" text-anchor="middle" font-size="19" fill="#d1fae5">${formatDateTime(voucher.date)}</text>

    <text x="${W / 2}" y="196" text-anchor="middle" font-size="19" font-weight="700" fill="#6b7280">${esc(partyLabel(voucher.type))}</text>
    <text x="${W / 2}" y="240" text-anchor="middle" font-size="32" font-weight="800" fill="#111827">${esc(shortText(partyName, 40))}</text>
    <line x1="${boxX}" y1="268" x2="${W - boxX}" y2="268" stroke="#e5e7eb" stroke-width="2"/>

    ${bands}
    ${notesBlock}
    <text x="${W / 2}" y="${footY + 18}" text-anchor="middle" font-size="15" fill="#9ca3af">أنشأه: ${esc(createdBy)} — ${formatDateTime(voucher.createdAt ?? voucher.date)}</text>
    <text x="${W / 2}" y="${footY + 42}" text-anchor="middle" font-size="16" fill="#6b7280">شكراً لتعاملكم معنا 🌟</text>
  </svg>`;
  return sharp(Buffer.from(svg, "utf8")).png().toBuffer();
}
