import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  buildChinaOrderTemplate,
  computeChinaPricing,
  createChinaBatch,
  parseChinaOrderExcel,
  type ChinaOrderRow,
  type ChinaPricedItem,
  type ChinaPricingParams,
} from "../services/china-order-pricing.service";

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

  const rows = parseChinaOrderExcel(file.buffer);
  const params = readParams(req.body as Record<string, unknown>);
  const result = await computeChinaPricing(rows, params);

  res.json({ success: true, data: { ...result, params } });
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
  };
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new AppError("لا يوجد أصناف لحفظها", 400, "NO_ITEMS");
  }

  const params = readParams(body.params ?? {});
  // Never trust the client's pre-computed pricing (cost/margin numbers a client
  // could tamper with before saving) — re-derive every price from the raw row
  // inputs + params using the same formula the preview used, so what gets
  // persisted into the purchase invoice is always server-computed.
  const rows: ChinaOrderRow[] = body.items.map((it) => ({
    itemNumber: it.itemNumber,
    image: it.image,
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
