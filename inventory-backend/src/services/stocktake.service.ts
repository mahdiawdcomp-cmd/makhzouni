import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
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
        status: "OPEN",
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

export async function closeStocktakeSession(sessionId: string) {
  const session = await prisma.stocktakeSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new AppError("جلسة الجرد غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status === "CLOSED") throw new AppError("الجلسة مغلقة بالفعل", 400, "ALREADY_CLOSED");

  await prisma.stocktakeSession.update({
    where: { id: sessionId },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  return getStocktakeSession(sessionId);
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
  if (session.status === "CLOSED") throw new AppError("الجلسة مغلقة", 400, "SESSION_CLOSED");

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
  if (session.status === "CLOSED") throw new AppError("الجلسة مغلقة بالفعل", 400, "ALREADY_CLOSED");

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
      data: { status: "SUBMITTED" },
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
  if (session.status === "CLOSED") throw new AppError("الجلسة مغلقة", 400, "SESSION_CLOSED");

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
  pcsPerCarton: number,
) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { publicToken: token },
    select: { id: true, status: true },
  });
  if (!session) throw new AppError("الرابط غير صحيح", 404, "SESSION_NOT_FOUND");
  if (session.status === "CLOSED") throw new AppError("الجلسة مغلقة", 400, "SESSION_CLOSED");

  const item = await prisma.stocktakeItem.findFirst({
    where: { sessionId: session.id, productId },
  });
  if (!item) throw new AppError("المنتج غير موجود في الجلسة", 404, "ITEM_NOT_FOUND");

  // Convert pieces to cartons (round up to nearest carton)
  const qtyInPieces = unit === "CARTON" ? qty * Math.max(1, pcsPerCarton) : qty;

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
  if (session.status === "CLOSED")
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
      data: { status: "SUBMITTED" },
    });
  });

  return { success: true };
}
