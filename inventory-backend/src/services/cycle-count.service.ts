// "جدولة الجرد الذكي" (scheduled smart cycle count) — a fully independent
// feature from the manual "الجرد الدوري" stocktake flow (stocktake.service.ts).
// Separate Prisma models (CycleCountSession/CycleCountItem), separate routes,
// separate page. Never imports from or is imported by stocktake.service.ts.
//
// Safety invariant (same as the manual stocktake flow, re-implemented
// independently here): creating/submitting a session never touches stock.
// Stock only changes when an admin approves an individual item's variance,
// which also writes a normal StockMovement row. Rejecting an item never
// changes stock.

import {
  CycleCountApprovalStatus,
  CycleCountSessionSource,
  CycleCountSessionStatus,
  CycleCountStrategy,
  Prisma,
  StockMovementType,
} from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { resolveWarehouseId } from "./warehouse-stock.service";
import { getSettings, updateSettings } from "./settings.service";

type Db = Prisma.TransactionClient | typeof prisma;

const FAST_MOVING_WINDOW_DAYS = 30;

interface StrategyPoolEntry {
  productId: string;
  systemQty: number;
  minStock: number;
  salePrice: number;
}

// ─── Product selection per strategy ───────────────────────────────────────────

export async function selectProductsForStrategy(
  db: Db,
  warehouseId: string,
  strategy: CycleCountStrategy,
  itemLimit: number,
): Promise<Array<{ productId: string; systemQty: number }>> {
  const stocks = await db.productWarehouseStock.findMany({
    where: { warehouseId, product: { deletedAt: null } },
    select: {
      productId: true,
      quantityPieces: true,
      minStock: true,
      product: { select: { salePrice: true, minStock: true } },
    },
  });

  if (stocks.length === 0) return [];

  const pool: StrategyPoolEntry[] = stocks.map((s) => ({
    productId: s.productId,
    systemQty: s.quantityPieces,
    minStock: s.minStock ?? s.product.minStock ?? 0,
    salePrice: Number(s.product.salePrice),
  }));

  let ordered: StrategyPoolEntry[];

  switch (strategy) {
    case CycleCountStrategy.HIGH_VALUE:
      // Highest stock-on-hand value (qty × sale price) first.
      ordered = [...pool].sort((a, b) => b.systemQty * b.salePrice - a.systemQty * a.salePrice);
      break;

    case CycleCountStrategy.LOW_STOCK:
      // Closest to (or already under) min-stock first.
      ordered = [...pool].sort((a, b) => (a.systemQty - a.minStock) - (b.systemQty - b.minStock));
      break;

    case CycleCountStrategy.FAST_MOVING: {
      const since = new Date(Date.now() - FAST_MOVING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const movements = await db.stockMovement.groupBy({
        by: ["productId"],
        where: { branchId: warehouseId, type: StockMovementType.OUT, createdAt: { gte: since } },
        _sum: { quantity: true },
      });
      const moved = new Map(movements.map((m) => [m.productId, m._sum.quantity ?? 0]));
      ordered = [...pool].sort((a, b) => (moved.get(b.productId) ?? 0) - (moved.get(a.productId) ?? 0));
      break;
    }

    case CycleCountStrategy.LEAST_RECENTLY_COUNTED: {
      // Never counted (no prior CycleCountItem in this warehouse) sorts first.
      const priorItems = await db.cycleCountItem.findMany({
        where: { session: { warehouseId } },
        select: { productId: true, session: { select: { createdAt: true } } },
      });
      const lastCounted = new Map<string, number>();
      for (const item of priorItems) {
        const t = item.session.createdAt.getTime();
        const prev = lastCounted.get(item.productId);
        if (prev === undefined || t > prev) lastCounted.set(item.productId, t);
      }
      ordered = [...pool].sort(
        (a, b) => (lastCounted.get(a.productId) ?? 0) - (lastCounted.get(b.productId) ?? 0),
      );
      break;
    }

    case CycleCountStrategy.RANDOM:
    default: {
      ordered = [...pool];
      for (let i = ordered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      }
      break;
    }
  }

  return ordered.slice(0, itemLimit).map((p) => ({ productId: p.productId, systemQty: p.systemQty }));
}

// ─── Create session (manual or scheduled) ─────────────────────────────────────
// Never touches ProductWarehouseStock/StockMovement — only reads systemQty.

export async function createCycleCountSession(params: {
  createdBy: string;
  warehouseId?: string;
  strategy: CycleCountStrategy;
  itemLimit: number;
  notes?: string;
  source?: CycleCountSessionSource;
  scheduledFor?: Date;
}) {
  const warehouseId = await resolveWarehouseId(prisma, params.warehouseId);
  const itemLimit = Math.max(1, Math.floor(params.itemLimit));
  const products = await selectProductsForStrategy(prisma, warehouseId, params.strategy, itemLimit);

  if (products.length === 0)
    throw new AppError("لا توجد منتجات لإنشاء جلسة جرد ذكي", 400, "NO_PRODUCTS");

  return prisma.$transaction(async (tx) => {
    const session = await tx.cycleCountSession.create({
      data: {
        warehouseId,
        strategy: params.strategy,
        itemLimit,
        source: params.source ?? CycleCountSessionSource.MANUAL,
        scheduledFor: params.scheduledFor ?? null,
        createdBy: params.createdBy,
        notes: params.notes,
        status: CycleCountSessionStatus.OPEN,
      },
    });

    await tx.cycleCountItem.createMany({
      data: products.map((p) => ({
        sessionId: session.id,
        productId: p.productId,
        systemQty: p.systemQty,
      })),
    });

    return session;
  });
}

// ─── Guard: block a duplicate SCHEDULED session while one is still open ──────
// Considers both OPEN and SUBMITTED "still in progress" (not yet CLOSED),
// since an unclosed SUBMITTED session still has pending variances to review.

export async function hasOpenScheduledSession(warehouseId: string): Promise<boolean> {
  const existing = await prisma.cycleCountSession.findFirst({
    where: {
      warehouseId,
      source: CycleCountSessionSource.SCHEDULED,
      status: { in: [CycleCountSessionStatus.OPEN, CycleCountSessionStatus.SUBMITTED] },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

// ─── List / get ────────────────────────────────────────────────────────────────

export async function listCycleCountSessions() {
  const sessions = await prisma.cycleCountSession.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      creator: { select: { id: true, name: true } },
      warehouse: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
  });

  return sessions.map((s) => ({
    id: s.id,
    status: s.status,
    strategy: s.strategy,
    itemLimit: s.itemLimit,
    source: s.source,
    scheduledFor: s.scheduledFor?.toISOString() ?? null,
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
    submittedAt: s.submittedAt?.toISOString() ?? null,
    closedAt: s.closedAt?.toISOString() ?? null,
    creator: s.creator,
    warehouse: s.warehouse,
    itemCount: s._count.items,
  }));
}

export async function getCycleCountSession(id: string) {
  const session = await prisma.cycleCountSession.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, name: true } },
      warehouse: { select: { id: true, name: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, category: true, imageUrl: true } },
          approver: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!session) throw new AppError("جلسة الجرد الذكي غير موجودة", 404, "SESSION_NOT_FOUND");

  const items = session.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    productName: item.product.name,
    category: item.product.category,
    systemQty: item.systemQty,
    actualQty: item.actualQty,
    variance: item.variance,
    notes: item.notes,
    approvalStatus: item.approvalStatus,
    approvedQty: item.approvedQty,
    approver: item.approver,
    approvedAt: item.approvedAt?.toISOString() ?? null,
    hasError: item.variance !== null && item.variance !== 0,
  }));

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
    status: session.status,
    strategy: session.strategy,
    itemLimit: session.itemLimit,
    source: session.source,
    scheduledFor: session.scheduledFor?.toISOString() ?? null,
    notes: session.notes,
    createdAt: session.createdAt.toISOString(),
    submittedAt: session.submittedAt?.toISOString() ?? null,
    closedAt: session.closedAt?.toISOString() ?? null,
    creator: session.creator,
    warehouse: session.warehouse,
    stats: { total: items.length, filled, errors },
    items,
  };
}

// ─── Update a single item's counted quantity (OPEN sessions only) ────────────

export async function updateCycleCountItem(
  sessionId: string,
  productId: string,
  actualQty: number,
  notes?: string,
) {
  const session = await prisma.cycleCountSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true },
  });
  if (!session) throw new AppError("جلسة الجرد الذكي غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status !== CycleCountSessionStatus.OPEN)
    throw new AppError("الجلسة ليست مفتوحة للتعديل", 400, "SESSION_NOT_OPEN");

  const item = await prisma.cycleCountItem.findFirst({ where: { sessionId, productId } });
  if (!item) throw new AppError("المنتج غير موجود في الجلسة", 404, "ITEM_NOT_FOUND");

  const variance = actualQty - item.systemQty;

  await prisma.cycleCountItem.update({
    where: { id: item.id },
    data: { actualQty, variance, ...(notes !== undefined ? { notes } : {}) },
  });

  return { productId, actualQty, variance };
}

// ─── Submit session (recompute variances, lock for review) ───────────────────

export async function submitCycleCountSession(sessionId: string) {
  const session = await prisma.cycleCountSession.findUnique({
    where: { id: sessionId },
    include: { items: true },
  });
  if (!session) throw new AppError("جلسة الجرد الذكي غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status !== CycleCountSessionStatus.OPEN)
    throw new AppError("الجلسة ليست مفتوحة", 400, "SESSION_NOT_OPEN");

  await prisma.$transaction(async (tx) => {
    for (const item of session.items) {
      if (item.actualQty !== null) {
        await tx.cycleCountItem.update({
          where: { id: item.id },
          data: { variance: item.actualQty - item.systemQty },
        });
      }
    }
    await tx.cycleCountSession.update({
      where: { id: sessionId },
      data: { status: CycleCountSessionStatus.SUBMITTED, submittedAt: new Date() },
    });
  });

  return getCycleCountSession(sessionId);
}

// ─── Approve item variance — the ONLY place this feature ever touches stock ──

export async function approveCycleCountItem(
  sessionId: string,
  itemId: string,
  approvingUserId: string,
) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.cycleCountItem.findUnique({
      where: { id: itemId },
      include: { session: { select: { status: true, warehouseId: true } } },
    });

    if (!item) throw new AppError("عنصر الجرد غير موجود", 404, "ITEM_NOT_FOUND");
    if (item.sessionId !== sessionId) throw new AppError("عدم تطابق الجلسة", 400, "SESSION_MISMATCH");
    if (item.session.status !== CycleCountSessionStatus.SUBMITTED)
      throw new AppError("الجلسة غير مرسلة بعد", 400, "SESSION_NOT_SUBMITTED");
    if (item.actualQty === null) throw new AppError("لم يتم إدخال الكمية الفعلية", 400, "NO_ACTUAL_QTY");
    if (item.approvalStatus !== CycleCountApprovalStatus.PENDING)
      throw new AppError("تم الموافقة/الرفض على هذا العنصر بالفعل", 400, "ALREADY_PROCESSED");

    const delta = item.actualQty - item.systemQty;

    const updatedStock = await tx.productWarehouseStock.update({
      where: { productId_warehouseId: { productId: item.productId, warehouseId: item.session.warehouseId } },
      data: { quantityPieces: { increment: delta } },
      select: { quantityPieces: true },
    });

    if (delta !== 0) {
      const approver = await tx.user.findUnique({ where: { id: approvingUserId }, select: { name: true } });
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          branchId: item.session.warehouseId,
          type: delta > 0 ? StockMovementType.IN : StockMovementType.OUT,
          quantity: Math.abs(delta),
          balanceBefore: updatedStock.quantityPieces - delta,
          balanceAfter: updatedStock.quantityPieces,
          userId: approvingUserId,
          userName: approver?.name ?? null,
          note: "تسوية جدولة الجرد الذكي (موافقة)",
        },
      });
    }

    const updated = await tx.cycleCountItem.updateMany({
      where: { id: itemId, approvalStatus: CycleCountApprovalStatus.PENDING },
      data: {
        approvalStatus: CycleCountApprovalStatus.APPROVED,
        approvedQty: item.actualQty,
        approvedBy: approvingUserId,
        approvedAt: new Date(),
      },
    });
    if (updated.count === 0)
      throw new AppError("تم الموافقة/الرفض على هذا العنصر بالفعل", 400, "ALREADY_PROCESSED");

    return { success: true, delta, newQty: item.actualQty };
  });
}

// ─── Reject item variance — never touches stock ──────────────────────────────

export async function rejectCycleCountItem(
  sessionId: string,
  itemId: string,
  reviewingUserId: string,
) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.cycleCountItem.findUnique({
      where: { id: itemId },
      include: { session: { select: { status: true } } },
    });

    if (!item) throw new AppError("عنصر الجرد غير موجود", 404, "ITEM_NOT_FOUND");
    if (item.sessionId !== sessionId) throw new AppError("عدم تطابق الجلسة", 400, "SESSION_MISMATCH");
    if (item.session.status !== CycleCountSessionStatus.SUBMITTED)
      throw new AppError("الجلسة غير مرسلة بعد", 400, "SESSION_NOT_SUBMITTED");
    if (item.approvalStatus !== CycleCountApprovalStatus.PENDING)
      throw new AppError("تم الموافقة/الرفض على هذا العنصر بالفعل", 400, "ALREADY_PROCESSED");

    const updated = await tx.cycleCountItem.updateMany({
      where: { id: itemId, approvalStatus: CycleCountApprovalStatus.PENDING },
      data: {
        approvalStatus: CycleCountApprovalStatus.REJECTED,
        approvedBy: reviewingUserId,
        approvedAt: new Date(),
      },
    });
    if (updated.count === 0)
      throw new AppError("تم الموافقة/الرفض على هذا العنصر بالفعل", 400, "ALREADY_PROCESSED");

    return { success: true };
  });
}

// ─── Close / cancel session ────────────────────────────────────────────────────

export async function closeCycleCountSession(sessionId: string) {
  const session = await prisma.cycleCountSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new AppError("جلسة الجرد الذكي غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status === CycleCountSessionStatus.CLOSED) throw new AppError("الجلسة مغلقة بالفعل", 400, "ALREADY_CLOSED");
  if (session.status === CycleCountSessionStatus.CANCELLED) throw new AppError("الجلسة ملغاة", 400, "SESSION_CANCELLED");

  await prisma.cycleCountSession.update({
    where: { id: sessionId },
    data: { status: CycleCountSessionStatus.CLOSED, closedAt: new Date() },
  });

  return getCycleCountSession(sessionId);
}

export async function cancelCycleCountSession(sessionId: string) {
  const session = await prisma.cycleCountSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new AppError("جلسة الجرد الذكي غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status === CycleCountSessionStatus.CLOSED) throw new AppError("لا يمكن إلغاء جلسة مغلقة", 400, "ALREADY_CLOSED");
  if (session.status === CycleCountSessionStatus.CANCELLED) throw new AppError("الجلسة ملغاة بالفعل", 400, "ALREADY_CANCELLED");

  await prisma.cycleCountSession.update({
    where: { id: sessionId },
    data: { status: CycleCountSessionStatus.CANCELLED },
  });

  return { success: true };
}

// ─── Scheduled cron entrypoint ─────────────────────────────────────────────────
// Called hourly from notification-jobs.service.ts. Creates a SCHEDULED session
// only when: the feature is enabled, a valid active warehouse is configured,
// the configured interval has elapsed since the last run, and no SCHEDULED
// session is still open for that warehouse.

export async function runScheduledCycleCountJob() {
  const settings = await getSettings();
  if (!settings.cycleCountEnabled) return;

  const warehouseId = settings.cycleCountWarehouseId?.trim();
  if (!warehouseId) return;

  const warehouse = await prisma.branch.findFirst({
    where: { id: warehouseId, isActive: true },
    select: { id: true },
  });
  if (!warehouse) return;

  const intervalDays = Math.max(1, settings.cycleCountIntervalDays ?? 7);
  const lastRunAt = settings.cycleCountLastRunAt ? new Date(settings.cycleCountLastRunAt) : null;
  const dueAt = lastRunAt ? lastRunAt.getTime() + intervalDays * 24 * 60 * 60 * 1000 : 0;
  if (Date.now() < dueAt) return;

  // Still in progress — retry next hour, do NOT advance cycleCountLastRunAt.
  if (await hasOpenScheduledSession(warehouse.id)) return;

  const systemAdmin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!systemAdmin) return;

  const itemLimit = Math.max(1, settings.cycleCountItemLimit ?? 20);
  const strategy = (settings.cycleCountStrategy ?? "LEAST_RECENTLY_COUNTED") as CycleCountStrategy;

  await createCycleCountSession({
    createdBy: systemAdmin.id,
    warehouseId: warehouse.id,
    strategy,
    itemLimit,
    source: CycleCountSessionSource.SCHEDULED,
    scheduledFor: new Date(),
    notes: "جلسة تلقائية — جدولة الجرد الذكي",
  });

  await updateSettings({ cycleCountLastRunAt: new Date().toISOString() });
}
