import { LandedCostAllocationMethod, LandedCostItemAction, PaymentType } from "@prisma/client";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  buildLandedCostTemplate,
  cancelBatch,
  computeLandedCostPreview,
  createBatchFromPreview,
  finalConfirmBatch,
  holdBatchForArrival,
  markIncomingItemArrived,
  markShipmentArrived,
  getBatch,
  listBatches,
  parseLandedCostExcel,
  setItemDecision,
  type LandedCostComputedItem,
} from "../services/landed-cost-import.service";

function numOrUndefined(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseAllocationMethod(v: unknown): LandedCostAllocationMethod {
  const value = String(v ?? "BY_VALUE");
  if (value in LandedCostAllocationMethod) return value as LandedCostAllocationMethod;
  throw new AppError("طريقة توزيع الكلفة غير صحيحة", 400, "INVALID_ALLOCATION_METHOD");
}

// POST /api/landed-cost/preview — upload + parse + compute. NOTHING is persisted.
export const previewLandedCost = asyncHandler(async (req, res) => {
  const file = (req as unknown as { file?: { buffer: Buffer } }).file;
  if (!file) throw new AppError("لم يتم رفع أي ملف", 400, "NO_FILE");

  const { rows } = parseLandedCostExcel(file.buffer);
  const allocationMethod = parseAllocationMethod(req.body.allocationMethod);
  const manualExtraCosts = {
    freight: numOrUndefined(req.body.freight),
    customs: numOrUndefined(req.body.customs),
    localTransport: numOrUndefined(req.body.localTransport),
    unloading: numOrUndefined(req.body.unloading),
    commission: numOrUndefined(req.body.commission),
    otherCosts: numOrUndefined(req.body.otherCosts),
  };

  const result = await computeLandedCostPreview({ rows, allocationMethod, manualExtraCosts });

  res.json({
    success: true,
    data: {
      items: result.items,
      totalExtraCost: result.totalExtraCost,
      allocationMethod,
      manualExtraCosts,
      totalRows: rows.length,
      ambiguousCount: result.items.filter((i) => i.matchStatus === "AMBIGUOUS").length,
      notFoundCount: result.items.filter((i) => i.matchStatus === "NOT_FOUND").length,
    },
  });
});

// GET /api/landed-cost/template
export const downloadLandedCostTemplate = asyncHandler(async (_req, res) => {
  const buf = buildLandedCostTemplate();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=landed-cost-template.xlsx");
  res.send(buf);
});

// POST /api/landed-cost/batches — persist the previewed items as a DRAFT_PRICED batch
// ("first Apply" = confirm pricing only; no product/stock writes here).
export const createBatch = asyncHandler(async (req, res) => {
  const body = req.body as {
    invoiceNumber?: string;
    supplier?: string;
    allocationMethod?: string;
    freight?: number; customs?: number; localTransport?: number; unloading?: number; commission?: number; otherCosts?: number;
    note?: string;
    originalFileName?: string;
    items?: LandedCostComputedItem[];
  };

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new AppError("لا يوجد أصناف لحفظها", 400, "NO_ITEMS");
  }

  const batch = await createBatchFromPreview(
    {
      invoiceNumber: body.invoiceNumber,
      supplier: body.supplier,
      allocationMethod: parseAllocationMethod(body.allocationMethod),
      freight: body.freight,
      customs: body.customs,
      localTransport: body.localTransport,
      unloading: body.unloading,
      commission: body.commission,
      otherCosts: body.otherCosts,
      note: body.note,
      originalFileName: body.originalFileName,
      items: body.items,
    },
    req.user!.id
  );

  res.status(201).json({ success: true, data: batch });
});

// GET /api/landed-cost/batches
export const listBatchesCtrl = asyncHandler(async (_req, res) => {
  const batches = await listBatches();
  res.json({ success: true, data: batches });
});

// GET /api/landed-cost/batches/:id
export const getBatchCtrl = asyncHandler(async (req, res) => {
  const batch = await getBatch(String(req.params.id));
  res.json({ success: true, data: batch });
});

// PATCH /api/landed-cost/batches/:id/items/:itemId
export const setItemDecisionCtrl = asyncHandler(async (req, res) => {
  const { action, productId, confirmedSalePrice, newProductDraft } = req.body as {
    action: string;
    productId?: string | null;
    confirmedSalePrice?: number | null;
    newProductDraft?: Record<string, unknown> | null;
  };
  if (!(action in LandedCostItemAction)) {
    throw new AppError("قرار غير صحيح للصنف", 400, "INVALID_ACTION");
  }
  const updated = await setItemDecision(String(req.params.id), String(req.params.itemId), {
    action: action as LandedCostItemAction,
    productId,
    confirmedSalePrice,
    newProductDraft: newProductDraft as never,
  });
  res.json({ success: true, data: updated });
});

// POST /api/landed-cost/batches/:id/cancel
export const cancelBatchCtrl = asyncHandler(async (req, res) => {
  await cancelBatch(String(req.params.id), req.user!.id);
  res.json({ success: true });
});

// POST /api/landed-cost/batches/:id/confirm — creates the real purchase invoice.
export const confirmBatchCtrl = asyncHandler(async (req, res) => {
  const { supplierCustomerId, warehouseId, paymentType, paidAmount } = req.body as {
    supplierCustomerId?: string;
    warehouseId?: string;
    paymentType?: string;
    paidAmount?: number;
  };
  if (!supplierCustomerId) {
    throw new AppError("اختر المورّد (كزبون) لإنشاء فاتورة الشراء", 400, "SUPPLIER_REQUIRED");
  }
  const summary = await finalConfirmBatch(
    String(req.params.id),
    {
      supplierCustomerId,
      warehouseId,
      paymentType: paymentType && paymentType in PaymentType ? (paymentType as PaymentType) : undefined,
      paidAmount,
    },
    req.user!.id,
    req.user!.name
  );
  res.json({ success: true, data: summary });
});

/**
 * «ما وصلت بعد» — the other answer to the arrival question.
 *
 * Puts nothing on the books and raises the storefront's «البضاعة القادمة»
 * rows instead. The supplier and warehouse are collected now and replayed on
 * arrival, so the question is answered once.
 */
export const holdBatchCtrl = asyncHandler(async (req, res) => {
  const { supplierCustomerId, warehouseId, paymentType, paidAmount, expectedAt } = req.body as {
    supplierCustomerId?: string;
    warehouseId?: string;
    paymentType?: string;
    paidAmount?: number;
    expectedAt?: string | null;
  };
  if (!supplierCustomerId) {
    throw new AppError("اختر المورّد (كزبون) — تنكتب عليه الفاتورة يوم الوصول", 400, "SUPPLIER_REQUIRED");
  }
  const data = await holdBatchForArrival(
    String(req.params.id),
    {
      supplierCustomerId,
      warehouseId,
      paymentType: paymentType && paymentType in PaymentType ? (paymentType as PaymentType) : undefined,
      paidAmount,
      expectedAt: expectedAt ?? null,
    },
    req.user!.id,
  );
  res.json({ success: true, data });
});

/** «وصلت الشحنة» — the whole held batch lands at once. */
export const batchArrivedCtrl = asyncHandler(async (req, res) => {
  const data = await markShipmentArrived(String(req.params.id), req.user!.id, req.user!.name);
  res.json({ success: true, data });
});

/** «وصلت» on one incoming card, for a shipment that lands in parts. */
export const incomingArrivedCtrl = asyncHandler(async (req, res) => {
  const data = await markIncomingItemArrived(String(req.params.id), req.user!.id, req.user!.name);
  res.json({ success: true, data });
});
