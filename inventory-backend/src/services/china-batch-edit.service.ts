import { createHash, randomBytes } from "crypto";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { LandedCostBatchStatus, LandedCostItemAction, Prisma } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { roundMoney } from "../utils/financial";
import { makeThumbnail } from "../utils/thumbnail";
import {
  parseChinaOrderExcel,
  priceChinaRow,
  repriceChinaBatchInTx,
  type ChinaOrderRow,
  type ChinaPricingParams,
  type RepriceChinaBatchSummary,
} from "./china-order-pricing.service";
import { syncProductTotalStock } from "./warehouse-stock.service";

// «تعديل دفعة الصين» — the order as it was priced, edited after the fact:
//  • pictures embedded in the sheet are read instead of being re-added by hand;
//  • a batch downloads back to the same template (with name and sale price);
//  • an edited sheet is compared to the batch row by row before anything saves;
//  • saving rewrites the rows and rebuilds the SAME purchase invoice.

/* ── Pictures embedded in the sheet ────────────────────────────────── */

type SheetImage = { dataUrl: string; hash: string };

const sha1 = (b: Buffer) => createHash("sha1").update(b).digest("hex");

/** Embedded pictures keyed by `${sheetName}|${row}` (0-based, the row the picture's top sits on). */
export async function extractSheetImages(buffer: Buffer): Promise<Map<string, SheetImage>> {
  const out = new Map<string, SheetImage>();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    // A sheet ExcelJS can't open still prices fine — it just brings no pictures.
    return out;
  }
  for (const ws of wb.worksheets) {
    for (const img of ws.getImages()) {
      const media = wb.getImage(Number(img.imageId)) as { buffer?: Buffer | ArrayBuffer; base64?: string } | undefined;
      const raw = media?.buffer
        ? Buffer.from(media.buffer as ArrayBuffer)
        : media?.base64
          ? Buffer.from(media.base64.replace(/^data:[^,]+,/, ""), "base64")
          : null;
      if (!raw?.length) continue;
      const tl = img.range.tl as unknown as { nativeRow?: number; row?: number };
      const row = Math.floor(tl.nativeRow ?? tl.row ?? -1);
      const key = `${ws.name}|${row}`;
      if (row < 0 || out.has(key)) continue;
      try {
        const jpeg = await sharp(raw).rotate().resize(900, 900, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        out.set(key, { dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`, hash: sha1(raw) });
      } catch {
        /* not an image sharp can read (EMF/WMF) — skip it */
      }
    }
  }
  return out;
}

/** Parsed rows with their embedded picture (when the sheet has one on that row). */
export async function parseChinaOrderWithImages(buffer: Buffer) {
  const rows = parseChinaOrderExcel(buffer);
  const images = await extractSheetImages(buffer);
  return rows.map((row) => ({ row, picture: images.get(`${row.sheetName}|${row.sheetRow}`) ?? null }));
}

/* ── First upload: pictures wait here until the batch is saved ─────── */
// The preview → save round trip goes through the browser, and a whole order's
// pictures would blow the JSON body limit. They stay on the server for two
// hours instead, keyed by an upload id the save sends back.

const STASH_TTL_MS = 2 * 60 * 60_000;
const uploadStash = new Map<string, { at: number; images: Map<string, string> }>();

export function stashUploadImages(pictures: Array<{ itemNumber: string; dataUrl: string }>): string | null {
  const now = Date.now();
  for (const [id, v] of uploadStash) if (now - v.at > STASH_TTL_MS) uploadStash.delete(id);
  if (pictures.length === 0) return null;
  const images = new Map<string, string>();
  for (const p of pictures) if (p.itemNumber && !images.has(p.itemNumber)) images.set(p.itemNumber, p.dataUrl);
  const id = randomBytes(12).toString("base64url");
  uploadStash.set(id, { at: now, images });
  return id;
}

export function takeUploadImages(id?: string | null): Map<string, string> | null {
  if (!id) return null;
  const hit = uploadStash.get(id);
  if (!hit || Date.now() - hit.at > STASH_TTL_MS) return null;
  return hit.images;
}

/* ── Batch → the same Excel template ───────────────────────────────── */

const EXPORT_HEADERS = [
  "رقم المادة", "الصورة", "عدد الكراتين", "قطع الكارتون", "سعر القطعة يوان", "حجم الكارتون",
  "اسم المادة", "سعر البيع", "كلفة القطعة دينار (للعلم)",
];

function dataUrlBytes(url: string | null | undefined): { bytes: Buffer; ext: "jpeg" | "png" | "gif" } | null {
  const m = /^data:image\/([\w.+-]+);base64,(.+)$/i.exec(String(url ?? "").trim());
  if (!m) return null;
  const kind = m[1].toLowerCase();
  const ext = kind === "png" ? "png" : kind === "gif" ? "gif" : "jpeg";
  return { bytes: Buffer.from(m[2], "base64"), ext };
}

async function loadChinaBatch(batchId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const batch = await db.landedCostImportBatch.findUnique({
    where: { id: batchId },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: { product: { select: { id: true, name: true, salePrice: true, imageUrl: true, pcsPerCarton: true } } },
      },
    },
  });
  if (!batch) throw new AppError("الدفعة غير موجودة", 404, "BATCH_NOT_FOUND");
  if (batch.cbmPriceUsd == null || batch.cnyPerUsd == null || batch.usdToIqd == null) {
    throw new AppError("هذه الدفعة ليست أوردر صين — التعديل بالإكسل لأوردرات الصين فقط", 400, "NOT_CHINA_BATCH");
  }
  if (batch.status === LandedCostBatchStatus.CANCELLED) throw new AppError("الدفعة ملغاة", 409, "BATCH_CANCELLED");
  const params: ChinaPricingParams = {
    cbmPriceUsd: Number(batch.cbmPriceUsd),
    officePercent: Number(batch.officePercent ?? 0),
    cnyPerUsd: Number(batch.cnyPerUsd),
    usdToIqd: Number(batch.usdToIqd),
  };
  return { batch, params, items: batch.items.filter((it) => it.action !== LandedCostItemAction.SKIP) };
}

type BatchItem = Awaited<ReturnType<typeof loadChinaBatch>>["items"][number];

const draftOf = (it: BatchItem) => (it.newProductDraft as { name?: string; imageUrl?: string } | null) ?? {};
const nameOf = (it: BatchItem) => it.product?.name ?? draftOf(it).name ?? it.productName;
const salePriceOf = (it: BatchItem) => Number(it.product?.salePrice ?? it.confirmedSalePrice ?? 0);
const imageOf = (it: BatchItem) => it.product?.imageUrl ?? draftOf(it).imageUrl ?? null;

export async function exportChinaBatchExcel(batchId: string) {
  const { batch, items } = await loadChinaBatch(batchId);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("تسعيرة الصين", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  ws.addRow(EXPORT_HEADERS).font = { bold: true };
  ws.columns.forEach((c, i) => { c.width = [14, 14, 12, 12, 14, 12, 34, 12, 18][i] ?? 12; });
  for (const it of items) {
    const row = ws.addRow([
      it.itemCode, "", it.cartonCount ?? 0, it.piecesPerCarton ?? 0,
      Number(it.unitPriceCny ?? 0), Number(it.cartonCbm ?? 0),
      nameOf(it), salePriceOf(it), Number(it.landedCostPerUnit),
    ]);
    const pic = dataUrlBytes(imageOf(it));
    if (pic) {
      row.height = 62;
      const id = wb.addImage({ buffer: pic.bytes as unknown as ExcelJS.Buffer, extension: pic.ext });
      ws.addImage(id, { tl: { col: 1, row: row.number - 1 }, ext: { width: 80, height: 80 }, editAs: "oneCell" });
    }
  }
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const label = (batch.invoiceNumber || batch.originalFileName || "دفعة-الصين").replace(/\.[^.]+$/, "");
  return { buffer, fileName: `${label}-تعديل.xlsx` };
}

/* ── Edited sheet vs the batch ─────────────────────────────────────── */

export interface BatchRowEdit {
  itemId: string;
  name?: string;
  salePrice?: number;
  cartonCount?: number;
  piecesPerCarton?: number;
  unitPriceCny?: number;
  cartonCbm?: number;
  /** data: URL of a new picture. */
  imageUrl?: string;
}

type Snapshot = {
  name: string; salePrice: number; cartonCount: number; piecesPerCarton: number;
  unitPriceCny: number; cartonCbm: number; unitCostIqd: number; pieces: number;
};

export interface BatchEditPreviewRow {
  itemId: string;
  itemCode: string;
  productId: string | null;
  before: Snapshot;
  after: Snapshot;
  changes: string[];
  warnings: string[];
  imageChanged: boolean;
  /** Small preview of the new picture (only when it changed). */
  newImageThumb: string | null;
}

const snapshotOf = (it: BatchItem): Snapshot => ({
  name: nameOf(it),
  salePrice: salePriceOf(it),
  cartonCount: it.cartonCount ?? 0,
  piecesPerCarton: it.piecesPerCarton ?? 0,
  unitPriceCny: Number(it.unitPriceCny ?? 0),
  cartonCbm: Number(it.cartonCbm ?? 0),
  unitCostIqd: Number(it.landedCostPerUnit),
  pieces: (it.cartonCount ?? 0) * (it.piecesPerCarton ?? 0),
});

function warningsFor(after: Snapshot, before: Snapshot): string[] {
  const w: string[] = [];
  if (after.salePrice > 0 && after.salePrice <= after.unitCostIqd) w.push("سعر البيع أقل من الكلفة أو يساويها");
  else if (after.salePrice > 0 && (after.salePrice - after.unitCostIqd) / after.salePrice < 0.1) w.push("الربح أقل من 10%");
  if (after.pieces !== before.pieces) w.push("الكمية تغيّرت — المخزن والفاتورة يتصححون");
  return w;
}

/** A row's edit applied on top of the batch values, priced with the batch's numbers. */
function afterOf(before: Snapshot, edit: Omit<BatchRowEdit, "itemId" | "imageUrl">, params: ChinaPricingParams): Snapshot {
  const after: Snapshot = {
    ...before,
    name: edit.name?.trim() || before.name,
    salePrice: edit.salePrice && edit.salePrice > 0 ? roundMoney(edit.salePrice) : before.salePrice,
    cartonCount: edit.cartonCount && edit.cartonCount > 0 ? Math.floor(edit.cartonCount) : before.cartonCount,
    piecesPerCarton: edit.piecesPerCarton && edit.piecesPerCarton > 0 ? Math.floor(edit.piecesPerCarton) : before.piecesPerCarton,
    unitPriceCny: edit.unitPriceCny && edit.unitPriceCny > 0 ? edit.unitPriceCny : before.unitPriceCny,
    cartonCbm: edit.cartonCbm !== undefined && edit.cartonCbm >= 0 ? edit.cartonCbm : before.cartonCbm,
  };
  after.pieces = after.cartonCount * after.piecesPerCarton;
  after.unitCostIqd = roundMoney(priceChinaRow(after, params).H);
  return after;
}

const SNAP_LABELS: Array<[keyof Snapshot, string]> = [
  ["name", "الاسم"], ["salePrice", "سعر البيع"], ["cartonCount", "الكراتين"], ["piecesPerCarton", "قطع الكارتون"],
  ["unitPriceCny", "سعر اليوان"], ["cartonCbm", "حجم الكارتون"],
];

const norm = (code: string) => code.trim().toLowerCase();

async function compareSheet(batchId: string, buffer: Buffer) {
  const { items, params } = await loadChinaBatch(batchId);
  const parsed = await parseChinaOrderWithImages(buffer);

  // Same code on several rows (it happens): pair them in order.
  const pool = new Map<string, BatchItem[]>();
  for (const it of items) {
    const k = norm(it.itemCode);
    pool.set(k, [...(pool.get(k) ?? []), it]);
  }
  const unmatched: string[] = [];
  const pairs: Array<{ it: BatchItem; row: ChinaOrderRow; picture: SheetImage | null }> = [];
  for (const { row, picture } of parsed) {
    const queue = pool.get(norm(row.itemNumber));
    const it = queue?.shift();
    if (!it) { unmatched.push(row.itemNumber || "بدون رقم"); continue; }
    pairs.push({ it, row, picture });
  }

  const rows: Array<BatchEditPreviewRow & { edit: BatchRowEdit }> = [];
  for (const { it, row, picture } of pairs) {
    const before = snapshotOf(it);
    const edit: BatchRowEdit = {
      itemId: it.id,
      name: row.name, salePrice: row.salePrice, cartonCount: row.cartonCount,
      piecesPerCarton: row.piecesPerCarton, unitPriceCny: row.unitPriceCny, cartonCbm: row.cartonCbm,
    };
    const after = afterOf(before, edit, params);
    const current = dataUrlBytes(imageOf(it));
    const imageChanged = Boolean(picture && (!current || sha1(current.bytes) !== picture.hash));
    if (imageChanged) edit.imageUrl = picture!.dataUrl;
    const changes = SNAP_LABELS.filter(([k]) => after[k] !== before[k]).map(([, label]) => label);
    if (imageChanged) changes.push("الصورة");
    if (changes.length === 0) continue;
    rows.push({
      itemId: it.id, itemCode: it.itemCode, productId: it.productId,
      before, after, changes, warnings: warningsFor(after, before), imageChanged,
      newImageThumb: imageChanged ? await makeThumbnail(picture!.dataUrl) : null,
      edit,
    });
  }
  const totalOf = (pick: (r: Snapshot) => number) =>
    roundMoney(items.reduce((s, it) => {
      const changed = rows.find((r) => r.itemId === it.id);
      return s + pick(changed ? changed.after : snapshotOf(it));
    }, 0));
  return {
    rows,
    unmatched,
    missingFromFile: [...pool.values()].flat().map((it) => it.itemCode),
    oldTotal: roundMoney(items.reduce((s, it) => s + snapshotOf(it).pieces * snapshotOf(it).unitCostIqd, 0)),
    newTotal: totalOf((s) => s.pieces * s.unitCostIqd),
  };
}

export async function previewChinaBatchFile(batchId: string, buffer: Buffer) {
  const r = await compareSheet(batchId, buffer);
  return { ...r, rows: r.rows.map(({ edit: _edit, ...row }) => row) };
}

/** Saves exactly the rows the preview showed — the sheet is read again, never trusted from the browser. */
export async function applyChinaBatchFile(batchId: string, buffer: Buffer, userId: string, userName?: string) {
  const r = await compareSheet(batchId, buffer);
  if (r.rows.length === 0) throw new AppError("ما لكيت أي تغيير بالملف", 400, "NO_CHANGES");
  return applyChinaBatchEdits(batchId, r.rows.map((x) => x.edit), userId, userName, "EXCEL");
}

/* ── Saving edits (sheet or screen) ────────────────────────────────── */

export async function applyChinaBatchEdits(
  batchId: string,
  edits: BatchRowEdit[],
  userId: string,
  userName?: string,
  source: "EXCEL" | "SCREEN" = "SCREEN",
): Promise<RepriceChinaBatchSummary & { editedRows: number }> {
  if (edits.length === 0) throw new AppError("ما في تعديل", 400, "NO_CHANGES");
  // Thumbnails are made before the transaction — image work inside it would hold row locks.
  const thumbs = new Map<string, string | null>();
  for (const e of edits) if (e.imageUrl) thumbs.set(e.itemId, await makeThumbnail(e.imageUrl));

  return prisma.$transaction(
    async (tx) => {
      const { items, params } = await loadChinaBatch(batchId, tx);
      const byId = new Map(items.map((it) => [it.id, it]));
      const fields: Record<string, number> = {};
      for (const e of edits) {
        const it = byId.get(e.itemId);
        if (!it) throw new AppError("سطر من التعديل مو ضمن هذه الدفعة — حدّث الصفحة", 409, "ITEM_NOT_IN_BATCH");
        const before = snapshotOf(it);
        const after = afterOf(before, e, params);
        for (const [k, label] of SNAP_LABELS) if (after[k] !== before[k]) fields[label] = (fields[label] ?? 0) + 1;
        if (e.imageUrl) fields["الصورة"] = (fields["الصورة"] ?? 0) + 1;

        const draft = draftOf(it);
        await tx.landedCostImportItem.update({
          where: { id: it.id },
          data: {
            productName: after.name,
            confirmedSalePrice: after.salePrice > 0 ? after.salePrice : it.confirmedSalePrice,
            cartonCount: after.cartonCount,
            piecesPerCarton: after.piecesPerCarton,
            unitPriceCny: after.unitPriceCny,
            cartonCbm: after.cartonCbm,
            quantity: after.pieces,
            // A row whose product does not exist yet keeps its edits in the draft
            // the confirm step creates the product from.
            ...(it.productId
              ? {}
              : {
                  newProductDraft: {
                    ...draft,
                    name: after.name,
                    pcsPerCarton: after.piecesPerCarton,
                    ...(e.imageUrl ? { imageUrl: e.imageUrl } : {}),
                  } as Prisma.InputJsonValue,
                }),
          },
        });

        if (it.productId) {
          await tx.product.update({
            where: { id: it.productId },
            data: {
              name: after.name,
              ...(after.salePrice > 0 ? { salePrice: after.salePrice } : {}),
              ...(after.piecesPerCarton !== before.piecesPerCarton ? { pcsPerCarton: after.piecesPerCarton } : {}),
              ...(e.imageUrl ? { imageUrl: e.imageUrl, thumbnailUrl: thumbs.get(e.itemId) ?? null } : {}),
            },
          });
          if (after.piecesPerCarton !== before.piecesPerCarton) await syncProductTotalStock(tx, it.productId);
        }
      }

      // Costs, then the SAME purchase invoice (quantities included) — through
      // the normal invoice edit, so stock, supplier balance and the line-count
      // freeze all apply.
      const summary = await repriceChinaBatchInTx(tx, batchId, params, userId, userName, {
        allowAwaiting: true,
        quantitiesFromBatch: true,
        auditAction: "LANDED_COST_BATCH_EDITED",
        auditExtra: { source, editedRows: edits.length, fields },
      });
      return { ...summary, editedRows: edits.length };
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}
