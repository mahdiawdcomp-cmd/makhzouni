import sharp from "sharp";
import { getCustomerTransactions } from "./customer.service";
import { getCustomerById } from "./customer.service";
import { getSettings } from "./settings.service";
import { pngToPdf } from "../utils/png-to-pdf";

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

function shortDate(date: unknown) {
  const d = new Date(String(date));
  if (Number.isNaN(d.getTime())) return String(date).slice(0, 10);
  return d.toLocaleDateString("en-GB"); // dd/mm/yyyy
}

type Row = Awaited<ReturnType<typeof getCustomerTransactions>>["transactions"][number];

// Arabic label for a statement row — mirrors translateRow() on the web client.
function rowLabel(row: Row): string {
  if (row.status === "CANCELLED") return "ملغاة";
  const t = String(row.type ?? "").toUpperCase();
  if (t === "RECEIPT") return "سند قبض";
  if (t === "PAYMENT") return "سند دفع";
  if (t === "EXPENSE") return "مصاريف";
  if (t === "INVOICE" || t.includes("INVOICE")) {
    if (row.invoiceType === "SALE") return "فاتورة بيع";
    if (row.invoiceType === "PURCHASE") return "فاتورة شراء";
    if (row.invoiceType === "SALES_RETURN") return "مرتجع مبيعات";
    return "فاتورة";
  }
  return String(row.type ?? "");
}

// Merge INVOICE + INVOICE_PAYMENT rows for the same invoice into one — same
// rule as mergeStatementRows() on the web so the PDF matches the on-screen table.
function mergeRows(rows: Row[]): Row[] {
  const payments = new Map<string, Row>();
  for (const row of rows) {
    if (row.type === "INVOICE_PAYMENT") payments.set(row.id, row);
  }
  return rows
    .filter((row) => row.type !== "INVOICE_PAYMENT")
    .map((row) => {
      if (row.type !== "INVOICE") return row;
      const payment = payments.get(row.id);
      if (!payment || !Number(payment.credit)) return row;
      return { ...row, credit: payment.credit, runningBalance: payment.runningBalance };
    });
}

/**
 * Customer account statement as a real PDF (SVG → PNG → single-page PDF, same
 * pipeline as the invoice/voucher exports so Arabic shaping is correct — pdfkit
 * can't shape Arabic on its own). `upToDate` (YYYY-MM-DD) caps the movements to
 * everything on or before that day; omit for the full history.
 */
export async function generateCustomerStatementPdf(customerId: string, upToDate?: string): Promise<Buffer> {
  const png = await generateCustomerStatementPng(customerId, upToDate);
  return pngToPdf(png);
}

export async function generateCustomerStatementPng(customerId: string, upToDate?: string): Promise<Buffer> {
  const [customer, statement, settings] = await Promise.all([
    getCustomerById(customerId),
    getCustomerTransactions(customerId, upToDate ? { to: upToDate } : { all: true }),
    getSettings().catch(() => null),
  ]);

  const storeName = settings?.storeName ?? "مخزوني";
  const currency = settings?.currency ?? "د.ع";
  const accent = "#1D4ED8";

  const rows = mergeRows(statement.transactions);
  const finalBalance = rows.length ? Number(rows[rows.length - 1].runningBalance) : Number(customer.currentBalance ?? 0);

  const rowH = 40;
  const tableTop = 220;
  const headerRowY = tableTop;
  const firstRowY = tableTop + rowH;
  const bodyH = firstRowY + rows.length * rowH + 150;

  // Column x-anchors (image is LTR; Arabic cells are right-anchored to read RTL).
  const COL = {
    date: 70,        // left
    label: 250,
    ref: 470,
    debit: 620,
    credit: 730,
    balance: 850,    // right edge
  };

  const headerCell = (x: number, text: string, anchor: "start" | "end" = "end") =>
    `<text x="${x}" y="${headerRowY + 26}" font-size="13" font-weight="800" fill="#374151" text-anchor="${anchor}">${esc(text)}</text>`;

  const rowsSvg = rows
    .map((row, i) => {
      const y = firstRowY + i * rowH;
      const cancelled = row.status === "CANCELLED";
      const debit = Number(row.debit ?? 0);
      const credit = Number(row.credit ?? 0);
      const running = Number(row.runningBalance ?? 0);
      const zebra = i % 2 === 0 ? "#F9FAFB" : "#FFFFFF";
      const textFill = cancelled ? "#9CA3AF" : "#111827";
      return `
    <rect x="40" y="${y}" width="820" height="${rowH}" fill="${zebra}"/>
    <text x="${COL.date}" y="${y + 25}" font-size="12" fill="${textFill}" text-anchor="start">${esc(shortDate(row.date))}</text>
    <text x="${COL.label}" y="${y + 25}" font-size="12" fill="${textFill}" text-anchor="end" ${cancelled ? 'text-decoration="line-through"' : ""}>${esc(rowLabel(row))}</text>
    <text x="${COL.ref}" y="${y + 25}" font-size="11" fill="#6B7280" text-anchor="end">${esc(row.referenceNumber)}</text>
    <text x="${COL.debit}" y="${y + 25}" font-size="12" fill="#B91C1C" text-anchor="end">${debit > 0 ? money(debit) : "—"}</text>
    <text x="${COL.credit}" y="${y + 25}" font-size="12" fill="#047857" text-anchor="end">${credit > 0 ? money(credit) : "—"}</text>
    <text x="${COL.balance}" y="${y + 25}" font-size="12" fill="${textFill}" font-weight="700" text-anchor="end">${money(running)}</text>`;
    })
    .join("");

  const rangeLabel = upToDate ? `حتى ${esc(shortDate(upToDate))}` : "كل الحركات";
  const finalY = firstRowY + rows.length * rowH + 30;

  const svg = `<svg width="900" height="${bodyH}" xmlns="http://www.w3.org/2000/svg">
    <defs><style>text { font-family: Arial, sans-serif; }</style></defs>
    <rect width="900" height="${bodyH}" fill="#F3F4F6"/>
    <rect x="24" y="24" width="852" height="${bodyH - 48}" rx="14" fill="#FFFFFF" stroke="#E5E7EB"/>
    <rect x="24" y="24" width="852" height="7" rx="14" fill="${accent}"/>

    <text x="850" y="80" font-size="22" font-weight="800" fill="${accent}" text-anchor="end">${esc(storeName)}</text>
    <text x="70" y="80" font-size="14" fill="#6B7280" text-anchor="start">كشف حساب</text>

    <text x="850" y="120" font-size="16" font-weight="700" fill="#111827" text-anchor="end">${esc(customer.name)}</text>
    <text x="70" y="120" font-size="12" fill="#9CA3AF" text-anchor="start">${esc(rangeLabel)}</text>
    <text x="850" y="150" font-size="12" fill="#6B7280" text-anchor="end">${esc(customer.phone ?? "")}</text>

    <line x1="40" y1="180" x2="860" y2="180" stroke="#E5E7EB"/>

    <rect x="40" y="${headerRowY}" width="820" height="${rowH}" fill="#EEF2FF"/>
    ${headerCell(COL.date, "التاريخ", "start")}
    ${headerCell(COL.label, "النوع")}
    ${headerCell(COL.ref, "الرقم")}
    ${headerCell(COL.debit, "مدين")}
    ${headerCell(COL.credit, "دائن")}
    ${headerCell(COL.balance, "الرصيد")}

    ${rowsSvg}

    <rect x="480" y="${finalY}" width="380" height="52" rx="10" fill="${accent}"/>
    <text x="850" y="${finalY + 33}" font-size="18" fill="#FFFFFF" font-weight="800" text-anchor="end">${money(finalBalance)} ${esc(currency)}</text>
    <text x="500" y="${finalY + 33}" font-size="13" fill="#FFFFFF" text-anchor="start">الرصيد النهائي</text>

    <text x="450" y="${bodyH - 20}" font-size="11" fill="#9CA3AF" text-anchor="middle">شكراً لتعاملكم — ${esc(storeName)}</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
