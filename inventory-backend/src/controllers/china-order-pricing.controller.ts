import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  buildChinaOrderTemplate,
  computeChinaPricing,
  createChinaBatch,
  parseChinaOrderExcel,
  repriceChinaBatch,
  type ChinaOrderRow,
  type ChinaPricedItem,
  type ChinaPricingParams,
} from "../services/china-order-pricing.service";
import {
  applyChinaBatchEdits,
  applyChinaBatchFile,
  exportChinaBatchExcel,
  parseChinaOrderWithImages,
  previewChinaBatchFile,
  stashUploadImages,
  takeUploadImages,
  type BatchRowEdit,
} from "../services/china-batch-edit.service";
import { makeThumbnail } from "../utils/thumbnail";
import { contentDisposition } from "../utils/content-disposition";

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function readParams(body: Record<string, unknown>): ChinaPricingParams {
  return {
    cbmPriceUsd: num(body.cbmPriceUsd),
    officePercent: num(body.officePercent),
    cnyPerUsd: num(body.cnyPerUsd),
    usdToIqd: num(body.usdToIqd),
  };
}

// GET /api/landed-cost/china/template — fixed-column China order template
export const downloadChinaTemplate = asyncHandler(async (_req, res) => {
  const buf = buildChinaOrderTemplate();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=china-order-template.xlsx");
  res.send(buf);
});

// POST /api/landed-cost/china/preview — upload + price. NOTHING is persisted.
export const previewChinaOrder = asyncHandler(async (req, res) => {
  const file = (req as unknown as { file?: { buffer: Buffer } }).file;
  if (!file) throw new AppError("لم يتم رفع أي ملف", 400, "NO_FILE");

  // Pictures embedded in the sheet are read too, so they no longer have to be
  // added to each product by hand. The full pictures wait on the server for the
  // save (uploadId); the preview only carries small thumbnails.
  const parsed = await parseChinaOrderWithImages(file.buffer);
  const rows = parsed.map((p) => p.row);
  const params = readParams(req.body as Record<string, unknown>);
  const result = await computeChinaPricing(rows, params);
  const pictures = parsed.filter((p) => p.picture).map((p) => ({ itemNumber: p.row.itemNumber, dataUrl: p.picture!.dataUrl }));
  const uploadId = stashUploadImages(pictures);
  const thumbByCode = new Map<string, string | null>();
  for (const p of pictures) if (!thumbByCode.has(p.itemNumber)) thumbByCode.set(p.itemNumber, await makeThumbnail(p.dataUrl));
  const items = result.items.map((it) => ({ ...it, imageThumb: thumbByCode.get(it.itemNumber) ?? null }));

  res.json({ success: true, data: { ...result, items, params, uploadId, picturesFound: pictures.length } });
});

// POST /api/landed-cost/china/batches — persist the priced order as DRAFT_PRICED.
// Review / item decisions / cancel / final confirm all reuse the existing
// /landed-cost/batches endpoints (shared flow; stock changes only on confirm).
export const createChinaBatchCtrl = asyncHandler(async (req, res) => {
  const body = req.body as {
    invoiceNumber?: string;
    supplier?: string;
    note?: string;
    originalFileName?: string;
    params?: Record<string, unknown>;
    items?: ChinaPricedItem[];
    /** From the preview: the sheet's pictures, held on the server. */
    uploadId?: string;
  };
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new AppError("لا يوجد أصناف لحفظها", 400, "NO_ITEMS");
  }

  const params = readParams(body.params ?? {});
  // Never trust the client's pre-computed pricing (cost/margin numbers a client
  // could tamper with before saving) — re-derive every price from the raw row
  // inputs + params using the same formula the preview used, so what gets
  // persisted into the purchase invoice is always server-computed.
  const pictures = takeUploadImages(body.uploadId);
  const rows: ChinaOrderRow[] = body.items.map((it) => ({
    itemNumber: it.itemNumber,
    image: it.image || pictures?.get(it.itemNumber) || "",
    cartonCount: it.cartonCount,
    piecesPerCarton: it.piecesPerCarton,
    unitPriceCny: it.unitPriceCny,
    cartonCbm: it.cartonCbm,
  }));
  const recomputed = await computeChinaPricing(rows, params);

  const batch = await createChinaBatch(
    {
      invoiceNumber: body.invoiceNumber,
      supplier: body.supplier,
      note: body.note,
      originalFileName: body.originalFileName,
      params,
      items: recomputed.items,
    },
    req.user!.id
  );

  res.status(201).json({ success: true, data: batch });
});

// POST /api/landed-cost/china/batches/:id/reprice — re-apply new screen inputs
// (CBM price, office %, CNY/USD + USD/IQD rates) to an already-saved batch, and
// update the linked purchase invoice + product costs when one exists.
export const repriceChinaBatchCtrl = asyncHandler(async (req, res) => {
  const params = readParams(req.body as Record<string, unknown>);
  const summary = await repriceChinaBatch(String(req.params.id), params, req.user!.id, req.user!.name);
  res.json({ success: true, data: summary });
});

// GET /api/landed-cost/china/batches/:id/export — the batch back in the same
// template (with name, sale price and the pictures) for editing in Excel.
export const exportChinaBatchCtrl = asyncHandler(async (req, res) => {
  const { buffer, fileName } = await exportChinaBatchExcel(String(req.params.id));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", contentDisposition("attachment", fileName));
  res.send(buffer);
});

// POST /api/landed-cost/china/batches/:id/edit-preview — the edited sheet vs the
// batch, row by row. NOTHING is saved.
export const previewChinaBatchEditCtrl = asyncHandler(async (req, res) => {
  const file = (req as unknown as { file?: { buffer: Buffer } }).file;
  if (!file) throw new AppError("لم يتم رفع أي ملف", 400, "NO_FILE");
  res.json({ success: true, data: await previewChinaBatchFile(String(req.params.id), file.buffer) });
});

// POST /api/landed-cost/china/batches/:id/edit-apply — the same sheet again;
// re-read on the server and saved.
export const applyChinaBatchEditCtrl = asyncHandler(async (req, res) => {
  const file = (req as unknown as { file?: { buffer: Buffer } }).file;
  if (!file) throw new AppError("لم يتم رفع أي ملف", 400, "NO_FILE");
  res.json({ success: true, data: await applyChinaBatchFile(String(req.params.id), file.buffer, req.user!.id, req.user!.name) });
});

// PATCH /api/landed-cost/china/batches/:id/items/:itemId — one row edited on screen.
export const editChinaBatchRowCtrl = asyncHandler(async (req, res) => {
  const b = req.body as Omit<BatchRowEdit, "itemId">;
  const edit: BatchRowEdit = { itemId: String(req.params.itemId) };
  if (typeof b.name === "string") edit.name = b.name;
  for (const k of ["salePrice", "cartonCount", "piecesPerCarton", "unitPriceCny", "cartonCbm"] as const) {
    if (b[k] !== undefined && b[k] !== null && Number.isFinite(Number(b[k]))) edit[k] = Number(b[k]);
  }
  if (typeof b.imageUrl === "string") {
    if (!/^data:image\/[\w.+-]+;base64,/i.test(b.imageUrl)) throw new AppError("الصورة غير صالحة", 400, "INVALID_IMAGE");
    edit.imageUrl = b.imageUrl;
  }
  const data = await applyChinaBatchEdits(String(req.params.id), [edit], req.user!.id, req.user!.name, "SCREEN");
  res.json({ success: true, data });
});
