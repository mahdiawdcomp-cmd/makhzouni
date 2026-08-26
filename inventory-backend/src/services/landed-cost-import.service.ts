import { read, utils } from "xlsx";
import {
  LandedCostAllocationMethod,
  LandedCostBatchStatus,
  LandedCostItemAction,
  LandedCostMatchStatus,
  InvoiceType,
  PaymentType,
  Prisma,
  Unit,
} from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { roundMoney } from "../utils/financial";
import { createProduct } from "./product.service";
import { createInvoice } from "./invoice.service";

type Db = Prisma.TransactionClient | typeof prisma;

// ── Excel parsing (reference: controllers/import.controller.ts) ────────────

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function cleanNum(v: unknown): number {
  const n = Number(String(v ?? "0").replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

export interface ParsedLandedCostRow {
  itemCode: string;
  productName: string;
  quantity: number;
  cartonCount: number | null;
  purchasePrice: number;
  supplier: string;
  invoiceNumber: string;
  // Optional per-row extra-cost columns. When any is present the row is
  // costed directly from these instead of the batch-level allocation pool.
  rowExtraCost: number;
  hasRowExtraCost: boolean;
}

export function parseLandedCostExcel(buffer: Buffer): { rows: ParsedLandedCostRow[]; totalRows: number } {
  const wb = read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  if (raw.length === 0) throw new AppError("الملف فارغ", 400, "EMPTY_FILE");
  if (raw.length > 5000) throw new AppError("الملف يحتوي على أكثر من 5000 صف", 400, "TOO_MANY_ROWS");

  const rows: ParsedLandedCostRow[] = raw.map((row) => {
    const itemCode = clean(row["كود الصنف"] ?? row["رقم المادة"] ?? row["itemCode"] ?? row["item_code"] ?? row["كود"]);
    const productName = clean(row["اسم المادة"] ?? row["اسم الصنف"] ?? row["productName"] ?? row["product_name"] ?? row["name"]);
    const quantity = Math.max(0, Math.floor(cleanNum(row["الكمية"] ?? row["quantity"] ?? row["qty"])));
    const cartonRaw = row["عدد الكراتين"] ?? row["cartonCount"] ?? row["carton_count"] ?? row["cartons"];
    const cartonCount = cartonRaw === "" || cartonRaw === undefined ? null : Math.max(0, Math.floor(cleanNum(cartonRaw)));
    const purchasePrice = cleanNum(row["سعر الشراء"] ?? row["purchasePrice"] ?? row["purchase_price"]);
    const supplier = clean(row["المورد"] ?? row["supplier"]);
    const invoiceNumber = clean(row["رقم الفاتورة"] ?? row["invoiceNumber"] ?? row["invoice_number"]);

    const freight = row["الشحن"] ?? row["freight"];
    const customs = row["الجمارك"] ?? row["customs"];
    const localTransport = row["نقل داخلي"] ?? row["localTransport"] ?? row["local_transport"];
    const unloading = row["تفريغ"] ?? row["unloading"];
    const commission = row["عمولة"] ?? row["commission"];
    const otherCosts = row["تكاليف اخرى"] ?? row["otherCosts"] ?? row["other_costs"];
    const rowFields = [freight, customs, localTransport, unloading, commission, otherCosts];
    const hasRowExtraCost = rowFields.some((v) => v !== undefined && v !== "" && cleanNum(v) !== 0);
    const rowExtraCost = rowFields.reduce((sum: number, v) => sum + cleanNum(v), 0);

    return { itemCode, productName, quantity, cartonCount, purchasePrice, supplier, invoiceNumber, rowExtraCost, hasRowExtraCost };
  });

  return { rows, totalRows: raw.length };
}

export function buildLandedCostTemplate(): Buffer {
  const ws = utils.aoa_to_sheet([
    [
      "كود الصنف", "اسم المادة", "الكمية", "عدد الكراتين", "سعر الشراء",
      "المورد", "رقم الفاتورة", "الشحن", "الجمارك", "نقل داخلي", "تفريغ", "عمولة", "تكاليف اخرى",
    ],
    ["P00001", "مثال: شامبو", "120", "10", "3500", "شركة التوريد", "INV-1001", "", "", "", "", "", ""],
  ]);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "استيراد كلفة");
  const { write } = require("xlsx");
  return write(wb, { type: "buffer", bookType: "xlsx" });
}

// ── Allocation + landed-cost math ───────────────────────────────────────────

function rowWeight(row: ParsedLandedCostRow, method: LandedCostAllocationMethod): number {
  if (method === LandedCostAllocationMethod.BY_QUANTITY) return Math.max(row.quantity, 0);
  if (method === LandedCostAllocationMethod.BY_CARTON) return Math.max(row.cartonCount ?? 0, 0) || Math.max(row.quantity, 0) || 1;
  // BY_VALUE (default)
  return Math.max(row.quantity * row.purchasePrice, 0);
}

export interface LandedCostComputedItem {
  itemCode: string;
  productName: string;
  quantity: number;
  cartonCount: number | null;
  purchasePrice: number;
  allocatedExtraCost: number;
  landedCostPerUnit: number;
  landedCostPerCarton: number | null;
  suggestedSalePrice: number | null;
  expectedProfit: number | null;
  matchStatus: LandedCostMatchStatus;
  productId: string | null;
  matchedProduct: { id: string; name: string; itemNumber: string; salePrice: number; purchasePrice: number; imageUrl: string | null; thumbnailUrl: string | null } | null;
}

export interface LandedCostPreviewInput {
  rows: ParsedLandedCostRow[];
  allocationMethod: LandedCostAllocationMethod;
  manualExtraCosts: { freight?: number; customs?: number; localTransport?: number; unloading?: number; commission?: number; otherCosts?: number };
}

export async function computeLandedCostPreview(input: LandedCostPreviewInput, db: Db = prisma): Promise<{ items: LandedCostComputedItem[]; totalExtraCost: number; poolExtraCost: number }> {
  const { rows, allocationMethod, manualExtraCosts } = input;
  const poolExtraCost = roundMoney(
    (manualExtraCosts.freight ?? 0) +
    (manualExtraCosts.customs ?? 0) +
    (manualExtraCosts.localTransport ?? 0) +
    (manualExtraCosts.unloading ?? 0) +
    (manualExtraCosts.commission ?? 0) +
    (manualExtraCosts.otherCosts ?? 0)
  );

  // Rows without their own per-row extra-cost columns share the manual pool,
  // proportionally by the chosen allocation method.
  const poolRows = rows.filter((r) => !r.hasRowExtraCost);
  const totalWeight = poolRows.reduce((sum, r) => sum + rowWeight(r, allocationMethod), 0);

  // Duplicate item codes WITHIN the uploaded file are ambiguous — the DB
  // itemNumber is unique so an ambiguous DB match is impossible; the only
  // real ambiguity is the same code appearing twice in this one file.
  const codeCounts = new Map<string, number>();
  for (const r of rows) {
    if (!r.itemCode) continue;
    codeCounts.set(r.itemCode, (codeCounts.get(r.itemCode) ?? 0) + 1);
  }

  const codes = [...new Set(rows.map((r) => r.itemCode).filter(Boolean))];
  const products = codes.length
    ? await (db as typeof prisma).product.findMany({
        where: { itemNumber: { in: codes }, deletedAt: null },
        select: { id: true, name: true, itemNumber: true, salePrice: true, purchasePrice: true, imageUrl: true, thumbnailUrl: true },
      })
    : [];
  const productByCode = new Map(products.map((p) => [p.itemNumber, p]));

  const items: LandedCostComputedItem[] = rows.map((row) => {
    const allocatedExtraCost = row.hasRowExtraCost
      ? roundMoney(row.rowExtraCost)
      : totalWeight > 0
        ? roundMoney(poolExtraCost * (rowWeight(row, allocationMethod) / totalWeight))
        : 0;

    const landedCostPerUnit = roundMoney(row.purchasePrice + (row.quantity > 0 ? allocatedExtraCost / row.quantity : 0));
    const landedCostPerCarton = row.cartonCount && row.cartonCount > 0 && row.quantity > 0
      ? roundMoney(landedCostPerUnit * (row.quantity / row.cartonCount))
      : null;

    const isDuplicateInFile = row.itemCode ? (codeCounts.get(row.itemCode) ?? 0) > 1 : false;
    const matched = row.itemCode ? productByCode.get(row.itemCode) ?? null : null;

    let matchStatus: LandedCostMatchStatus;
    if (isDuplicateInFile) matchStatus = LandedCostMatchStatus.AMBIGUOUS;
    else if (matched) matchStatus = LandedCostMatchStatus.MATCHED;
    else matchStatus = LandedCostMatchStatus.NOT_FOUND;

    let suggestedSalePrice: number | null = null;
    if (matched && Number(matched.purchasePrice) > 0) {
      suggestedSalePrice = roundMoney(landedCostPerUnit * (Number(matched.salePrice) / Number(matched.purchasePrice)));
    }
    const expectedProfit = suggestedSalePrice != null ? roundMoney(suggestedSalePrice - landedCostPerUnit) : null;

    return {
      itemCode: row.itemCode,
      productName: row.productName,
      quantity: row.quantity,
      cartonCount: row.cartonCount,
      purchasePrice: roundMoney(row.purchasePrice),
      allocatedExtraCost,
      landedCostPerUnit,
      landedCostPerCarton,
      suggestedSalePrice,
      expectedProfit,
      matchStatus,
      productId: matchStatus === LandedCostMatchStatus.MATCHED ? matched!.id : null,
      matchedProduct: matched
        ? { id: matched.id, name: matched.name, itemNumber: matched.itemNumber, salePrice: Number(matched.salePrice), purchasePrice: Number(matched.purchasePrice), imageUrl: matched.imageUrl, thumbnailUrl: matched.thumbnailUrl }
        : null,
    };
  });

  return { items, totalExtraCost: poolExtraCost, poolExtraCost };
}

// ── Batch persistence (Apply #1 = "confirm pricing") ────────────────────────

export interface CreateBatchInput {
  invoiceNumber?: string;
  supplier?: string;
  allocationMethod: LandedCostAllocationMethod;
  freight?: number;
  customs?: number;
  localTransport?: number;
  unloading?: number;
  commission?: number;
  otherCosts?: number;
  note?: string;
  originalFileName?: string;
  items: LandedCostComputedItem[];
}

export async function createBatchFromPreview(input: CreateBatchInput, createdBy: string, db: Db = prisma) {
  const totalExtraCost = roundMoney(
    (input.freight ?? 0) + (input.customs ?? 0) + (input.localTransport ?? 0) +
    (input.unloading ?? 0) + (input.commission ?? 0) + (input.otherCosts ?? 0)
  );

  const batch = await db.landedCostImportBatch.create({
    data: {
      invoiceNumber: input.invoiceNumber?.trim() || null,
      supplier: input.supplier?.trim() || null,
      allocationMethod: input.allocationMethod,
      totalExtraCost,
      freight: input.freight ?? 0,
      customs: input.customs ?? 0,
      localTransport: input.localTransport ?? 0,
      unloading: input.unloading ?? 0,
      commission: input.commission ?? 0,
      otherCosts: input.otherCosts ?? 0,
      note: input.note?.trim() || null,
      originalFileName: input.originalFileName ?? null,
      status: LandedCostBatchStatus.DRAFT_PRICED,
      createdBy,
      items: {
        create: input.items.map((it) => ({
          productId: it.productId,
          itemCode: it.itemCode,
          productName: it.productName,
          quantity: it.quantity,
          cartonCount: it.cartonCount,
          purchasePrice: it.purchasePrice,
          allocatedExtraCost: it.allocatedExtraCost,
          landedCostPerUnit: it.landedCostPerUnit,
          landedCostPerCarton: it.landedCostPerCarton,
          suggestedSalePrice: it.suggestedSalePrice,
          expectedProfit: it.expectedProfit,
          matchStatus: it.matchStatus,
          // MATCHED rows default to linking the matched product; NOT_FOUND/AMBIGUOUS
          // stay PENDING until the user explicitly decides in the review step.
          action: it.matchStatus === LandedCostMatchStatus.MATCHED ? LandedCostItemAction.LINK_EXISTING : LandedCostItemAction.PENDING,
        })),
      },
    },
    include: { items: true },
  });

  return batch;
}

export async function getBatch(batchId: string, db: Db = prisma) {
  const batch = await db.landedCostImportBatch.findUnique({
    where: { id: batchId },
    include: {
      items: { include: { product: { select: { id: true, name: true, itemNumber: true, imageUrl: true, thumbnailUrl: true, salePrice: true, purchasePrice: true, costPrice: true } } } },
      purchaseInvoice: { select: { id: true, invoiceNumber: true } },
    },
  });
  if (!batch) throw new AppError("الدفعة غير موجودة", 404, "BATCH_NOT_FOUND");
  return batch;
}

export async function listBatches(db: Db = prisma) {
  return db.landedCostImportBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { _count: { select: { items: true } }, purchaseInvoice: { select: { id: true, invoiceNumber: true } } },
  });
}

// ── Per-item review decisions ───────────────────────────────────────────────

export interface ItemDecisionInput {
  action: LandedCostItemAction;
  productId?: string | null;
  confirmedSalePrice?: number | null;
  newProductDraft?: {
    name?: string;
    itemCode?: string;
    barcode?: string;
    category?: string;
    pcsPerCarton?: number;
    imageUrl?: string;
  } | null;
}

export async function setItemDecision(batchId: string, itemId: string, decision: ItemDecisionInput, db: Db = prisma) {
  const batch = await db.landedCostImportBatch.findUnique({ where: { id: batchId }, select: { status: true } });
  if (!batch) throw new AppError("الدفعة غير موجودة", 404, "BATCH_NOT_FOUND");
  if (batch.status === LandedCostBatchStatus.PURCHASE_INVOICE_CREATED || batch.status === LandedCostBatchStatus.CANCELLED) {
    throw new AppError("لا يمكن تعديل دفعة تم تحويلها لفاتورة شراء أو أُلغيت", 409, "BATCH_LOCKED");
  }

  const item = await db.landedCostImportItem.findFirst({ where: { id: itemId, batchId } });
  if (!item) throw new AppError("الصنف غير موجود ضمن هذه الدفعة", 404, "ITEM_NOT_FOUND");

  if (decision.action === LandedCostItemAction.LINK_EXISTING && !decision.productId) {
    throw new AppError("اختر مادة موجودة للربط", 400, "PRODUCT_REQUIRED");
  }
  if (decision.action === LandedCostItemAction.LINK_EXISTING && decision.productId) {
    const linked = await db.product.findFirst({ where: { id: decision.productId, deletedAt: null } });
    if (!linked) throw new AppError("المادة المختارة غير موجودة أو محذوفة", 404, "PRODUCT_NOT_FOUND");
  }
  if (decision.action === LandedCostItemAction.CREATE_NEW && (decision.confirmedSalePrice === undefined || decision.confirmedSalePrice === null)) {
    throw new AppError("سعر البيع مطلوب عند إنشاء مادة جديدة", 400, "SALE_PRICE_REQUIRED");
  }

  const updated = await db.landedCostImportItem.update({
    where: { id: itemId },
    data: {
      action: decision.action,
      productId: decision.action === LandedCostItemAction.LINK_EXISTING ? decision.productId : decision.action === LandedCostItemAction.CREATE_NEW ? null : item.productId,
      confirmedSalePrice: decision.confirmedSalePrice ?? item.confirmedSalePrice,
      newProductDraft:
        decision.newProductDraft === undefined
          ? (item.newProductDraft as Prisma.InputJsonValue | undefined)
          : decision.newProductDraft === null
            ? Prisma.JsonNull
            : (decision.newProductDraft as Prisma.InputJsonValue),
    },
  });

  if (batch.status === LandedCostBatchStatus.DRAFT_PRICED) {
    await db.landedCostImportBatch.update({ where: { id: batchId }, data: { status: LandedCostBatchStatus.REVIEWING_ITEMS } });
  }

  return updated;
}

export async function cancelBatch(batchId: string, userId: string, db: Db = prisma) {
  const batch = await db.landedCostImportBatch.findUnique({ where: { id: batchId }, select: { status: true } });
  if (!batch) throw new AppError("الدفعة غير موجودة", 404, "BATCH_NOT_FOUND");
  if (batch.status === LandedCostBatchStatus.PURCHASE_INVOICE_CREATED) {
    throw new AppError("لا يمكن إلغاء دفعة تم تحويلها بالفعل لفاتورة شراء", 409, "BATCH_LOCKED");
  }
  await db.landedCostImportBatch.update({ where: { id: batchId }, data: { status: LandedCostBatchStatus.CANCELLED } });
  await db.auditLog.create({
    data: { userId, action: "LANDED_COST_CANCELLED", entity: "LandedCostImportBatch", recordId: batchId, metadata: {} as Prisma.InputJsonValue },
  });
}

// ── Final confirm: create the real purchase invoice ─────────────────────────

export interface FinalConfirmInput {
  supplierCustomerId: string;
  warehouseId?: string;
  paymentType?: PaymentType;
  paidAmount?: number;
}

export interface FinalConfirmSummary {
  purchaseInvoiceId: string;
  invoiceNumber: string;
  linkedCount: number;
  createdCount: number;
  skippedCount: number;
  totalStockAdded: number;
  warnings: string[];
}

export async function finalConfirmBatch(
  batchId: string,
  opts: FinalConfirmInput,
  userId: string,
  userName?: string,
  db?: Prisma.TransactionClient,
): Promise<FinalConfirmSummary> {
  if (db) return finalConfirmBatchInTransaction(db, batchId, opts, userId, userName);
  // A 25 MB China-order sheet is hundreds of rows, each running createProduct
  // before the purchase invoice is built. Prisma's 5s default aborts that with
  // an opaque P2028 and rolls back the batch claim, so the admin sees a 500 and
  // no invoice. Mirrors INVOICE_TX_OPTIONS on the invoice path.
  return prisma.$transaction(
    (tx) => finalConfirmBatchInTransaction(tx, batchId, opts, userId, userName),
    { maxWait: 10_000, timeout: 60_000 },
  );
}

async function finalConfirmBatchInTransaction(
  tx: Prisma.TransactionClient,
  batchId: string,
  opts: FinalConfirmInput,
  userId: string,
  userName?: string,
): Promise<FinalConfirmSummary> {
  const batch = await tx.landedCostImportBatch.findUnique({
    where: { id: batchId },
    include: { items: true },
  });
  if (!batch) throw new AppError("الدفعة غير موجودة", 404, "BATCH_NOT_FOUND");
  if (batch.status === LandedCostBatchStatus.PURCHASE_INVOICE_CREATED) {
    throw new AppError("تم بالفعل إنشاء فاتورة شراء من هذه الدفعة", 409, "ALREADY_APPLIED");
  }
  if (batch.status === LandedCostBatchStatus.CANCELLED) {
    throw new AppError("هذه الدفعة ملغاة", 409, "BATCH_CANCELLED");
  }

  const pendingBlocking = batch.items.filter(
    (it) => it.action === LandedCostItemAction.PENDING
  );
  if (pendingBlocking.length > 0) {
    const names = pendingBlocking
      .slice(0, 10)
      .map((it) => it.productName || it.itemCode || "بدون اسم")
      .join("، ");
    const more = pendingBlocking.length > 10 ? ` و ${pendingBlocking.length - 10} صنف آخر` : "";
    throw new AppError(
      `يوجد ${pendingBlocking.length} صنف بحاجة لقرار (ربط بمادة / إنشاء مادة جديدة / تخطي) قبل التأكيد: ${names}${more}`,
      400,
      "UNRESOLVED_ITEMS"
    );
  }

  const zeroQty = batch.items.find((it) => it.action !== LandedCostItemAction.SKIP && it.quantity <= 0);
  if (zeroQty) {
    throw new AppError(`الصنف "${zeroQty.productName}" له كمية صفر أو غير صحيحة — تخطّه أو صحّح الكمية قبل التأكيد`, 400, "INVALID_QUANTITY");
  }

  // Atomically claim the batch by flipping its status now that every
  // validation above has passed, still inside this same transaction. Postgres
  // holds a row lock on this UPDATE for the rest of the transaction, so a
  // second concurrent confirm (double-click, or two admins confirming the
  // same batch at once) blocks until this one commits/rolls back, then sees
  // status already PURCHASE_INVOICE_CREATED and gets count 0 — preventing two
  // purchase invoices ever being created from one batch. If anything below
  // throws, the whole transaction (including this claim) rolls back, so a
  // failed confirm never leaves the batch falsely "applied".
  const claim = await tx.landedCostImportBatch.updateMany({
    where: { id: batchId, status: { notIn: [LandedCostBatchStatus.PURCHASE_INVOICE_CREATED, LandedCostBatchStatus.CANCELLED] } },
    data: { status: LandedCostBatchStatus.PURCHASE_INVOICE_CREATED },
  });
  if (claim.count === 0) {
    // Lost a race against a concurrent confirm that landed between our read and this claim.
    throw new AppError("تم بالفعل إنشاء فاتورة شراء من هذه الدفعة", 409, "ALREADY_APPLIED");
  }

  {
    const warnings: string[] = [];
    let linkedCount = 0;
    let createdCount = 0;
    let skippedCount = 0;
    let totalStockAdded = 0;

    const invoiceItems: { productId: string; unit: Unit; quantity: number; unitPrice: number }[] = [];
    const costOverwrites: { productId: string; costPrice: number; purchasePrice: number }[] = [];

    for (const item of batch.items) {
      if (item.action === LandedCostItemAction.SKIP) {
        skippedCount++;
        continue;
      }

      let productId = item.productId;

      if (item.action === LandedCostItemAction.CREATE_NEW) {
        const draft = (item.newProductDraft as { name?: string; itemCode?: string; barcode?: string; category?: string; pcsPerCarton?: number; imageUrl?: string } | null) ?? {};
        const confirmedSalePrice = item.confirmedSalePrice != null ? Number(item.confirmedSalePrice) : null;
        if (confirmedSalePrice == null) {
          throw new AppError(`سعر البيع مطلوب لإنشاء المادة "${item.productName}"`, 400, "SALE_PRICE_REQUIRED");
        }
        const created = await createProduct(
          {
            itemNumber: draft.itemCode || item.itemCode || undefined,
            name: draft.name || item.productName,
            imageUrl: draft.imageUrl || null,
            category: draft.category,
            purchasePrice: Number(item.purchasePrice),
            costPrice: Number(item.landedCostPerUnit),
            salePrice: confirmedSalePrice,
            pcsPerCarton: draft.pcsPerCarton || (item.cartonCount && item.cartonCount > 0 ? Math.round(item.quantity / item.cartonCount) : undefined),
            // Stock is added by the purchase invoice below, not here.
            openingBalancePcs: 0,
            branchId: opts.warehouseId,
          },
          userId,
          tx,
          { id: userId, name: userName }
        );
        productId = created.id;
        createdCount++;
        // The purchase invoice created below runs its own weighted-average-cost
        // update on this product. For a brand-new product (zero prior stock)
        // that average collapses to the raw purchase price and would silently
        // erase the landed cost we just set via createProduct — so re-assert it
        // after createInvoice runs, same as the LINK_EXISTING overwrite below.
        costOverwrites.push({ productId, costPrice: Number(item.landedCostPerUnit), purchasePrice: Number(item.purchasePrice) });
      } else {
        // LINK_EXISTING
        if (!productId) {
          throw new AppError(`الصنف "${item.productName}" بحاجة لمادة مرتبطة`, 400, "PRODUCT_REQUIRED");
        }
        linkedCount++;
        // Overwrite cost/purchase price directly with the true landed cost —
        // applied AFTER createInvoice below so it supersedes that invoice's
        // own weighted-average update (explicit decision: overwrite, not blend).
        costOverwrites.push({ productId, costPrice: Number(item.landedCostPerUnit), purchasePrice: Number(item.purchasePrice) });
      }

      invoiceItems.push({ productId: productId!, unit: Unit.PIECE, quantity: item.quantity, unitPrice: Number(item.purchasePrice) });
      totalStockAdded += item.quantity;
    }

    if (invoiceItems.length === 0) {
      throw new AppError("لا يوجد أي صنف صالح لإنشاء فاتورة شراء (الكل تم تخطيه)", 400, "NOTHING_TO_APPLY");
    }

    const invoice = await createInvoice(
      {
        customerId: opts.supplierCustomerId,
        type: InvoiceType.PURCHASE,
        discount: 0,
        tax: 0,
        paidAmount: opts.paidAmount ?? 0,
        paymentType: opts.paymentType ?? PaymentType.CREDIT,
        branchId: opts.warehouseId,
        notes: `فاتورة شراء من استيراد كلفة مسعّرة${batch.invoiceNumber ? ` — ${batch.invoiceNumber}` : ""}`,
        items: invoiceItems,
      },
      userId,
      tx
    );

    for (const ov of costOverwrites) {
      await tx.product.update({ where: { id: ov.productId }, data: { costPrice: ov.costPrice, purchasePrice: ov.purchasePrice } });
      await tx.auditLog.create({
        data: {
          userId,
          action: "LANDED_COST_PRODUCT_COST_UPDATED",
          entity: "Product",
          recordId: ov.productId,
          metadata: { costPrice: ov.costPrice, purchasePrice: ov.purchasePrice, batchId } as Prisma.InputJsonValue,
        },
      });
    }

    await tx.landedCostImportBatch.update({
      where: { id: batchId },
      data: {
        status: LandedCostBatchStatus.PURCHASE_INVOICE_CREATED,
        purchaseInvoiceId: (invoice as { id: string }).id,
        appliedBy: userId,
        appliedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: "LANDED_COST_APPLY",
        entity: "LandedCostImportBatch",
        recordId: batchId,
        metadata: {
          purchaseInvoiceId: (invoice as { id: string }).id,
          linkedCount,
          createdCount,
          skippedCount,
          totalStockAdded,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      purchaseInvoiceId: (invoice as { id: string; invoiceNumber: string }).id,
      invoiceNumber: (invoice as { id: string; invoiceNumber: string }).invoiceNumber,
      linkedCount,
      createdCount,
      skippedCount,
      totalStockAdded,
      warnings,
    };
  }
}
