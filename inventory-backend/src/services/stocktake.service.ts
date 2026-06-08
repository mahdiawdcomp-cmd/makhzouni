import { Prisma } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";

type Db = Prisma.TransactionClient | typeof prisma;

function stockOf(p: { openingBalancePcs: number; cartonsAvailable: number; pcsPerCarton: number }) {
  return p.openingBalancePcs + p.cartonsAvailable * p.pcsPerCarton;
}

export async function createStocktakeSession(createdBy: string, branchId?: string, notes?: string) {
  // Snapshot all active products with their current carton counts
  const products = await prisma.product.findMany({
    where: { deletedAt: null, ...(branchId ? { branchId } : {}) },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  if (products.length === 0) {
    throw new AppError("لا توجد منتجات لإنشاء جلسة جرد", 400, "NO_PRODUCTS");
  }

  return prisma.$transaction(async (tx) => {
    const session = await tx.stocktakeSession.create({
      data: { createdBy, branchId: branchId ?? null, notes, status: "OPEN" },
    });

    await tx.stocktakeItem.createMany({
      data: products.map((p) => ({
        sessionId: session.id,
        productId: p.id,
        productName: p.name,
        systemQty: p.cartonsAvailable,
        actualQty: null,
        variance: null,
      })),
    });

    return session;
  });
}

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
    status: s.status,
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
    closedAt: s.closedAt?.toISOString() ?? null,
    creator: s.creator,
    branch: s.branch,
    itemCount: s._count.items,
  }));
}

export async function getStocktakeSession(id: string, forStaff = false) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      items: {
        include: { product: { select: { id: true, name: true, category: true, cartonsAvailable: true, imageUrl: true } } },
        orderBy: [{ product: { category: "asc" } }, { productName: "asc" }],
      },
    },
  });

  if (!session) throw new AppError("جلسة الجرد غير موجودة", 404, "SESSION_NOT_FOUND");

  return {
    id: session.id,
    status: session.status,
    notes: session.notes,
    createdAt: session.createdAt.toISOString(),
    closedAt: session.closedAt?.toISOString() ?? null,
    creator: session.creator,
    branch: session.branch,
    items: session.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      category: item.product.category,
      // Only reveal systemQty to admin (forStaff=false) or if session is closed
      systemQty: (!forStaff || session.status === "CLOSED") ? item.systemQty : null,
      actualQty: item.actualQty,
      variance: item.variance,
      notes: item.notes,
    })),
  };
}

export async function updateStocktakeItem(
  sessionId: string,
  productId: string,
  actualQty: number,
  notes?: string,
) {
  const session = await prisma.stocktakeSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new AppError("جلسة الجرد غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status === "CLOSED") throw new AppError("جلسة الجرد مغلقة", 400, "SESSION_CLOSED");

  const item = await prisma.stocktakeItem.findFirst({ where: { sessionId, productId } });
  if (!item) throw new AppError("المنتج غير موجود في الجلسة", 404, "ITEM_NOT_FOUND");

  return prisma.stocktakeItem.update({
    where: { id: item.id },
    data: {
      actualQty,
      variance: actualQty - item.systemQty,
      notes: notes ?? null,
    },
  });
}

export async function submitStocktakeSession(sessionId: string) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { id: sessionId },
    include: { items: true },
  });
  if (!session) throw new AppError("جلسة الجرد غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status !== "OPEN") throw new AppError("الجلسة ليست مفتوحة", 400, "SESSION_NOT_OPEN");

  // Calculate variances
  await prisma.$transaction(async (tx) => {
    for (const item of session.items) {
      if (item.actualQty !== null) {
        await tx.stocktakeItem.update({
          where: { id: item.id },
          data: { variance: item.actualQty - item.systemQty },
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

export async function closeStocktakeSession(sessionId: string) {
  const session = await prisma.stocktakeSession.findUnique({
    where: { id: sessionId },
    include: { items: { where: { actualQty: { not: null } } } },
  });
  if (!session) throw new AppError("جلسة الجرد غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status === "CLOSED") throw new AppError("الجلسة مغلقة بالفعل", 400, "ALREADY_CLOSED");

  await prisma.stocktakeSession.update({
    where: { id: sessionId },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  return getStocktakeSession(sessionId);
}
