import { randomBytes } from "crypto";
import { LossReason, Prisma, StockMovementType, StocktakeApprovalStatus, StocktakeSessionStatus } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { adjustWarehouseStock, resolveWarehouseId, syncProductTotalStock } from "./warehouse-stock.service";
import { recordStockAdjustmentVariance } from "./stock-loss.service";
import { logger } from "../utils/logger";

type Db = Prisma.TransactionClient | typeof prisma;

function makeToken() {
  return `stk_${randomBytes(24).toString("base64url")}`;
}

// ─── Admin: Create session ────────────────────────────────────────────────────

export async function createStocktakeSession(
  createdBy: string,
  branchId?: string,
  notes?: string,
) {
  const warehouseId = await resolveWarehouseId(prisma, branchId);
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
            select: { id: true, name: true, category: true, imageUrl: true },
          },
        },
      },
    },
  });

  if (!session) throw new AppError("جلسة الجرد غير موجودة", 404, "SESSION_NOT_FOUND");

  const items = session.items.map((item) => ({
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
  }));

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

  return {
    id: session.id,
    publicToken: session.publicToken,
    status: session.status,
    notes: session.notes,
    createdAt: session.createdAt.toISOString(),
    closedAt: session.closedAt?.toISOString() ?? null,
    creator: session.creator,
    branch: session.branch,
    stats: { total: items.length, filled, errors },
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
export async function archiveStocktakeSession(sessionId: string) {
  const session = await prisma.stocktakeSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new AppError("جلسة الجرد غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.archivedAt) throw new AppError("الجلسة مؤرشفة بالفعل", 400, "ALREADY_ARCHIVED");

  await prisma.stocktakeSession.update({
    where: { id: sessionId },
    data: { archivedAt: new Date() },
  });

  return { success: true };
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
  if (session.status === StocktakeSessionStatus.CLOSED)
    throw new AppError("الجلسة مغلقة بالفعل", 400, "ALREADY_CLOSED");

  // A worker holding the link could previously jump the session straight to
  // CLOSED. Approval requires SUBMITTED, so every counted variance became
  // permanently unapprovable and the whole count was discarded with no
  // StockLoss/StockMovement trace and no way for the admin to reopen it.
  //
  // When there is anything counted and still unreviewed, "I'm done" means
  // SUBMITTED — hand it to the admin — not CLOSED. Only a session with nothing
  // left to review may be closed from the public link.
  const unresolvedCount = session.items.filter(
    (i) =>
      i.actualQty !== null &&
      (i.approvalStatus ?? StocktakeApprovalStatus.PENDING) === StocktakeApprovalStatus.PENDING,
  ).length;

  if (unresolvedCount > 0) {
    await prisma.stocktakeSession.update({
      where: { id: session.id },
      data: { status: StocktakeSessionStatus.SUBMITTED },
    });
    return { success: true, status: "SUBMITTED" as const, unresolvedCount };
  }

  await prisma.stocktakeSession.update({
    where: { id: session.id },
    data: { status: StocktakeSessionStatus.CLOSED, closedAt: new Date(), closedBy: "PUBLIC_WORKER" },
  });

  return { success: true, status: "CLOSED" as const, unresolvedCount: 0 };
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
  if (session.status === StocktakeSessionStatus.CLOSED) throw new AppError("الجلسة مغلقة", 400, "SESSION_CLOSED");

  const item = await prisma.stocktakeItem.findFirst({
    where: { sessionId, productId },
  });
  if (!item) throw new AppError("المنتج غير موجود في الجلسة", 404, "ITEM_NOT_FOUND");

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
  const systemQty = liveStock?.quantityPieces ?? item.systemQty;
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
  if (session.status === StocktakeSessionStatus.CLOSED) throw new AppError("الجلسة مغلقة بالفعل", 400, "ALREADY_CLOSED");

  await prisma.$transaction(async (tx) => {
    for (const item of session.items) {
      if (item.actualQty !== null) {
        await tx.stocktakeItem.update({
          where: { id: item.id },
          data: { variance: item.actualQty - (item.systemQty ?? 0) },
        });
      }
    }
    await tx.stocktakeSession.update({
      where: { id: sessionId },
      data: { status: StocktakeSessionStatus.SUBMITTED },
    });
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
    select: { id: true, status: true },
  });
  if (!session) throw new AppError("الرابط غير صحيح", 404, "SESSION_NOT_FOUND");
  if (session.status === StocktakeSessionStatus.CLOSED) throw new AppError("الجلسة مغلقة", 400, "SESSION_CLOSED");

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

  const isCartonBarcode = product.cartonQrCode === qrCode.trim();
  const increment = isCartonBarcode ? Math.max(1, product.pcsPerCarton) : 1;
  const newQty = (item.actualQty ?? 0) + increment;

  await prisma.stocktakeItem.update({
    where: { id: item.id },
    data: { actualQty: newQty },
  });

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
    select: { id: true, status: true },
  });
  if (!session) throw new AppError("الرابط غير صحيح", 404, "SESSION_NOT_FOUND");
  if (session.status === StocktakeSessionStatus.CLOSED) throw new AppError("الجلسة مغلقة", 400, "SESSION_CLOSED");

  const item = await prisma.stocktakeItem.findFirst({
    where: { sessionId: session.id, productId },
    include: { product: { select: { pcsPerCarton: true } } },
  });
  if (!item) throw new AppError("المنتج غير موجود في الجلسة", 404, "ITEM_NOT_FOUND");

  // Convert cartons to pieces using the ACTUAL pcsPerCarton from the database
  const actualPcsPerCarton = Math.max(1, item.product.pcsPerCarton);
  const qtyInPieces = unit === "CARTON" ? qty * actualPcsPerCarton : qty;

  await prisma.stocktakeItem.update({
    where: { id: item.id },
    data: { actualQty: qtyInPieces },
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
  if (session.status === StocktakeSessionStatus.CLOSED)
    throw new AppError("الجلسة مغلقة بالفعل", 400, "SESSION_CLOSED");

  await prisma.$transaction(async (tx) => {
    // Calculate variances
    for (const item of session.items) {
      if (item.actualQty !== null) {
        await tx.stocktakeItem.update({
          where: { id: item.id },
          data: { variance: item.actualQty - item.systemQty },
        });
      }
    }
    await tx.stocktakeSession.update({
      where: { id: session.id },
      data: { status: StocktakeSessionStatus.SUBMITTED },
    });
  });

  return { success: true };
}

// ─── Admin: Approve stocktake item (update warehouse stock) ────────────────────

export async function approveStocktakeItem(
  sessionId: string,
  itemId: string,
  approvingUserId: string,
  reason: LossReason,
) {
  return prisma.$transaction(async (tx) => {
    // Lock the item row for update and re-check approvalStatus (race-safe)
    const item = await tx.stocktakeItem.findUnique({
      where: { id: itemId },
      include: {
        session: { select: { status: true, branchId: true } },
        product: { select: { id: true, name: true } },
      },
    });

    if (!item) throw new AppError("عنصر الجرد غير موجود", 404, "ITEM_NOT_FOUND");
    if (item.sessionId !== sessionId) throw new AppError("عدم تطابق الجلسة", 400, "SESSION_MISMATCH");
    if (item.session.status !== StocktakeSessionStatus.SUBMITTED) throw new AppError("الجلسة غير مرسلة بعد", 400, "SESSION_NOT_SUBMITTED");
    if (item.actualQty === null) throw new AppError("لم يتم إدخال الكمية الفعلية", 400, "NO_ACTUAL_QTY");
    if (item.approvalStatus !== StocktakeApprovalStatus.PENDING) throw new AppError("تم الموافقة/الرفض على هذا العنصر بالفعل", 400, "ALREADY_APPROVED");

    if (!item.session.branchId) throw new AppError("المخزن غير محدد للجلسة", 400, "NO_WAREHOUSE");

    // Measure the variance against the LIVE balance, not the snapshot frozen
    // when the session was created. A physical count asserts "the shelf holds
    // exactly N" — applying `actualQty - staleSystemQty` as an increment
    // double-counts every sale made between session creation and approval.
    // Concretely: snapshot 100, a sale of 30 drops the balance to 70, the
    // worker correctly counts 70, variance reads −30, and approval drives the
    // balance to 40 while booking a bogus 30-piece loss against net profit.
    //
    // `item.systemQty` remains the fallback only when there is no warehouse row
    // yet (legacy product never stocked in this warehouse).
    const liveStock = await tx.productWarehouseStock.findUnique({
      where: {
        productId_warehouseId: {
          productId: item.productId,
          warehouseId: item.session.branchId,
        },
      },
      select: { quantityPieces: true },
    });
    const baselineQty = liveStock?.quantityPieces ?? item.systemQty ?? 0;
    const delta = item.actualQty - baselineQty;

    // Keep the audit row consistent with what is actually being applied, so the
    // reviewed variance and the resulting StockMovement/StockLoss agree.
    if (baselineQty !== item.systemQty || delta !== item.variance) {
      await tx.stocktakeItem.update({
        where: { id: item.id },
        data: { systemQty: baselineQty, variance: delta },
      });
    }

    // adjustWarehouseStock locks the row and enforces the same negative-floor
    // guard every other stock-mutating path (invoice/transfer/loss) uses — the
    // raw increment update this replaced had no such guard. allowNegative:true
    // matches the sale/transfer/cycle-count policy: never block a legitimate
    // correction over a stock discrepancy — a deficit surfaces later instead.
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
      },
    });
    if (updated.count === 0)
      throw new AppError("تم الموافقة/الرفض على هذا العنصر بالفعل", 400, "ALREADY_APPROVED");

    return { success: true, delta, newQty: item.actualQty };
  });
}

// ─── Admin: Reject stocktake item (keep system qty) ───────────────────────────

export async function rejectStocktakeItem(sessionId: string, itemId: string) {
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
      data: { approvalStatus: StocktakeApprovalStatus.REJECTED },
    });

    return { success: true };
  });
}
