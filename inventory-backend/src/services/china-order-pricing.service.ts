import { read, utils, write } from "xlsx";
import {
  LandedCostBatchStatus,
  LandedCostItemAction,
  LandedCostMatchStatus,
  Prisma,
} from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { roundMoney } from "../utils/financial";

type Db = Prisma.TransactionClient | typeof prisma;

// ── Fixed "China Order Pricing" template ────────────────────────────────────
//
// Excel columns are FIXED (by header name, Arabic or English accepted):
//   1. itemNumber   2. image   3. cartonCount   4. piecesPerCarton
//   5. unitPriceCny 6. cartonCbm
//
// Screen inputs (per batch, not per row):
//   cbmPriceUsd   — سعر المتر المكعب بالدولار (شحن + كمرك + نقل)
//   officePercent — نسبة المكتب (على قيمة البضاعة فقط)
//   cnyPerUsd     — كم يوان يساوي 1 دولار
//   usdToIqd      — سعر صرف الدولار للدينار (محلي لهذا التسعير فقط)
//
// Per-carton formula:
//   X = unitPriceCny × piecesPerCarton      قيمة الكارتون باليوان
//   Y = X ÷ cnyPerUsd                       قيمة الكارتون بالدولار قبل المكتب
//   Z = Y + (Y × officePercent ÷ 100)       بعد نسبة المكتب (على البضاعة فقط)
//   V = cartonCbm × cbmPriceUsd             شحن/كمرك/نقل الكارتون بالدولار
//   A = Z + V                               الكلفة النهائية للكارتون بالدولار
//   N = A ÷ piecesPerCarton                 كلفة القطعة بالدولار
//   H = N × usdToIqd                        كلفة القطعة بالدينار

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function cleanNum(v: unknown): number {
  const n = Number(String(v ?? "0").replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

export interface ChinaOrderRow {
  itemNumber: string;
  image: string; // optional URL / data-URL text in the image column
  cartonCount: number;
  piecesPerCarton: number;
  unitPriceCny: number;
  cartonCbm: number;
}

// Column aliases used only to auto-detect a header row. The template is
// positional (fixed order), so header names are OPTIONAL — any real-world
// sheet whose columns follow the fixed order works even with custom labels
// or a decorative title row above the table.
const HEADER_ALIASES: Record<keyof ChinaOrderRow, string[]> = {
  itemNumber: ["itemnumber", "item_number", "رقم المادة", "كود الصنف", "كود", "رقم"],
  image: ["image", "الصورة", "صورة"],
  cartonCount: ["cartoncount", "carton_count", "cartons", "عدد الكراتين", "الكراتين", "كراتين"],
  piecesPerCarton: ["piecespercarton", "pieces_per_carton", "قطع بالكارتون", "عدد القطع بالكارتون", "قطع الكارتون"],
  unitPriceCny: ["unitpricecny", "unit_price_cny", "سعر القطعة يوان", "سعر المفرد يوان", "سعر القطعة", "سعر يوان"],
  cartonCbm: ["cartoncbm", "carton_cbm", "cbm", "حجم الكارتون", "الحجم"],
};

export function parseChinaOrderExcel(buffer: Buffer): ChinaOrderRow[] {
  // SheetJS throws raw Errors on a corrupt, password-protected, or
  // not-really-Excel file. Unwrapped, those surfaced to the user as a bare
  // "Internal server error" with nothing to act on.
  let wb: ReturnType<typeof read>;
  try {
    wb = read(buffer, { type: "buffer" });
  } catch (err) {
    throw new AppError(
      `تعذّر فتح ملف Excel — قد يكون تالفاً أو محمياً بكلمة سر أو ليس بصيغة xlsx حقيقية (${err instanceof Error ? err.message : "سبب غير معروف"})`,
      400,
      "UNREADABLE_FILE"
    );
  }
  if (!wb.SheetNames?.length) throw new AppError("الملف لا يحتوي على أي ورقة عمل", 400, "NO_SHEETS");

  // First sheet that actually contains rows.
  let grid: unknown[][] = [];
  try {
    for (const name of wb.SheetNames) {
      const aoa = utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: "" });
      // SheetJS leaves HOLES for blank rows, so `r` can be undefined —
      // calling .some() on it threw a TypeError that surfaced as a 500.
      if (aoa.some((r) => Array.isArray(r) && r.some((c) => clean(c) !== ""))) { grid = aoa; break; }
    }
  } catch (err) {
    throw new AppError(
      `تعذّر قراءة صفوف الملف (${err instanceof Error ? err.message : "سبب غير معروف"}) — جرّب: افتح الملف بـ Excel، احذف الصور المدمجة، ثم «حفظ باسم» بصيغة xlsx`,
      400,
      "UNREADABLE_ROWS"
    );
  }
  if (grid.length === 0) throw new AppError("الملف فارغ", 400, "EMPTY_FILE");

  // Fixed positional order by default; a recognized header row (searched in
  // the first 10 rows, so title rows above the table are fine) can remap it.
  let cols: Record<keyof ChinaOrderRow, number> = { itemNumber: 0, image: 1, cartonCount: 2, piecesPerCarton: 3, unitPriceCny: 4, cartonCbm: 5 };
  let dataStart = 0;
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const cells = (grid[i] ?? []).map((c) => clean(c).toLowerCase());
    const found: Partial<Record<keyof ChinaOrderRow, number>> = {};
    cells.forEach((cell, idx) => {
      for (const key of Object.keys(HEADER_ALIASES) as (keyof ChinaOrderRow)[]) {
        if (found[key] === undefined && HEADER_ALIASES[key].includes(cell)) found[key] = idx;
      }
    });
    if (found.cartonCount !== undefined && found.piecesPerCarton !== undefined && found.unitPriceCny !== undefined) {
      cols = { ...cols, ...found };
      dataStart = i + 1;
      break;
    }
  }

  const rows: ChinaOrderRow[] = [];
  for (let i = dataStart; i < grid.length; i++) {
    const r = grid[i];
    if (!Array.isArray(r)) continue; // blank row hole — not a data row
    const row: ChinaOrderRow = {
      itemNumber: clean(r[cols.itemNumber]),
      image: clean(r[cols.image]),
      cartonCount: Math.max(0, Math.floor(cleanNum(r[cols.cartonCount]))),
      piecesPerCarton: Math.max(0, Math.floor(cleanNum(r[cols.piecesPerCarton]))),
      unitPriceCny: cleanNum(r[cols.unitPriceCny]),
      cartonCbm: cleanNum(r[cols.cartonCbm]),
    };
    // Skip non-data rows (titles, header text, totals, trailing blanks): a
    // real order line always carries at least one of the three key numbers.
    if (row.cartonCount <= 0 && row.piecesPerCarton <= 0 && row.unitPriceCny <= 0) continue;
    rows.push(row);
  }

  if (rows.length === 0) {
    throw new AppError(
      "لم أتعرف على بيانات الملف. تأكد أن الأعمدة بالترتيب الثابت: رقم المادة، الصورة، عدد الكراتين، قطع الكارتون، سعر القطعة يوان، حجم الكارتون (CBM)",
      400,
      "NO_VALID_ROWS"
    );
  }
  if (rows.length > 2000) throw new AppError("الملف يحتوي على أكثر من 2000 صف", 400, "TOO_MANY_ROWS");
  return rows;
}

export function buildChinaOrderTemplate(): Buffer {
  const ws = utils.aoa_to_sheet([
    ["itemNumber", "image", "cartonCount", "piecesPerCarton", "unitPriceCny", "cartonCbm"],
    ["P00001", "", "10", "72", "3.5", "0.20"],
  ]);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "تسعيرة الصين");
  return write(wb, { type: "buffer", bookType: "xlsx" });
}

// ── Pricing math ─────────────────────────────────────────────────────────────

export interface ChinaPricingParams {
  cbmPriceUsd: number;
  officePercent: number;
  cnyPerUsd: number;
  usdToIqd: number;
}

export interface ChinaPricedItem {
  itemNumber: string;
  image: string;
  cartonCount: number;
  piecesPerCarton: number;
  totalPieces: number;
  unitPriceCny: number;
  cartonCbm: number;
  cartonCny: number;        // X
  cartonUsdBeforeOffice: number; // Y
  cartonUsdAfterOffice: number;  // Z
  cartonShippingUsd: number;     // V
  cartonCostUsd: number;         // A
  unitCostUsd: number;           // N
  unitCostIqd: number;           // H
  cartonCostIqd: number;         // A × usdToIqd
  suggestedSalePrice: number | null;
  matchStatus: LandedCostMatchStatus;
  productId: string | null;
  matchedProduct: { id: string; name: string; itemNumber: string; salePrice: number; purchasePrice: number; imageUrl: string | null; thumbnailUrl: string | null } | null;
}

export interface ChinaPricingResult {
  items: ChinaPricedItem[];
  totalCartons: number;
  totalPieces: number;
  totalOrderCostUsd: number;
  totalOrderCostIqd: number;
  ambiguousCount: number;
  notFoundCount: number;
}

function validateParams(p: ChinaPricingParams) {
  if (!(p.cnyPerUsd > 0)) throw new AppError("سعر صرف اليوان للدولار مطلوب وأكبر من صفر", 400, "CNY_RATE_REQUIRED");
  if (!(p.usdToIqd > 0)) throw new AppError("سعر صرف الدولار للدينار مطلوب وأكبر من صفر", 400, "IQD_RATE_REQUIRED");
  if (p.cbmPriceUsd < 0) throw new AppError("سعر المتر المكعب لا يمكن أن يكون سالباً", 400, "INVALID_CBM_PRICE");
  if (p.officePercent < 0) throw new AppError("نسبة المكتب لا يمكن أن تكون سالبة", 400, "INVALID_OFFICE_PERCENT");
}

/** Pure per-row formula — exported for direct unit-testing. */
export function priceChinaRow(row: Pick<ChinaOrderRow, "cartonCount" | "piecesPerCarton" | "unitPriceCny" | "cartonCbm">, p: ChinaPricingParams) {
  const X = row.unitPriceCny * row.piecesPerCarton;
  const Y = X / p.cnyPerUsd;
  const Z = Y + (Y * p.officePercent) / 100;
  const V = row.cartonCbm * p.cbmPriceUsd;
  const A = Z + V;
  const N = row.piecesPerCarton > 0 ? A / row.piecesPerCarton : 0;
  const H = N * p.usdToIqd;
  return { X, Y, Z, V, A, N, H };
}

export async function computeChinaPricing(
  rows: ChinaOrderRow[],
  params: ChinaPricingParams,
  db: Db = prisma,
): Promise<ChinaPricingResult> {
  validateParams(params);

  const bad = rows.find((r) => r.cartonCount <= 0 || r.piecesPerCarton <= 0 || r.unitPriceCny <= 0);
  if (bad) {
    throw new AppError(
      `الصف "${bad.itemNumber || "بدون كود"}": عدد الكراتين وقطع الكارتون وسعر القطعة باليوان يجب أن تكون أكبر من صفر`,
      400,
      "INVALID_ROW"
    );
  }

  // Duplicate item numbers WITHIN the file are ambiguous (DB itemNumber is unique).
  const codeCounts = new Map<string, number>();
  for (const r of rows) {
    if (!r.itemNumber) continue;
    codeCounts.set(r.itemNumber, (codeCounts.get(r.itemNumber) ?? 0) + 1);
  }

  const codes = [...new Set(rows.map((r) => r.itemNumber).filter(Boolean))];
  const products = codes.length
    ? await (db as typeof prisma).product.findMany({
        where: { itemNumber: { in: codes }, deletedAt: null },
        select: { id: true, name: true, itemNumber: true, salePrice: true, purchasePrice: true, imageUrl: true, thumbnailUrl: true },
      })
    : [];
  const productByCode = new Map(products.map((p) => [p.itemNumber, p]));

  let totalCartons = 0;
  let totalPieces = 0;
  let totalOrderCostUsd = 0;

  const items: ChinaPricedItem[] = rows.map((row) => {
    const { X, Y, Z, V, A, N, H } = priceChinaRow(row, params);
    const pieces = row.cartonCount * row.piecesPerCarton;
    totalCartons += row.cartonCount;
    totalPieces += pieces;
    totalOrderCostUsd += A * row.cartonCount;

    const isDuplicate = row.itemNumber ? (codeCounts.get(row.itemNumber) ?? 0) > 1 : false;
    const matched = row.itemNumber ? productByCode.get(row.itemNumber) ?? null : null;
    const matchStatus: LandedCostMatchStatus = isDuplicate
      ? LandedCostMatchStatus.AMBIGUOUS
      : matched
        ? LandedCostMatchStatus.MATCHED
        : LandedCostMatchStatus.NOT_FOUND;

    // Preserve the matched product's current margin ratio on top of the new IQD cost.
    let suggestedSalePrice: number | null = null;
    if (matched && Number(matched.purchasePrice) > 0) {
      suggestedSalePrice = roundMoney(H * (Number(matched.salePrice) / Number(matched.purchasePrice)));
    }

    return {
      itemNumber: row.itemNumber,
      image: row.image,
      cartonCount: row.cartonCount,
      piecesPerCarton: row.piecesPerCarton,
      totalPieces: pieces,
      unitPriceCny: row.unitPriceCny,
      cartonCbm: row.cartonCbm,
      cartonCny: roundMoney(X),
      cartonUsdBeforeOffice: roundMoney(Y),
      cartonUsdAfterOffice: roundMoney(Z),
      cartonShippingUsd: roundMoney(V),
      cartonCostUsd: roundMoney(A),
      unitCostUsd: roundMoney(N),
      unitCostIqd: roundMoney(H),
      cartonCostIqd: roundMoney(A * params.usdToIqd),
      suggestedSalePrice,
      matchStatus,
      productId: matchStatus === LandedCostMatchStatus.MATCHED ? matched!.id : null,
      matchedProduct: matched
        ? { id: matched.id, name: matched.name, itemNumber: matched.itemNumber, salePrice: Number(matched.salePrice), purchasePrice: Number(matched.purchasePrice), imageUrl: matched.imageUrl, thumbnailUrl: matched.thumbnailUrl }
        : null,
    };
  });

  return {
    items,
    totalCartons,
    totalPieces,
    totalOrderCostUsd: roundMoney(totalOrderCostUsd),
    totalOrderCostIqd: roundMoney(totalOrderCostUsd * params.usdToIqd),
    ambiguousCount: items.filter((i) => i.matchStatus === LandedCostMatchStatus.AMBIGUOUS).length,
    notFoundCount: items.filter((i) => i.matchStatus === LandedCostMatchStatus.NOT_FOUND).length,
  };
}

// ── Persist as a landed-cost batch (review/confirm flow is shared) ──────────

export interface CreateChinaBatchInput {
  invoiceNumber?: string;
  supplier?: string;
  note?: string;
  originalFileName?: string;
  params: ChinaPricingParams;
  items: ChinaPricedItem[];
}

export async function createChinaBatch(input: CreateChinaBatchInput, createdBy: string, db: Db = prisma) {
  validateParams(input.params);
  if (!input.items.length) throw new AppError("لا يوجد أصناف لحفظها", 400, "NO_ITEMS");

  return db.landedCostImportBatch.create({
    data: {
      invoiceNumber: input.invoiceNumber?.trim() || null,
      supplier: input.supplier?.trim() || null,
      note: input.note?.trim() || null,
      originalFileName: input.originalFileName ?? null,
      status: LandedCostBatchStatus.DRAFT_PRICED,
      createdBy,
      cbmPriceUsd: input.params.cbmPriceUsd,
      officePercent: input.params.officePercent,
      cnyPerUsd: input.params.cnyPerUsd,
      usdToIqd: input.params.usdToIqd,
      // The shared confirm flow reads quantity (pieces) + purchasePrice /
      // landedCostPerUnit (both in IQD here) — H flows straight into the
      // purchase invoice's unit price and the product cost overwrite.
      totalExtraCost: roundMoney(
        input.items.reduce((s, it) => s + (it.cartonCostUsd - it.cartonUsdBeforeOffice) * it.cartonCount, 0) * input.params.usdToIqd
      ),
      items: {
        create: input.items.map((it) => ({
          productId: it.productId,
          itemCode: it.itemNumber,
          productName: it.matchedProduct?.name || it.itemNumber || "صنف بدون كود",
          quantity: it.totalPieces,
          cartonCount: it.cartonCount,
          piecesPerCarton: it.piecesPerCarton,
          unitPriceCny: it.unitPriceCny,
          cartonCbm: it.cartonCbm,
          cartonCostUsd: it.cartonCostUsd,
          unitCostUsd: it.unitCostUsd,
          purchasePrice: it.unitCostIqd,
          allocatedExtraCost: roundMoney((it.cartonCostUsd - it.cartonUsdBeforeOffice) * it.cartonCount * input.params.usdToIqd),
          landedCostPerUnit: it.unitCostIqd,
          landedCostPerCarton: it.cartonCostIqd,
          suggestedSalePrice: it.suggestedSalePrice,
          matchStatus: it.matchStatus,
          action: it.matchStatus === LandedCostMatchStatus.MATCHED ? LandedCostItemAction.LINK_EXISTING : LandedCostItemAction.PENDING,
          // Seed the create-new draft from the Excel row so the review page
          // starts pre-filled (image URL passthrough only — no fetching).
          newProductDraft: it.matchStatus === LandedCostMatchStatus.MATCHED
            ? undefined
            : ({ itemCode: it.itemNumber, pcsPerCarton: it.piecesPerCarton, ...(it.image ? { imageUrl: it.image } : {}) } as Prisma.InputJsonValue),
        })),
      },
    },
    include: { items: true },
  });
}
