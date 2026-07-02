import { randomBytes } from "crypto";
import { Prisma, StockMovementType, StocktakeApprovalStatus, StocktakeSessionStatus } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { resolveWarehouseId } from "./warehouse-stock.service";

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
    include: { product: true },
    orderBy: [{ product: { category: "asc" } }, { product: { name: "asc" } }],
  });

  if (stocks.length === 0)
    throw new AppError("لا توجد منتجات لإنشاء جلسة جرد", 400, "NO_PRODUCTS");

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

export async function closeStocktakeSession(sessionId: string, closedBy?: string) {
  const session = await prisma.stocktakeSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new AppError("جلسة الجرد غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status === StocktakeSessionStatus.CLOSED) throw new AppError("الجلسة مغلقة بالفعل", 400, "ALREADY_CLOSED");

  await prisma.stocktakeSession.update({
    where: { id: sessionId },
    data: { status: StocktakeSessionStatus.CLOSED, closedAt: new Date(), closedBy: closedBy ?? null },
  });

  return getStocktakeSession(sessionId);
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
    select: { id: true, status: true },
  });
  if (!session) throw new AppError("الرابط غير صحيح", 404, "SESSION_NOT_FOUND");
  if (session.status === StocktakeSessionStatus.CLOSED)
    throw new AppError("الجلسة مغلقة بالفعل", 400, "ALREADY_CLOSED");

  await prisma.stocktakeSession.update({
    where: { id: session.id },
    data: { status: StocktakeSessionStatus.CLOSED, closedAt: new Date(), closedBy: "PUBLIC_WORKER" },
  });

  return { success: true };
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
    select: { id: true, status: true },
  });
  if (!session) throw new AppError("جلسة الجرد غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status === StocktakeSessionStatus.CLOSED) throw new AppError("الجلسة مغلقة", 400, "SESSION_CLOSED");

  const item = await prisma.stocktakeItem.findFirst({
    where: { sessionId, productId },
  });
  if (!item) throw new AppError("المنتج غير موجود في الجلسة", 404, "ITEM_NOT_FOUND");

  const variance = item.systemQty !== null ? actualQty - item.systemQty : null;

  await prisma.stocktakeItem.update({
    where: { id: item.id },
    data: { actualQty, variance, ...(notes !== undefined ? { notes } : {}) },
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
) {
  return prisma.$transaction(async (tx) => {
    // Lock the item row for update and re-check approvalStatus (race-safe)
    const item = await tx.stocktakeItem.findUnique({
      where: { id: itemId },
      include: {
        session: { select: { status: true, branchId: true } },
        product: { select: { id: true } },
      },
    });

    if (!item) throw new AppError("عنصر الجرد غير موجود", 404, "ITEM_NOT_FOUND");
    if (item.sessionId !== sessionId) throw new AppError("عدم تطابق الجلسة", 400, "SESSION_MISMATCH");
    if (item.session.status !== StocktakeSessionStatus.SUBMITTED) throw new AppError("الجلسة غير مرسلة بعد", 400, "SESSION_NOT_SUBMITTED");
    if (item.actualQty === null) throw new AppError("لم يتم إدخال الكمية الفعلية", 400, "NO_ACTUAL_QTY");
    if (item.approvalStatus !== StocktakeApprovalStatus.PENDING) throw new AppError("تم الموافقة/الرفض على هذا العنصر بالفعل", 400, "ALREADY_APPROVED");

    if (!item.session.branchId) throw new AppError("المخزن غير محدد للجلسة", 400, "NO_WAREHOUSE");

    const delta = item.actualQty - (item.systemQty ?? 0);

    // Update warehouse stock
    const updatedStock = await tx.productWarehouseStock.update({
      where: { productId_warehouseId: { productId: item.productId, warehouseId: item.session.branchId! } },
      data: { quantityPieces: { increment: delta } },
      select: { quantityPieces: true },
    });

    // Sync total product stock to canonical warehouse representation (don't touch legacy fields)
    // This ensures the next approval doesn't double-count. Rely on warehouse stock table only.
    // (Do not write to openingBalancePcs or cartonsAvailable — they are legacy)

    // Record the adjustment in the unified stock-movement ledger so stocktake
    // corrections show up in سجل حركة المخزون like every other stock change.
    if (delta !== 0) {
      const approver = await tx.user.findUnique({
        where: { id: approvingUserId },
        select: { name: true },
      });
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          branchId: item.session.branchId,
          type: delta > 0 ? StockMovementType.IN : StockMovementType.OUT,
          quantity: Math.abs(delta),
          balanceBefore: updatedStock.quantityPieces - delta,
          balanceAfter: updatedStock.quantityPieces,
          userId: approvingUserId,
          userName: approver?.name ?? null,
          note: "تسوية جرد دوري (موافقة فرق الجرد)",
        },
      });
    }

    // Mark item approved — condition on PENDING closes the race window atomically
    const updated = await tx.stocktakeItem.updateMany({
      where: { id: itemId, approvalStatus: StocktakeApprovalStatus.PENDING },
      data: { approvalStatus: StocktakeApprovalStatus.APPROVED, approvedQty: item.actualQty },
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
