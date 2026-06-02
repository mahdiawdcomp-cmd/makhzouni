import PDFDocument from "pdfkit";
import sharp from "sharp";
import { getSettings } from "./settings.service";
import { getVoucherById } from "./voucher.service";

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US").format(Number(value ?? 0));
}

function escapeXml(value: unknown) {
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

function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString("en-CA").replaceAll("-", "/");
}

function previousBalance(voucher: any) {
  if (!voucher.customer) return null;
  const current = Number(voucher.customer.currentBalance ?? 0);
  const amount = Number(voucher.amount ?? 0);
  if (voucher.type === "RECEIPT") return current + amount;
  if (voucher.type === "PAYMENT") return current - amount;
  return null;
}

async function renderVoucherPng(voucher: any) {
  const settings = await getSettings();
  const currency = settings.currency || "د.ع";
  const storeName = settings.storeName || "Inventory Store";
  const label = typeLabel(voucher.type);
  const partyName = voucher.customer?.name ?? voucher.description ?? "-";
  const prevBalance = previousBalance(voucher);
  const currentBalance = voucher.customer ? Number(voucher.customer.currentBalance ?? 0) : null;
  const isReceipt = voucher.type === "RECEIPT";

  const svg = `
<svg width="1200" height="760" viewBox="0 0 1200 760" xmlns="http://www.w3.org/2000/svg" direction="rtl">
  <defs>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="14" flood-color="#111827" flood-opacity="0.12"/>
    </filter>
  </defs>

  <rect width="1200" height="760" fill="#f3f4f6"/>
  <rect x="120" y="54" width="960" height="652" rx="22" fill="#ffffff" filter="url(#shadow)"/>
  <rect x="120" y="54" width="960" height="12" fill="#10b981"/>
  <circle cx="1060" cy="34" r="110" fill="#ecfdf5" opacity="0.75"/>

  <text x="1010" y="132" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="44" font-weight="800" fill="#1f2937">${escapeXml(label)}</text>
  <text x="1010" y="172" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="25" font-weight="700" fill="#059669">${escapeXml(storeName)}</text>

  <rect x="148" y="96" width="230" height="96" rx="14" fill="#ecfdf5" stroke="#d1fae5"/>
  <text x="263" y="126" text-anchor="middle" font-family="Tahoma, Arial, sans-serif" font-size="16" fill="#6b7280">المبلغ (${escapeXml(currency)})</text>
  <text x="263" y="170" text-anchor="middle" font-family="Tahoma, Arial, sans-serif" font-size="34" font-weight="800" fill="#047857">${money(voucher.amount)}</text>

  <line x1="160" y1="218" x2="1040" y2="218" stroke="#e5e7eb" stroke-width="2"/>

  <text x="1010" y="278" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="25" font-weight="700" fill="#4b5563">رقم السند:</text>
  <text x="805" y="278" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="25" font-weight="700" fill="#111827">${escapeXml(voucher.voucherNumber)}</text>
  <line x1="650" y1="292" x2="1015" y2="292" stroke="#9ca3af" stroke-width="2" stroke-dasharray="8 7"/>

  <text x="560" y="278" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="25" font-weight="700" fill="#4b5563">التاريخ:</text>
  <text x="365" y="278" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="25" font-weight="700" fill="#111827">${formatDate(voucher.date)}</text>
  <line x1="160" y1="292" x2="565" y2="292" stroke="#9ca3af" stroke-width="2" stroke-dasharray="8 7"/>

  <text x="1010" y="354" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="26" font-weight="700" fill="#4b5563">${escapeXml(partyLabel(voucher.type))}</text>
  <text x="575" y="354" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="28" font-weight="800" fill="#111827">${escapeXml(shortText(partyName, 72))}</text>
  <line x1="160" y1="370" x2="1015" y2="370" stroke="#9ca3af" stroke-width="2" stroke-dasharray="8 7"/>

  ${
    prevBalance !== null
      ? `
  <text x="1010" y="430" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="25" font-weight="700" fill="#4b5563">الحساب السابق (قبل السند):</text>
  <text x="575" y="430" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="27" font-weight="800" fill="#111827">${money(prevBalance)} ${escapeXml(currency)}</text>
  <line x1="160" y1="446" x2="1015" y2="446" stroke="#9ca3af" stroke-width="2" stroke-dasharray="8 7"/>

  <text x="1010" y="506" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="25" font-weight="700" fill="#4b5563">الحساب النهائي (بعد السند):</text>
  <text x="575" y="506" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="27" font-weight="800" fill="#059669">${money(currentBalance)} ${escapeXml(currency)}</text>
  <line x1="160" y1="522" x2="1015" y2="522" stroke="#9ca3af" stroke-width="2" stroke-dasharray="8 7"/>
`
      : voucher.notes
        ? `
  <text x="1010" y="430" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="25" font-weight="700" fill="#4b5563">الملاحظات:</text>
  <text x="575" y="430" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="25" font-weight="700" fill="#111827">${escapeXml(shortText(voucher.notes, 86))}</text>
  <line x1="160" y1="446" x2="1015" y2="446" stroke="#9ca3af" stroke-width="2" stroke-dasharray="8 7"/>
`
        : ""
  }

  ${
    voucher.notes && prevBalance !== null
      ? `
  <text x="1010" y="580" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="22" font-weight="700" fill="#4b5563">الملاحظات:</text>
  <text x="780" y="580" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="22" fill="#111827">${escapeXml(shortText(voucher.notes, 72))}</text>
`
      : ""
  }

  <text x="1010" y="628" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="24" font-weight="700" fill="#4b5563">طريقة الدفع:</text>
  <circle cx="780" cy="620" r="10" fill="${isReceipt || voucher.type === "PAYMENT" ? "#10b981" : "#ffffff"}" stroke="#059669" stroke-width="3"/>
  <text x="750" y="628" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="23" fill="#111827">نقداً</text>
  <circle cx="590" cy="620" r="10" fill="#ffffff" stroke="#9ca3af" stroke-width="3"/>
  <text x="560" y="628" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="23" fill="#111827">حوالة بنكية</text>
  <circle cx="330" cy="620" r="10" fill="#ffffff" stroke="#9ca3af" stroke-width="3"/>
  <text x="300" y="628" text-anchor="end" font-family="Tahoma, Arial, sans-serif" font-size="23" fill="#111827">شيك</text>
  <line x1="160" y1="656" x2="1015" y2="656" stroke="#9ca3af" stroke-width="2" stroke-dasharray="8 7"/>

  <text x="600" y="686" text-anchor="middle" font-family="Tahoma, Arial, sans-serif" font-size="15" fill="#9ca3af">Generated by Inventory System</text>
</svg>`;

  return sharp(Buffer.from(svg, "utf8")).png().toBuffer();
}

export async function generateVoucherPdf(voucherId: string) {
  const voucher = await getVoucherById(voucherId);
  const png = await renderVoucherPng(voucher);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 24 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.image(png, 24, 24, {
      fit: [doc.page.width - 48, doc.page.height - 48],
      align: "center",
      valign: "center",
    });

    doc.end();
  });
}

export async function generateVoucherPng(voucherId: string) {
  const voucher = await getVoucherById(voucherId);
  return renderVoucherPng(voucher);
}
