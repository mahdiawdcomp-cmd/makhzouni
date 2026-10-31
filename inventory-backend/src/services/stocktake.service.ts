import { randomBytes } from "crypto";
import { InvoiceType, LossReason, PaymentType, Prisma, StockMovementType, StocktakeApprovalStatus, StocktakeSessionStatus, Unit } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { adjustWarehouseStock, resolveShopWarehouseId, resolveWarehouseId, syncProductTotalStock } from "./warehouse-stock.service";
import { recordStockAdjustmentVariance } from "./stock-loss.service";
import { createInvoice } from "./invoice.service";
import { getOrCreateWalkInCustomer } from "./customer.service";
import { getSettings } from "./settings.service";
import { logger } from "../utils/logger";

type Db = Prisma.TransactionClient | typeof prisma;

// How an admin chooses to resolve a counted variance at approval time:
//  - LOSS      : the current behaviour — book a StockLoss (shortage reduces
//                profit, overage adds to it) and adjust stock directly.
//  - SALE      : a shortage is treated as an unrecorded cash sale → a real SALE
//                invoice to «الزبون النقدي» at sale price. Captures the revenue
//                instead of writing the goods off. Shortages only.
//  - PURCHASE  : an overage is treated as an unrecorded purchase → a real
//                PURCHASE invoice to the tenant's configured overage supplier at
//                cost. Overages only.
// The SALE/PURCHASE paths route through createInvoice (same proven stock +
// ledger + profit path as every other invoice) instead of adjustWarehouseStock,
// so stock is moved exactly once and all reports stay consistent.
export type StocktakeResolution = "LOSS" | "SALE" | "PURCHASE";

/**
 * Resolves a single item's variance as a real cash invoice inside the caller's
 * transaction. Returns the created invoice so the item can keep a trace of it.
 * deltaPieces < 0 → shortage (SALE), deltaPieces > 0 → overage (PURCHASE).
 */
async function resolveVarianceViaInvoice(
  tx: Prisma.TransactionClient,
  opts: {
    resolution: "SALE" | "PURCHASE";
    productId: string;
    warehouseId: string;
    deltaPieces: number;
    salePrice: number;
    unitCost: number;
    createdBy: string;
    sessionId: string;
  },
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const qty = Math.abs(opts.deltaPieces);
  if (qty <= 0) throw new AppError("لا يوجد فرق لتسويته كفاتورة", 400, "NO_VARIANCE");

  if (opts.resolution === "SALE") {
    if (opts.deltaPieces > 0) throw new AppError("البيع النقدي يصلح للنقص فقط", 400, "SALE_REQUIRES_SHORTAGE");
    const unitPrice = opts.salePrice;
    if (!(unitPrice > 0)) throw new AppError("لا يوجد سعر بيع لهذه المادة — عدّل السعر أو اختر «هالك»", 400, "NO_SALE_PRICE");
    const walkIn = await getOrCreateWalkInCustomer();
    const inv = await createInvoice(
      {
        customerId: walkIn.id,
        type: InvoiceType.SALE,
        discount: 0,
        tax: 0,
        paidAmount: qty * unitPrice,
        paymentType: PaymentType.CASH,
        branchId: opts.warehouseId,
        origin: "STOCK_COUNT",
        notes: `تسوية جرد دوري — بيع نقص غير مسجّل (جلسة ${opts.sessionId})`,
        items: [{ productId: opts.productId, warehouseId: opts.warehouseId, unit: Unit.PIECE, quantity: qty, unitPrice, allowNegativeStock: true }],
      },
      opts.createdBy,
      tx,
    );
    return { invoiceId: inv.id, invoiceNumber: String(inv.invoiceNumber ?? inv.id) };
  }

  // PURCHASE — overage
  if (opts.deltaPieces < 0) throw new AppError("الشراء يصلح للزيادة فقط", 400, "PURCHASE_REQUIRES_OVERAGE");
  const settings = await getSettings();
  const supplierId = settings.stocktakeOverageSupplierId?.trim();
  if (!supplierId) throw new AppError("حدّد مورّد فائض الجرد من إعدادات الجرد أولاً", 400, "NO_OVERAGE_SUPPLIER");
  const unitPrice = opts.unitCost;
  if (!(unitPrice > 0)) throw new AppError("لا توجد كلفة لهذه المادة — عدّل الكلفة أو اختر «تسوية»", 400, "NO_COST_PRICE");
  const inv = await createInvoice(
    {
      customerId: supplierId,
      type: InvoiceType.PURCHASE,
      discount: 0,
      tax: 0,
      paidAmount: qty * unitPrice,
      paymentType: PaymentType.CASH,
      branchId: opts.warehouseId,
      origin: "STOCK_COUNT",
      notes: `تسوية جرد دوري — شراء زيادة غير مسجّلة (جلسة ${opts.sessionId})`,
      items: [{ productId: opts.productId, warehouseId: opts.warehouseId, unit: Unit.PIECE, quantity: qty, unitPrice }],
    },
    opts.createdBy,
    tx,
  );
  return { invoiceId: inv.id, invoiceNumber: String(inv.invoiceNumber ?? inv.id) };
}

function makeToken() {
  return `stk_${randomBytes(24).toString("base64url")}`;
}

// ─── Admin: Create session ────────────────────────────────────────────────────

export async function createStocktakeSession(
  createdBy: string,
  branchId?: string,
  notes?: string,
) {
  // When the admin leaves the warehouse picker on the default ("المخزن الرئيسي"
  // = empty value), resolve to the configured SHOP warehouse — NOT the oldest
  // active branch. resolveWarehouseId(null) returns the oldest branch, which on
  // a multi-warehouse tenant is often a depot that holds stock rows for only a
  // few products, so the session came out nearly empty while the shop's real
  // stock lived in a different branch. Only fall back to resolveWarehouseId when
  // no shop warehouse can be determined at all.
  const warehouseId = branchId
    ? await resolveWarehouseId(prisma, branchId)
    : await resolveShopWarehouseId(prisma);
  const stocks = await prisma.productWarehouseStock.findMany({
    where: { warehouseId, product: { deletedAt: null } },
    // Only id/name are snapshotted into stocktakeItem below — a full include
    // pulls every product's base64 image for the whole warehouse catalog.
    include: { product: { select: { id: true, name: true } } },
    orderBy: [{ product: { category: "asc" } }, { product: { name: "asc" } }],
  });

  if (stocks.length === 0)
    throw new AppError("لا توجد منتجات لإنشاء جلسة جرد", 400, "NO_PRODUCTS");

  // Session creation writes one StocktakeItem per product in the warehouse —
  // thousands of rows for a real catalogue, well past Prisma's 5s default.
  return prisma.$transaction(async (tx) => {
    const session = await tx.stocktakeSession.create({
      data: {
        publicToken: makeToken(),
        createdBy,
        branchId: warehouseId,
        notes,
        status: StocktakeSessionStatus.OPEN,
      },
    });

    await tx.stocktakeItem.createMany({
      data: stocks.map((stock) => ({
        sessionId: session.id,
        productId: stock.product.id,
        productName: stock.product.name,
        systemQty: stock.quantityPieces,
        actualQty: null,
        variance: null,
      })),
    });

    return session;
  });
}

// ─── Admin: List sessions ─────────────────────────────────────────────────────

export async function listStocktakeSessions() {
  const sessions = await prisma.stocktakeSession.findMany({
    where: { archivedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      creator: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
  });

  return sessions.map((s) => ({
    id: s.id,
    publicToken: s.publicToken,
    status: s.status,
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
    closedAt: s.closedAt?.toISOString() ?? null,
    creator: s.creator,
    branch: s.branch,
    itemCount: s._count.items,
  }));
}

// ─── Admin: Get session with results (errors first) ──────────────────────────

export async function getStocktakeSession(id: string) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      items: {
        include: {
          product: {
            // imageUrl is intentionally NOT selected — it can be a heavy base64
            // string and nothing in the mapped result below uses it. Pulling it
            // dragged the whole warehouse catalog's images into every session read.
            select: { id: true, name: true, category: true, costPrice: true, purchasePrice: true },
          },
        },
      },
    },
  });

  if (!session) throw new AppError("جلسة الجرد غير موجودة", 404, "SESSION_NOT_FOUND");

  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Resolve reviewer ids → names in one query (who approved/rejected each item).
  const reviewerIds = [...new Set(session.items.map((i) => i.reviewedBy).filter((x): x is string => Boolean(x)))];
  const reviewers = reviewerIds.length
    ? await prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, name: true } })
    : [];
  const reviewerName = new Map(reviewers.map((u) => [u.id, u.name]));

  const items = session.items.map((item) => {
    // Same cost basis recordStockAdjustmentVariance books on approval:
    // costPrice, falling back to purchasePrice.
    const cost = Number(item.product.costPrice ?? 0);
    const unitCost = cost > 0 ? cost : Number(item.product.purchasePrice ?? 0);
    return {
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      category: item.product.category,
      systemQty: item.systemQty,
      actualQty: item.actualQty,
      variance: item.variance,
      notes: item.notes,
      approvalStatus: item.approvalStatus ?? StocktakeApprovalStatus.PENDING,
      hasError: item.variance !== null && item.variance !== 0,
      unitCost,
      varianceValue: item.variance !== null ? round2(item.variance * unitCost) : null,
      reviewedByName: item.reviewedBy ? reviewerName.get(item.reviewedBy) ?? null : null,
      reviewedAt: item.reviewedAt?.toISOString() ?? null,
      rejectReason: item.rejectReason ?? null,
    };
  });

  // Sort: errors first, then uncounted, then matching
  items.sort((a, b) => {
    if (a.hasError && !b.hasError) return -1;
    if (!a.hasError && b.hasError) return 1;
    if (a.actualQty === null && b.actualQty !== null) return 1;
    if (a.actualQty !== null && b.actualQty === null) return -1;
    return a.productName.localeCompare(b.productName);
  });

  const filled = items.filter((i) => i.actualQty !== null).length;
  const errors = items.filter((i) => i.hasError).length;
  let shortageValue = 0;
  let overageValue = 0;
  for (const i of items) {
    if (i.varianceValue === null) continue;
    if (i.varianceValue < 0) shortageValue -= i.varianceValue;
    else overageValue += i.varianceValue;
  }

  return {
    id: session.id,
    publicToken: session.publicToken,
    status: session.status,
    notes: session.notes,
    createdAt: session.createdAt.toISOString(),
    closedAt: session.closedAt?.toISOString() ?? null,
    creator: session.creator,
    branch: session.branch,
    stats: {
      total: items.length,
      filled,
      errors,
      shortageValue: round2(shortageValue),
      overageValue: round2(overageValue),
      netVarianceValue: round2(overageValue - shortageValue),
    },
    items,
  };
}

export async function closeStocktakeSession(sessionId: string, closedBy?: string, force = false) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { id: sessionId },
    include: { items: { select: { approvalStatus: true, actualQty: true } } },
  });
  if (!session) throw new AppError("جلسة الجرد غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status === StocktakeSessionStatus.CLOSED) throw new AppError("الجلسة مغلقة بالفعل", 400, "ALREADY_CLOSED");

  // Guard against silently closing a session that still has counted-but-unreviewed
  // variances — mirrors the identical guard on closeCycleCountSession.
  const unresolvedCount = session.items.filter(
    (i) => (i.approvalStatus ?? StocktakeApprovalStatus.PENDING) === StocktakeApprovalStatus.PENDING && i.actualQty !== null,
  ).length;
  if (unresolvedCount > 0 && !force) {
    throw new AppError(
      `توجد ${unresolvedCount} فروقات لم تتم مراجعتها بعد — راجعها أو ارفضها قبل إغلاق الجلسة`,
      400,
      "UNRESOLVED_ITEMS",
    );
  }
  if (unresolvedCount > 0 && force) {
    logger.warn(`[stocktake] closing session ${sessionId} with ${unresolvedCount} unresolved item(s) (force=true)`);
  }

  await prisma.stocktakeSession.update({
    where: { id: sessionId },
    data: { status: StocktakeSessionStatus.CLOSED, closedAt: new Date(), closedBy: closedBy ?? null },
  });

  const closed = await getStocktakeSession(sessionId);
  return { ...closed, unresolvedCount };
}

// ─── Admin: Archive session (soft-delete) ────────────────────────────────────
// Hides the session from the admin list. Never reverts approved quantities and
// never deletes StockMovement rows.
export async function archiveStocktakeSession(sessionId: string, force = false) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { id: sessionId },
    include: { items: { select: { approvalStatus: true, actualQty: true } } },
  });
  if (!session) throw new AppError("جلسة الجرد غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.archivedAt) throw new AppError("الجلسة مؤرشفة بالفعل", 400, "ALREADY_ARCHIVED");

  // Archiving only hides the session from listStocktakeSessions — it never
  // resolves pending variances. Without this guard an OPEN/SUBMITTED session
  // with unreviewed discrepancies could vanish from admin visibility with no
  // warning, exactly like closeStocktakeSession's guard already prevents.
  const unresolvedCount = session.items.filter(
    (i) => (i.approvalStatus ?? StocktakeApprovalStatus.PENDING) === StocktakeApprovalStatus.PENDING && i.actualQty !== null,
  ).length;
  if (unresolvedCount > 0 && !force) {
    throw new AppError(
      `توجد ${unresolvedCount} فروقات لم تتم مراجعتها بعد — راجعها أو أرسل force لأرشفة الجلسة رغم ذلك`,
      400,
      "UNRESOLVED_ITEMS",
    );
  }
  if (unresolvedCount > 0 && force) {
    logger.warn(`[stocktake] archiving session ${sessionId} with ${unresolvedCount} unresolved item(s) (force=true)`);
  }

  await prisma.stocktakeSession.update({
    where: { id: sessionId },
    data: { archivedAt: new Date() },
  });

  return { success: true, unresolvedCount };
}

// ─── Public (worker): Close session via token ────────────────────────────────
export async function closePublicStocktake(token: string) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { publicToken: token },
    select: {
      id: true,
      status: true,
      items: { select: { actualQty: true, approvalStatus: true } },
    },
  });
  if (!session) throw new AppError("الرابط غير صحيح", 404, "SESSION_NOT_FOUND");
  // The worker's "I'm done" only ever hands the count to the admin (OPEN →
  // SUBMITTED). Closing is an admin decision — a worker-closed session used to
  // discard every unreviewed variance.
  const unresolvedCount = session.items.filter(
    (i) =>
      i.actualQty !== null &&
      (i.approvalStatus ?? StocktakeApprovalStatus.PENDING) === StocktakeApprovalStatus.PENDING,
  ).length;
  if (session.status === StocktakeSessionStatus.SUBMITTED)
    return { success: true, status: "SUBMITTED" as const, unresolvedCount };
  if (session.status !== StocktakeSessionStatus.OPEN)
    throw new AppError("الجلسة مغلقة بالفعل", 400, "ALREADY_CLOSED");
  await prisma.stocktakeSession.updateMany({
    where: { id: session.id, status: StocktakeSessionStatus.OPEN },
    data: { status: StocktakeSessionStatus.SUBMITTED },
  });
  return { success: true, status: "SUBMITTED" as const, unresolvedCount };
}

// ─── Admin: Update a single item quantity ────────────────────────────────────

export async function updateStocktakeItem(
  sessionId: string,
  productId: string,
  actualQty: number,
  notes?: string,
) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, branchId: true },
  });
  if (!session) throw new AppError("جلسة الجرد غير موجودة", 404, "SESSION_NOT_FOUND");
  // Only an OPEN session accepts admin edits — once SUBMITTED it is under review
  // (approve/reject per item), so editing quantities underneath that review would
  // desync the variances being approved. Reopen the session first. Mirrors
  // updateCycleCountItem's OPEN-only guard.
  if (session.status !== StocktakeSessionStatus.OPEN)
    throw new AppError("الجلسة ليست مفتوحة للتعديل — أعد فتحها أولاً", 400, "SESSION_NOT_OPEN");

  const item = await prisma.stocktakeItem.findFirst({
    where: { sessionId, productId },
  });
  if (!item) throw new AppError("المنتج غير موجود في الجلسة", 404, "ITEM_NOT_FOUND");
  if ((item.approvalStatus ?? StocktakeApprovalStatus.PENDING) !== StocktakeApprovalStatus.PENDING)
    throw new AppError("هذه المادة تمت مراجعتها", 400, "ITEM_REVIEWED");

  // Re-read the live balance at count time, exactly as the cycle-count worker
  // path does, so the variance the admin reviews reflects reality rather than
  // the snapshot taken when the session was opened.
  const liveStock = session.branchId
    ? await prisma.productWarehouseStock.findUnique({
        where: {
          productId_warehouseId: { productId, warehouseId: session.branchId },
        },
        select: { quantityPieces: true },
      })
    : null;
  const systemQty = liveStock?.quantityPieces ?? 0;
  const variance = systemQty !== null ? actualQty - systemQty : null;

  await prisma.stocktakeItem.update({
    where: { id: item.id },
    data: { actualQty, systemQty, variance, ...(notes !== undefined ? { notes } : {}) },
  });

  return { productId, actualQty, variance };
}

// ─── Admin: Submit session (calculate variances) ─────────────────────────────

export async function submitStocktakeSession(sessionId: string) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { id: sessionId },
    include: { items: true },
  });
  if (!session) throw new AppError("جلسة الجرد غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status !== StocktakeSessionStatus.OPEN) throw new AppError("الجلسة ليست مفتوحة", 400, "SESSION_NOT_OPEN");

  await prisma.$transaction(async (tx) => {
    const claim = await tx.stocktakeSession.updateMany({
      where: { id: sessionId, status: StocktakeSessionStatus.OPEN },
      data: { status: StocktakeSessionStatus.SUBMITTED },
    });
    if (claim.count !== 1) throw new AppError("الجلسة تغيّرت حالتها — حدّث الصفحة", 409, "SESSION_NOT_OPEN");
    for (const item of session.items) {
      if (item.actualQty !== null && (item.approvalStatus ?? StocktakeApprovalStatus.PENDING) === StocktakeApprovalStatus.PENDING) {
        await tx.stocktakeItem.update({
          where: { id: item.id },
          data: { variance: item.actualQty - (item.systemQty ?? 0) },
        });
      }
    }
  });

  return getStocktakeSession(sessionId);
}

// ─── Public (worker): Get session via token ───────────────────────────────────

export async function getPublicSession(token: string) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { publicToken: token },
    include: {
      branch: { select: { name: true } },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              itemNumber: true,
              category: true,
              qrCode: true,
              cartonQrCode: true,
              pcsPerCarton: true,
            },
          },
        },
        orderBy: [{ product: { category: "asc" } }, { productName: "asc" }],
      },
    },
  });

  if (!session) throw new AppError("الرابط غير صحيح أو منتهي", 404, "SESSION_NOT_FOUND");

  return {
    id: session.id,
    status: session.status,
    notes: session.notes,
    branch: session.branch,
    createdAt: session.createdAt.toISOString(),
    // systemQty is HIDDEN from workers
    items: session.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      // Lets the worker search by the code printed on the shelf/carton.
      itemNumber: item.product.itemNumber,
      category: item.product.category,
      qrCode: item.product.qrCode,
      cartonQrCode: item.product.cartonQrCode,
      pcsPerCarton: item.product.pcsPerCarton,
      actualQty: item.actualQty,   // show what worker entered so far
      notes: item.notes,
    })),
  };
}

// ─── Public (worker): Scan a QR code — increments carton count by 1 ──────────

export async function scanQrCode(token: string, qrCode: string) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { publicToken: token },
    select: { id: true, status: true, branchId: true },
  });
  if (!session) throw new AppError("الرابط غير صحيح", 404, "SESSION_NOT_FOUND");
  // Only an OPEN session takes worker writes — once submitted the admin is
  // reviewing, and a late scan would move numbers under their decisions.
  if (session.status !== StocktakeSessionStatus.OPEN)
    throw new AppError("الجرد مرفوع للمراجعة أو مغلق — ما تكدر تعدّل", 400, "SESSION_NOT_OPEN");

  // Find product by qrCode OR cartonQrCode
  const product = await prisma.product.findFirst({
    where: {
      OR: [
        { qrCode: qrCode.trim() },
        { cartonQrCode: qrCode.trim() },
      ],
      deletedAt: null,
    },
  });

  if (!product)
    throw new AppError("لم يُعثر على منتج بهذا الباركود", 404, "PRODUCT_NOT_FOUND");

  const item = await prisma.stocktakeItem.findFirst({
    where: { sessionId: session.id, productId: product.id },
  });

  if (!item)
    throw new AppError("هذا المنتج ليس ضمن قائمة الجرد", 404, "ITEM_NOT_IN_SESSION");
  if ((item.approvalStatus ?? StocktakeApprovalStatus.PENDING) !== StocktakeApprovalStatus.PENDING)
    throw new AppError("هذه المادة تمت مراجعتها", 400, "ITEM_REVIEWED");

  const isCartonBarcode = product.cartonQrCode === qrCode.trim();
  const increment = isCartonBarcode ? Math.max(1, product.pcsPerCarton) : 1;

  // Same live-refresh fix as setItemQty — see comment there.
  const currentStock = session.branchId
    ? await prisma.productWarehouseStock.findUnique({
        where: { productId_warehouseId: { productId: product.id, warehouseId: session.branchId } },
        select: { quantityPieces: true },
      })
    : null;
  const freshSystemQty = currentStock?.quantityPieces ?? 0;

  // Atomic increment: two fast scans (or two phones) each add their carton
  // instead of both writing "old + 1".
  const rows = await prisma.$queryRaw<{ actual_qty: number }[]>`
    UPDATE stocktake_items
       SET actual_qty = COALESCE(actual_qty, 0) + ${increment},
           system_qty = ${freshSystemQty},
           variance = COALESCE(actual_qty, 0) + ${increment} - ${freshSystemQty}
     WHERE id = ${item.id}::uuid
     RETURNING actual_qty`;
  const newQty = Number(rows[0]?.actual_qty ?? 0);

  return {
    productId: product.id,
    productName: product.name,
    category: product.category,
    newQty,
    increment,
  };
}

// ─── Public (worker): Manual quantity entry ───────────────────────────────────

export async function setItemQty(
  token: string,
  productId: string,
  qty: number,
  unit: "CARTON" | "PIECE",
  _pcsPerCarton: number, // Ignored — read from database instead
) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { publicToken: token },
    select: { id: true, status: true, branchId: true },
  });
  if (!session) throw new AppError("الرابط غير صحيح", 404, "SESSION_NOT_FOUND");
  // Only an OPEN session takes worker writes — once submitted the admin is
  // reviewing, and a late scan would move numbers under their decisions.
  if (session.status !== StocktakeSessionStatus.OPEN)
    throw new AppError("الجرد مرفوع للمراجعة أو مغلق — ما تكدر تعدّل", 400, "SESSION_NOT_OPEN");

  const item = await prisma.stocktakeItem.findFirst({
    where: { sessionId: session.id, productId },
    include: { product: { select: { pcsPerCarton: true } } },
  });
  if (!item) throw new AppError("المنتج غير موجود في الجلسة", 404, "ITEM_NOT_FOUND");
  if ((item.approvalStatus ?? StocktakeApprovalStatus.PENDING) !== StocktakeApprovalStatus.PENDING)
    throw new AppError("هذه المادة تمت مراجعتها", 400, "ITEM_REVIEWED");

  // Convert cartons to pieces using the ACTUAL pcsPerCarton from the database
  const actualPcsPerCarton = Math.max(1, item.product.pcsPerCarton);
  const qtyInPieces = unit === "CARTON" ? qty * actualPcsPerCarton : qty;

  // Re-read the LIVE system quantity at count time instead of trusting the
  // value frozen when the session was created — mirrors the cycle-count
  // worker path (setCycleCountItemQty). approveStocktakeItem trusts this
  // stored value verbatim, so it must be accurate as of the physical count,
  // not stale by however long the session sat open. Stays invisible to the
  // worker: only the stored systemQty is refreshed server-side, never
  // exposed in the public response (see getPublicSession).
  const currentStock = session.branchId
    ? await prisma.productWarehouseStock.findUnique({
        where: { productId_warehouseId: { productId, warehouseId: session.branchId } },
        select: { quantityPieces: true },
      })
    : null;
  const freshSystemQty = currentStock?.quantityPieces ?? 0;

  await prisma.stocktakeItem.update({
    where: { id: item.id },
    data: { actualQty: qtyInPieces, systemQty: freshSystemQty, variance: qtyInPieces - freshSystemQty },
  });

  return { productId, actualQty: qtyInPieces, unit, original: qty };
}

// ─── Public (worker): Submit stocktake ───────────────────────────────────────

export async function submitPublicStocktake(token: string) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { publicToken: token },
    include: { items: true },
  });
  if (!session) throw new AppError("الرابط غير صحيح", 404, "SESSION_NOT_FOUND");
  if (session.status === StocktakeSessionStatus.SUBMITTED) return { success: true };
  if (session.status !== StocktakeSessionStatus.OPEN)
    throw new AppError("الجلسة مغلقة بالفعل", 400, "SESSION_CLOSED");

  await prisma.$transaction(async (tx) => {
    const claim = await tx.stocktakeSession.updateMany({
      where: { id: session.id, status: StocktakeSessionStatus.OPEN },
      data: { status: StocktakeSessionStatus.SUBMITTED },
    });
    if (claim.count !== 1) return;
    // Calculate variances (reviewed items keep what was booked)
    for (const item of session.items) {
      if (item.actualQty !== null && (item.approvalStatus ?? StocktakeApprovalStatus.PENDING) === StocktakeApprovalStatus.PENDING) {
        await tx.stocktakeItem.update({
          where: { id: item.id },
          data: { variance: item.actualQty - item.systemQty },
        });
      }
    }
  });

  return { success: true };
}

// ─── Admin: Approve stocktake item (update warehouse stock) ────────────────────

export async function approveStocktakeItem(
  sessionId: string,
  itemId: string,
  approvingUserId: string,
  reason: LossReason,
  resolution: StocktakeResolution = "LOSS",
) {
  return prisma.$transaction(async (tx) => {
    // Serialise with reopen/approve-all on the same session.
    const sid = await tx.stocktakeItem.findUnique({ where: { id: itemId }, select: { sessionId: true } });
    if (sid) await tx.$queryRaw`SELECT id FROM stocktake_sessions WHERE id = ${sid.sessionId}::uuid FOR UPDATE`;
    // Lock the item row for update and re-check approvalStatus (race-safe)
    const item = await tx.stocktakeItem.findUnique({
      where: { id: itemId },
      include: {
        session: { select: { status: true, branchId: true } },
        product: { select: { id: true, name: true, salePrice: true, costPrice: true, purchasePrice: true } },
      },
    });

    if (!item) throw new AppError("عنصر الجرد غير موجود", 404, "ITEM_NOT_FOUND");
    if (item.sessionId !== sessionId) throw new AppError("عدم تطابق الجلسة", 400, "SESSION_MISMATCH");
    if (item.session.status !== StocktakeSessionStatus.SUBMITTED) throw new AppError("الجلسة غير مرسلة بعد", 400, "SESSION_NOT_SUBMITTED");
    if (item.actualQty === null) throw new AppError("لم يتم إدخال الكمية الفعلية", 400, "NO_ACTUAL_QTY");
    if (item.approvalStatus !== StocktakeApprovalStatus.PENDING) throw new AppError("تم الموافقة/الرفض على هذا العنصر بالفعل", 400, "ALREADY_APPROVED");

    if (!item.session.branchId) throw new AppError("المخزن غير محدد للجلسة", 400, "NO_WAREHOUSE");

    // The discrepancy is measured ONCE, against the live balance at the
    // moment of physical counting — setItemQty/scanQrCode (public worker
    // link) and updateStocktakeItem (admin manual entry) all refresh
    // `systemQty` to the live balance right when actualQty is written. Trust
    // that stored value here rather than re-deriving it against whatever the
    // balance happens to be *right now*.
    //
    // Re-deriving here (against a fresh live read at approval time) would
    // fold every legitimate sale/purchase/transfer that happened between the
    // count and this approval into the "discovered" variance. Concretely: the
    // worker's count matches the live balance exactly (zero real
    // discrepancy), a legitimate sale of 20 lands before an admin gets to
    // approving, and re-deriving against the now-lower live balance would
    // book a bogus +20 gain and undo the sale's stock effect entirely.
    //
    // `adjustWarehouseStock` applies `delta` as a pure increment on top of
    // whatever the live balance is right now — which already correctly
    // reflects everything that happened since the count — so the fixed,
    // once-measured delta stays correct no matter how long approval is
    // delayed. This mirrors cycle-count's approveCycleCountItem exactly.
    const delta = item.actualQty - item.systemQty;

    // ── Resolution = SALE / PURCHASE ──────────────────────────────────────────
    // Instead of writing the gap off as a loss/gain, book it as a real cash
    // invoice (shortage → sale to «الزبون النقدي», overage → purchase to the
    // configured supplier). createInvoice moves the stock and the money through
    // the same proven path as every other invoice, so we do NOT call
    // adjustWarehouseStock / recordStockAdjustmentVariance here — the stock is
    // moved exactly once, by the invoice. A zero variance has nothing to sell or
    // buy, so it just approves.
    if (resolution !== "LOSS" && delta !== 0) {
      const inv = await resolveVarianceViaInvoice(tx, {
        resolution,
        productId: item.productId,
        warehouseId: item.session.branchId,
        deltaPieces: delta,
        salePrice: Number(item.product.salePrice ?? 0),
        unitCost: Number(item.product.costPrice ?? 0) || Number(item.product.purchasePrice ?? 0),
        createdBy: approvingUserId,
        sessionId,
      });
      const updatedViaInvoice = await tx.stocktakeItem.updateMany({
        where: { id: itemId, approvalStatus: StocktakeApprovalStatus.PENDING },
        data: {
          approvalStatus: StocktakeApprovalStatus.APPROVED,
          approvedQty: item.actualQty,
          reason: null,
          lossId: null,
          reviewedBy: approvingUserId,
          reviewedAt: new Date(),
          notes: [item.notes, `فاتورة ${resolution === "SALE" ? "بيع" : "شراء"} #${inv.invoiceNumber}`].filter(Boolean).join(" | "),
        },
      });
      if (updatedViaInvoice.count === 0)
        throw new AppError("تم الموافقة/الرفض على هذا العنصر بالفعل", 400, "ALREADY_APPROVED");
      return { success: true, delta, newQty: item.actualQty, invoiceNumber: inv.invoiceNumber };
    }

    // adjustWarehouseStock locks the row and enforces the same negative-floor
    // guard every other stock-mutating path (invoice/transfer/loss) uses.
    // allowNegative:true matches the sale/transfer/cycle-count policy: never
    // block a legitimate correction over a stock discrepancy — a deficit
    // surfaces later instead.
    const { balanceBefore, balanceAfter } = await adjustWarehouseStock(tx, {
      productId: item.productId,
      warehouseId: item.session.branchId,
      deltaPieces: delta,
      allowNegative: true,
    });

    // Refresh the denormalized legacy stock fields (openingBalancePcs /
    // cartonsAvailable) from the canonical warehouse table, exactly like every
    // other stock-mutating path (invoice/transfer/loss) does. totalStock() falls
    // back to these legacy fields for a product with zero warehouse-stock rows,
    // so the inventory-valuation report and dashboard low-stock counts would
    // still go stale after an approval without this.
    if (delta !== 0) await syncProductTotalStock(tx, item.productId);

    // Give the correction a financial trace: wrap the variance in a StockLoss
    // (+ StockLossItem) so it enters net-profit reporting, and record the
    // adjustment in the unified stock-movement ledger so stocktake corrections
    // show up in سجل حركة المخزون like every other stock change.
    let lossId: string | null = null;
    if (delta !== 0) {
      const approver = await tx.user.findUnique({
        where: { id: approvingUserId },
        select: { name: true },
      });
      const recorded = await recordStockAdjustmentVariance(tx, {
        warehouseId: item.session.branchId,
        productId: item.productId,
        productName: item.product.name,
        deltaPieces: delta,
        reason,
        source: "STOCKTAKE",
        createdBy: approvingUserId,
      });
      lossId = recorded.lossId;

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          branchId: item.session.branchId,
          lossId,
          type: delta > 0 ? StockMovementType.IN : StockMovementType.OUT,
          quantity: Math.abs(delta),
          balanceBefore,
          balanceAfter,
          userId: approvingUserId,
          userName: approver?.name ?? null,
          note: "تسوية جرد دوري (موافقة فرق الجرد)",
        },
      });
    }

    // Mark item approved — condition on PENDING closes the race window atomically
    const updated = await tx.stocktakeItem.updateMany({
      where: { id: itemId, approvalStatus: StocktakeApprovalStatus.PENDING },
      data: {
        approvalStatus: StocktakeApprovalStatus.APPROVED,
        approvedQty: item.actualQty,
        reason: delta !== 0 ? reason : null,
        lossId,
        reviewedBy: approvingUserId,
        reviewedAt: new Date(),
      },
    });
    if (updated.count === 0)
      throw new AppError("تم الموافقة/الرفض على هذا العنصر بالفعل", 400, "ALREADY_APPROVED");

    return { success: true, delta, newQty: item.actualQty };
  });
}

// ─── Admin: Reject stocktake item (keep system qty) ───────────────────────────

export async function rejectStocktakeItem(sessionId: string, itemId: string, reviewingUserId?: string, rejectReason?: string) {
  return prisma.$transaction(async (tx) => {
    // Lock the item and re-check approvalStatus (race-safe)
    const item = await tx.stocktakeItem.findUnique({
      where: { id: itemId },
      include: { session: { select: { status: true } } },
    });

    if (!item) throw new AppError("عنصر الجرد غير موجود", 404, "ITEM_NOT_FOUND");
    if (item.sessionId !== sessionId) throw new AppError("عدم تطابق الجلسة", 400, "SESSION_MISMATCH");
    if (item.session.status !== StocktakeSessionStatus.SUBMITTED) throw new AppError("الجلسة غير مرسلة بعد", 400, "SESSION_NOT_SUBMITTED");
    if (item.approvalStatus !== StocktakeApprovalStatus.PENDING) throw new AppError("تم الموافقة/الرفض على هذا العنصر بالفعل", 400, "ALREADY_PROCESSED");

    await tx.stocktakeItem.update({
      where: { id: itemId },
      data: {
        approvalStatus: StocktakeApprovalStatus.REJECTED,
        reviewedBy: reviewingUserId ?? null,
        reviewedAt: new Date(),
        rejectReason: rejectReason?.trim() ? rejectReason.trim().slice(0, 300) : null,
      },
    });

    return { success: true };
  });
}

// ─── Admin: Reopen a SUBMITTED session so it accepts edits again ──────────────
// Already-APPROVED/REJECTED items stay frozen (guarded in approveStocktakeItem /
// rejectStocktakeItem by the SUBMITTED-status check) — only still-PENDING items
// become editable again once the session is OPEN. Mirrors reopenCycleCountSession.

export async function reopenStocktakeSession(sessionId: string) {
  const session = await prisma.stocktakeSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new AppError("جلسة الجرد غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status !== StocktakeSessionStatus.SUBMITTED)
    throw new AppError("يمكن إعادة فتح جلسة مرفوعة فقط", 400, "SESSION_NOT_SUBMITTED");

  // Conditional: an approve-all holding the session lock finishes first, and a
  // session that moved on meanwhile is not silently reopened.
  const r = await prisma.stocktakeSession.updateMany({
    where: { id: sessionId, status: StocktakeSessionStatus.SUBMITTED },
    data: { status: StocktakeSessionStatus.OPEN },
  });
  if (r.count !== 1) throw new AppError("الجلسة تغيّرت حالتها — حدّث الصفحة", 409, "SESSION_NOT_SUBMITTED");

  return getStocktakeSession(sessionId);
}

// ─── Admin: Approve every still-PENDING counted item in one transaction ───────
// Server-side bulk approve — same per-item safety as approveStocktakeItem
// (adjustWarehouseStock + StockLoss + StockMovement + PENDING-guarded updateMany),
// looped inside ONE $transaction so the whole batch is atomic. Mirrors
// approveAllCycleCountItems.

export async function approveAllStocktakeItems(
  sessionId: string,
  approvingUserId: string,
  reason: LossReason,
  // "LOSS" (default): write every variance off as a loss/gain.
  // "SALE_PURCHASE": resolve each shortage as a cash sale and each overage as a
  // cash purchase (same per-item logic as the single-item SALE/PURCHASE path).
  mode: "LOSS" | "SALE_PURCHASE" = "LOSS",
) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { id: sessionId },
    include: { items: { include: { product: { select: { name: true, salePrice: true, costPrice: true, purchasePrice: true } } } } },
  });
  if (!session) throw new AppError("جلسة الجرد غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status !== StocktakeSessionStatus.SUBMITTED)
    throw new AppError("الجلسة غير مرسلة بعد", 400, "SESSION_NOT_SUBMITTED");
  if (!session.branchId) throw new AppError("المخزن غير محدد للجلسة", 400, "NO_WAREHOUSE");
  const branchId = session.branchId;

  const approver = await prisma.user.findUnique({ where: { id: approvingUserId }, select: { name: true } });

  // Claim-first: each item flips PENDING → APPROVED before anything is booked,
  // so a double click or a concurrent single approve can never book twice.
  // Invoices are batched: ONE cash sale for shortages, ONE cash purchase for
  // overages (not one invoice per item).
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM stocktake_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
      const fresh = await tx.stocktakeSession.findUnique({ where: { id: sessionId }, select: { status: true } });
      if (fresh?.status !== StocktakeSessionStatus.SUBMITTED)
        throw new AppError("الجلسة تغيّرت حالتها — حدّث الصفحة", 409, "SESSION_NOT_SUBMITTED");

      let approvedCount = 0;
      const saleLines: { itemId: string; productId: string; quantity: number; unitPrice: number; name: string }[] = [];
      const purchaseLines: { itemId: string; productId: string; quantity: number; unitPrice: number; name: string }[] = [];

      for (const item of session.items) {
        if ((item.approvalStatus ?? StocktakeApprovalStatus.PENDING) !== StocktakeApprovalStatus.PENDING) continue;
        if (item.actualQty === null) continue;
        const delta = item.actualQty - item.systemQty;
        const viaInvoice = mode === "SALE_PURCHASE" && delta !== 0;

        const claim = await tx.stocktakeItem.updateMany({
          where: { id: item.id, approvalStatus: StocktakeApprovalStatus.PENDING },
          data: {
            approvalStatus: StocktakeApprovalStatus.APPROVED,
            approvedQty: item.actualQty,
            reason: delta !== 0 && !viaInvoice ? reason : null,
            reviewedBy: approvingUserId,
            reviewedAt: new Date(),
          },
        });
        if (claim.count !== 1) continue;
        approvedCount++;
        if (delta === 0) continue;

        if (viaInvoice) {
          const line = { itemId: item.id, productId: item.productId, quantity: Math.abs(delta), name: item.product.name };
          if (delta < 0) saleLines.push({ ...line, unitPrice: Number(item.product.salePrice ?? 0) });
          else purchaseLines.push({ ...line, unitPrice: Number(item.product.costPrice ?? 0) || Number(item.product.purchasePrice ?? 0) });
          continue;
        }

        const { balanceBefore, balanceAfter } = await adjustWarehouseStock(tx, {
          productId: item.productId,
          warehouseId: branchId,
          deltaPieces: delta,
          allowNegative: true,
        });
        const recorded = await recordStockAdjustmentVariance(tx, {
          warehouseId: branchId,
          productId: item.productId,
          productName: item.product.name,
          deltaPieces: delta,
          reason,
          source: "STOCKTAKE",
          createdBy: approvingUserId,
        });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            branchId,
            lossId: recorded.lossId,
            type: delta > 0 ? StockMovementType.IN : StockMovementType.OUT,
            quantity: Math.abs(delta),
            balanceBefore,
            balanceAfter,
            userId: approvingUserId,
            userName: approver?.name ?? null,
            note: "تسوية جرد دوري (موافقة الكل)",
          },
        });
        await syncProductTotalStock(tx, item.productId);
        await tx.stocktakeItem.update({ where: { id: item.id }, data: { lossId: recorded.lossId } });
      }

      const missing = [
        ...saleLines.filter((l) => !(l.unitPrice > 0)).map((l) => `${l.name} (سعر البيع)`),
        ...purchaseLines.filter((l) => !(l.unitPrice > 0)).map((l) => `${l.name} (الكلفة)`),
      ];
      if (missing.length > 0)
        throw new AppError(`هذه المواد بلا سعر — عدّلها أو اختر «هالك»: ${missing.slice(0, 8).join("، ")}${missing.length > 8 ? "…" : ""}`, 400, "NO_PRICE");

      if (saleLines.length > 0) {
        const walkIn = await getOrCreateWalkInCustomer();
        const inv = await createInvoice(
          {
            customerId: walkIn.id,
            type: InvoiceType.SALE,
            discount: 0,
            tax: 0,
            paidAmount: saleLines.reduce((t, l) => t + l.quantity * l.unitPrice, 0),
            paymentType: PaymentType.CASH,
            branchId,
            origin: "STOCK_COUNT",
            notes: `تسوية جرد — بيع نقص غير مسجّل (جلسة ${sessionId})`,
            items: saleLines.map((l) => ({ productId: l.productId, warehouseId: branchId, unit: Unit.PIECE, quantity: l.quantity, unitPrice: l.unitPrice, allowNegativeStock: true })),
          },
          approvingUserId,
          tx,
        );
        await tx.stocktakeItem.updateMany({ where: { id: { in: saleLines.map((l) => l.itemId) } }, data: { notes: `فاتورة بيع #${String(inv.invoiceNumber ?? inv.id)}` } });
      }
      if (purchaseLines.length > 0) {
        const settings = await getSettings();
        const supplierId = settings.stocktakeOverageSupplierId?.trim();
        if (!supplierId) throw new AppError("حدّد مورّد فائض الجرد من إعدادات الجرد أولاً", 400, "NO_OVERAGE_SUPPLIER");
        const inv = await createInvoice(
          {
            customerId: supplierId,
            type: InvoiceType.PURCHASE,
            discount: 0,
            tax: 0,
            paidAmount: purchaseLines.reduce((t, l) => t + l.quantity * l.unitPrice, 0),
            paymentType: PaymentType.CASH,
            branchId,
            origin: "STOCK_COUNT",
            notes: `تسوية جرد — شراء زيادة غير مسجّلة (جلسة ${sessionId})`,
            items: purchaseLines.map((l) => ({ productId: l.productId, warehouseId: branchId, unit: Unit.PIECE, quantity: l.quantity, unitPrice: l.unitPrice })),
          },
          approvingUserId,
          tx,
        );
        await tx.stocktakeItem.updateMany({ where: { id: { in: purchaseLines.map((l) => l.itemId) } }, data: { notes: `فاتورة شراء #${String(inv.invoiceNumber ?? inv.id)}` } });
      }
      return { success: true, approvedCount };
    },
    { timeout: 300_000, maxWait: 10_000 },
  );
}

// ─── Admin: Reject every still-PENDING counted item — never touches stock ─────

export async function rejectAllStocktakeItems(sessionId: string, reviewingUserId?: string) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { id: sessionId },
    include: { items: { select: { id: true, approvalStatus: true, actualQty: true } } },
  });
  if (!session) throw new AppError("جلسة الجرد غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status !== StocktakeSessionStatus.SUBMITTED)
    throw new AppError("الجلسة غير مرسلة بعد", 400, "SESSION_NOT_SUBMITTED");

  return prisma.$transaction(async (tx) => {
    let rejectedCount = 0;
    for (const item of session.items) {
      if ((item.approvalStatus ?? StocktakeApprovalStatus.PENDING) !== StocktakeApprovalStatus.PENDING) continue;
      if (item.actualQty === null) continue;
      const updated = await tx.stocktakeItem.updateMany({
        where: { id: item.id, approvalStatus: StocktakeApprovalStatus.PENDING },
        data: { approvalStatus: StocktakeApprovalStatus.REJECTED, reviewedBy: reviewingUserId ?? null, reviewedAt: new Date() },
      });
      if (updated.count === 1) rejectedCount++;
    }
    return { success: true, rejectedCount };
  });
}
