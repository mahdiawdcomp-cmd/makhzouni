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

import { randomBytes } from "crypto";
import {
  CycleCountApprovalStatus,
  CycleCountSessionSource,
  CycleCountSessionStatus,
  CycleCountStrategy,
  LossReason,
  Prisma,
  StockMovementType,
} from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { normalizePhone } from "../utils/phone";
import { adjustWarehouseStock, resolveWarehouseId, syncProductTotalStock } from "./warehouse-stock.service";
import { getSettings, updateSettings } from "./settings.service";
import { sendWhatsAppText } from "./whatsapp.service";
import { buildDedupeKey, notifyAdmin } from "./app-notification.service";
import { NotificationCategory, NotificationSeverity, NotificationType } from "../constants/notifications";
import { recordStockAdjustmentVariance } from "./stock-loss.service";
import { logger } from "../utils/logger";

type Db = Prisma.TransactionClient | typeof prisma;

const FAST_MOVING_WINDOW_DAYS = 30;

function makeToken() {
  return `cyc_${randomBytes(24).toString("base64url")}`;
}

/** Builds the absolute worker-link URL from the tenant's own catalogPublicUrl
 * setting (multi-tenant safe — never hardcode a tenant host). */
function buildCycleCountPublicUrl(publicToken: string, catalogPublicUrl?: string): string {
  let origin = "https://app.mazbwoni.com";
  if (catalogPublicUrl) {
    try {
      origin = new URL(catalogPublicUrl).origin;
    } catch {
      // keep fallback
    }
  }
  return `${origin}/cycle-count/${publicToken}`;
}

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
      // Only items someone actually entered a count for, in a session that
      // wasn't cancelled, count as "recently counted" — otherwise a product
      // merely listed in a session (still OPEN and never reached, or
      // CANCELLED seconds after creation) would be wrongly treated as
      // reviewed and deprioritized from future scheduling.
      const priorItems = await db.cycleCountItem.findMany({
        where: {
          actualQty: { not: null },
          session: { warehouseId, status: { not: CycleCountSessionStatus.CANCELLED } },
        },
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

  const publicToken = makeToken();

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.cycleCountSession.create({
      data: {
        warehouseId,
        strategy: params.strategy,
        itemLimit,
        source: params.source ?? CycleCountSessionSource.MANUAL,
        scheduledFor: params.scheduledFor ?? null,
        createdBy: params.createdBy,
        notes: params.notes,
        status: CycleCountSessionStatus.OPEN,
        publicToken,
      },
    });

    await tx.cycleCountItem.createMany({
      data: products.map((p) => ({
        sessionId: created.id,
        productId: p.productId,
        systemQty: p.systemQty,
      })),
    });

    return created;
  });

  // Best-effort: WhatsApp the worker link to the warehouse's configured phone.
  // Never blocks/fails session creation — creation already succeeded above.
  notifyWorkerOfNewSession(warehouseId, publicToken).catch(() => {});

  return session;
}

async function notifyWorkerOfNewSession(warehouseId: string, publicToken: string) {
  const [branch, settings] = await Promise.all([
    prisma.branch.findUnique({ where: { id: warehouseId }, select: { name: true, phone: true } }),
    getSettings().catch(() => null),
  ]);
  if (!branch?.phone) return;

  const link = buildCycleCountPublicUrl(publicToken, settings?.catalogPublicUrl);
  const message = `📋 جرد ذكي جديد لمخزن ${branch.name}\nافتح الرابط وابدأ العد:\n${link}`;
  await sendWhatsAppText(normalizePhone(branch.phone), message);
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

// ─── List / get (admin) ────────────────────────────────────────────────────────

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
    publicToken: s.publicToken,
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
    publicToken: session.publicToken,
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

// ─── Update a single item's counted quantity — admin side (OPEN sessions,
// PENDING items only; once an item is APPROVED/REJECTED it is frozen) ────────

export async function updateCycleCountItem(
  sessionId: string,
  productId: string,
  actualQty: number,
  notes?: string,
) {
  const session = await prisma.cycleCountSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, warehouseId: true },
  });
  if (!session) throw new AppError("جلسة الجرد الذكي غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status !== CycleCountSessionStatus.OPEN)
    throw new AppError("الجلسة ليست مفتوحة للتعديل — أعد فتحها أولاً", 400, "SESSION_NOT_OPEN");

  const item = await prisma.cycleCountItem.findFirst({ where: { sessionId, productId } });
  if (!item) throw new AppError("المنتج غير موجود في الجلسة", 404, "ITEM_NOT_FOUND");
  if (item.approvalStatus !== CycleCountApprovalStatus.PENDING)
    throw new AppError("تم معالجة هذا العنصر بالفعل، لا يمكن تعديله", 400, "ITEM_ALREADY_PROCESSED");

  // Re-read the LIVE system quantity at count time, exactly as the public
  // worker path (scanCycleCountQrCode / setCycleCountItemQty) already does.
  // Using the value captured when the session was created double-counts every
  // sale that happened since — and left the two entry paths behind one approve
  // button producing different stock outcomes for identical input.
  const currentStock = await prisma.productWarehouseStock.findUnique({
    where: { productId_warehouseId: { productId, warehouseId: session.warehouseId } },
    select: { quantityPieces: true },
  });
  const systemQty = currentStock?.quantityPieces ?? item.systemQty;
  const variance = actualQty - systemQty;

  await prisma.cycleCountItem.update({
    where: { id: item.id },
    data: { actualQty, systemQty, variance, ...(notes !== undefined ? { notes } : {}) },
  });

  return { productId, actualQty, variance };
}

// ─── Submit (recompute variances, lock for review, notify admin) ────────────
// Shared by both the admin submit action and the worker's public submit.

async function performSubmit(sessionId: string) {
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

  const result = await getCycleCountSession(sessionId);

  // Best-effort in-app admin notification — never blocks/fails the submit.
  notifyAdmin({
    type: NotificationType.CYCLE_COUNT_SUBMITTED,
    category: NotificationCategory.STOCK,
    severity: NotificationSeverity.IMPORTANT,
    title: "جدولة الجرد الذكي — بانتظار المراجعة",
    message: `تم رفع جرد لمخزن ${result.warehouse?.name ?? "—"} — ${result.stats.errors} فرق من أصل ${result.stats.total}`,
    entityType: "CYCLE_COUNT_SESSION",
    entityId: sessionId,
    actionUrl: `/inventory/cycle-count?session=${sessionId}`,
    metadata: { sessionId },
    dedupeKey: buildDedupeKey(NotificationType.CYCLE_COUNT_SUBMITTED, sessionId),
  }).catch(() => {});

  return result;
}

export async function submitCycleCountSession(sessionId: string) {
  return performSubmit(sessionId);
}

// ─── Reopen a SUBMITTED session so it (and the worker link) accept edits again ──
// Already-APPROVED/REJECTED items stay frozen (guarded in updateCycleCountItem
// and the worker-side setters) — only still-PENDING items become editable again.

export async function reopenCycleCountSession(sessionId: string) {
  const session = await prisma.cycleCountSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new AppError("جلسة الجرد الذكي غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status !== CycleCountSessionStatus.SUBMITTED)
    throw new AppError("يمكن إعادة فتح جلسة مرسلة فقط", 400, "SESSION_NOT_SUBMITTED");

  await prisma.cycleCountSession.update({
    where: { id: sessionId },
    data: { status: CycleCountSessionStatus.OPEN, submittedAt: null },
  });

  return getCycleCountSession(sessionId);
}

// ─── Approve item variance — the ONLY place this feature ever touches stock ──
// Safe against a double-click: the whole thing is one $transaction, and the
// final updateMany's PENDING guard throwing on a second/concurrent call rolls
// back that entire attempt (including its stock increment/StockMovement),
// leaving the first successful approval as the only lasting effect.

export async function approveCycleCountItem(
  sessionId: string,
  itemId: string,
  approvingUserId: string,
  reason: LossReason,
) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.cycleCountItem.findUnique({
      where: { id: itemId },
      include: {
        session: { select: { status: true, warehouseId: true } },
        product: { select: { name: true } },
      },
    });

    if (!item) throw new AppError("عنصر الجرد غير موجود", 404, "ITEM_NOT_FOUND");
    if (item.sessionId !== sessionId) throw new AppError("عدم تطابق الجلسة", 400, "SESSION_MISMATCH");
    if (item.session.status !== CycleCountSessionStatus.SUBMITTED)
      throw new AppError("الجلسة غير مرسلة بعد", 400, "SESSION_NOT_SUBMITTED");
    if (item.actualQty === null) throw new AppError("لم يتم إدخال الكمية الفعلية", 400, "NO_ACTUAL_QTY");
    if (item.approvalStatus !== CycleCountApprovalStatus.PENDING)
      throw new AppError("تم الموافقة/الرفض على هذا العنصر بالفعل", 400, "ALREADY_PROCESSED");

    const delta = item.actualQty - item.systemQty;

    // adjustWarehouseStock locks the row and enforces the same negative-floor
    // guard every other stock-mutating path (invoice/transfer/loss) uses — the
    // raw increment update this replaced had no such guard.
    const { balanceBefore, balanceAfter } = await adjustWarehouseStock(tx, {
      productId: item.productId,
      warehouseId: item.session.warehouseId,
      deltaPieces: delta,
      // Matches the sale/transfer policy: never block a legitimate correction
      // over a stock discrepancy — a deficit surfaces later instead.
      allowNegative: true,
    });

    let lossId: string | null = null;
    if (delta !== 0) {
      const approver = await tx.user.findUnique({ where: { id: approvingUserId }, select: { name: true } });
      const recorded = await recordStockAdjustmentVariance(tx, {
        warehouseId: item.session.warehouseId,
        productId: item.productId,
        productName: item.product.name,
        deltaPieces: delta,
        reason,
        source: "CYCLE_COUNT",
        createdBy: approvingUserId,
      });
      lossId = recorded.lossId;

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          branchId: item.session.warehouseId,
          lossId,
          type: delta > 0 ? StockMovementType.IN : StockMovementType.OUT,
          quantity: Math.abs(delta),
          balanceBefore,
          balanceAfter,
          userId: approvingUserId,
          userName: approver?.name ?? null,
          note: "تسوية جدولة الجرد الذكي (موافقة)",
        },
      });
    }

    // Keep denormalized legacy stock fields in sync (see approveStocktakeItem).
    if (delta !== 0) await syncProductTotalStock(tx, item.productId);

    const updated = await tx.cycleCountItem.updateMany({
      where: { id: itemId, approvalStatus: CycleCountApprovalStatus.PENDING },
      data: {
        approvalStatus: CycleCountApprovalStatus.APPROVED,
        approvedQty: item.actualQty,
        approvedBy: approvingUserId,
        approvedAt: new Date(),
        reason: delta !== 0 ? reason : null,
        lossId,
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

// ─── Bulk: approve / reject every still-PENDING item in one pass ─────────────
// Same per-item safety as the single-item functions above (increment/movement
// then a PENDING-guarded updateMany), just looped inside one transaction.

export async function approveAllCycleCountItems(sessionId: string, approvingUserId: string, reason: LossReason) {
  const session = await prisma.cycleCountSession.findUnique({
    where: { id: sessionId },
    include: { items: { include: { product: { select: { name: true } } } } },
  });
  if (!session) throw new AppError("جلسة الجرد الذكي غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status !== CycleCountSessionStatus.SUBMITTED)
    throw new AppError("الجلسة غير مرسلة بعد", 400, "SESSION_NOT_SUBMITTED");

  const approver = await prisma.user.findUnique({ where: { id: approvingUserId }, select: { name: true } });

  return prisma.$transaction(async (tx) => {
    let approvedCount = 0;
    for (const item of session.items) {
      if (item.approvalStatus !== CycleCountApprovalStatus.PENDING || item.actualQty === null) continue;

      const delta = item.actualQty - item.systemQty;
      const { balanceBefore, balanceAfter } = await adjustWarehouseStock(tx, {
        productId: item.productId,
        warehouseId: session.warehouseId,
        deltaPieces: delta,
        // Matches the sale/transfer policy: never block a legitimate correction
        // over a stock discrepancy — a deficit surfaces later instead.
        allowNegative: true,
      });

      let lossId: string | null = null;
      if (delta !== 0) {
        const recorded = await recordStockAdjustmentVariance(tx, {
          warehouseId: session.warehouseId,
          productId: item.productId,
          productName: item.product.name,
          deltaPieces: delta,
          reason,
          source: "CYCLE_COUNT",
          createdBy: approvingUserId,
        });
        lossId = recorded.lossId;

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            branchId: session.warehouseId,
            lossId,
            type: delta > 0 ? StockMovementType.IN : StockMovementType.OUT,
            quantity: Math.abs(delta),
            balanceBefore,
            balanceAfter,
            userId: approvingUserId,
            userName: approver?.name ?? null,
            note: "تسوية جدولة الجرد الذكي (موافقة الكل)",
          },
        });
      }

      // Keep denormalized legacy stock fields in sync (see approveStocktakeItem).
      if (delta !== 0) await syncProductTotalStock(tx, item.productId);

      const updated = await tx.cycleCountItem.updateMany({
        where: { id: item.id, approvalStatus: CycleCountApprovalStatus.PENDING },
        data: {
          approvalStatus: CycleCountApprovalStatus.APPROVED,
          approvedQty: item.actualQty,
          approvedBy: approvingUserId,
          approvedAt: new Date(),
          reason: delta !== 0 ? reason : null,
          lossId,
        },
      });
      if (updated.count === 1) approvedCount++;
    }
    return { success: true, approvedCount };
  });
}

export async function rejectAllCycleCountItems(sessionId: string, reviewingUserId: string) {
  const session = await prisma.cycleCountSession.findUnique({
    where: { id: sessionId },
    include: { items: true },
  });
  if (!session) throw new AppError("جلسة الجرد الذكي غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status !== CycleCountSessionStatus.SUBMITTED)
    throw new AppError("الجلسة غير مرسلة بعد", 400, "SESSION_NOT_SUBMITTED");

  return prisma.$transaction(async (tx) => {
    let rejectedCount = 0;
    for (const item of session.items) {
      if (item.approvalStatus !== CycleCountApprovalStatus.PENDING) continue;
      const updated = await tx.cycleCountItem.updateMany({
        where: { id: item.id, approvalStatus: CycleCountApprovalStatus.PENDING },
        data: {
          approvalStatus: CycleCountApprovalStatus.REJECTED,
          approvedBy: reviewingUserId,
          approvedAt: new Date(),
        },
      });
      if (updated.count === 1) rejectedCount++;
    }
    return { success: true, rejectedCount };
  });
}

// ─── Close / cancel session (admin only) ──────────────────────────────────────

export async function closeCycleCountSession(sessionId: string, force = false) {
  const session = await prisma.cycleCountSession.findUnique({
    where: { id: sessionId },
    include: { items: { select: { approvalStatus: true, actualQty: true } } },
  });
  if (!session) throw new AppError("جلسة الجرد الذكي غير موجودة", 404, "SESSION_NOT_FOUND");
  if (session.status === CycleCountSessionStatus.CLOSED) throw new AppError("الجلسة مغلقة بالفعل", 400, "ALREADY_CLOSED");
  if (session.status === CycleCountSessionStatus.CANCELLED) throw new AppError("الجلسة ملغاة", 400, "SESSION_CANCELLED");

  // Guard against silently closing a session that still has counted-but-unreviewed
  // variances — those would otherwise never get a StockLoss/StockMovement trace.
  const unresolvedCount = session.items.filter(
    (i) => i.approvalStatus === CycleCountApprovalStatus.PENDING && i.actualQty !== null,
  ).length;
  if (unresolvedCount > 0 && !force) {
    throw new AppError(
      `توجد ${unresolvedCount} فروقات لم تتم مراجعتها بعد — راجعها أو ارفضها قبل إغلاق الجلسة`,
      400,
      "UNRESOLVED_ITEMS",
    );
  }
  if (unresolvedCount > 0 && force) {
    logger.warn(`[cycle-count] closing session ${sessionId} with ${unresolvedCount} unresolved item(s) (force=true)`);
  }

  await prisma.cycleCountSession.update({
    where: { id: sessionId },
    data: { status: CycleCountSessionStatus.CLOSED, closedAt: new Date() },
  });

  const closed = await getCycleCountSession(sessionId);
  return { ...closed, unresolvedCount };
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

// ─── Public (worker) — no auth, no systemQty ever exposed ─────────────────────

export async function getPublicCycleCountSession(token: string) {
  const session = await prisma.cycleCountSession.findUnique({
    where: { publicToken: token },
    select: {
      id: true,
      status: true,
      notes: true,
      createdAt: true,
      warehouse: { select: { name: true } },
      items: {
        select: {
          id: true,
          productId: true,
          actualQty: true,
          notes: true,
          approvalStatus: true,
          // systemQty is intentionally never selected here — never shown to the worker.
          product: { select: { name: true, itemNumber: true, category: true, qrCode: true, cartonQrCode: true, pcsPerCarton: true } },
        },
        orderBy: [{ product: { category: "asc" } }, { product: { name: "asc" } }],
      },
    },
  });

  if (!session) throw new AppError("الرابط غير صحيح أو منتهي", 404, "SESSION_NOT_FOUND");

  return {
    id: session.id,
    status: session.status,
    notes: session.notes,
    warehouse: session.warehouse,
    createdAt: session.createdAt.toISOString(),
    items: session.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      itemNumber: item.product.itemNumber?.trim() || null,
      category: item.product.category,
      qrCode: item.product.qrCode,
      cartonQrCode: item.product.cartonQrCode,
      pcsPerCarton: item.product.pcsPerCarton,
      actualQty: item.actualQty, // shows the worker's own prior progress — never wiped on reopen
      notes: item.notes,
      approvalStatus: item.approvalStatus,
    })),
  };
}

export async function scanCycleCountQrCode(token: string, qrCode: string) {
  const session = await prisma.cycleCountSession.findUnique({
    where: { publicToken: token },
    select: { id: true, status: true, warehouseId: true },
  });
  if (!session) throw new AppError("الرابط غير صحيح", 404, "SESSION_NOT_FOUND");
  if (session.status !== CycleCountSessionStatus.OPEN)
    throw new AppError("الجلسة ليست مفتوحة للتعديل", 400, "SESSION_NOT_OPEN");

  const product = await prisma.product.findFirst({
    where: { OR: [{ qrCode: qrCode.trim() }, { cartonQrCode: qrCode.trim() }], deletedAt: null },
  });
  if (!product) throw new AppError("لم يُعثر على منتج بهذا الباركود", 404, "PRODUCT_NOT_FOUND");

  const item = await prisma.cycleCountItem.findFirst({ where: { sessionId: session.id, productId: product.id } });
  if (!item) throw new AppError("هذا المنتج ليس ضمن قائمة الجرد", 404, "ITEM_NOT_IN_SESSION");
  if (item.approvalStatus !== CycleCountApprovalStatus.PENDING)
    throw new AppError("تم معالجة هذا العنصر بالفعل", 400, "ITEM_ALREADY_PROCESSED");

  const isCartonBarcode = product.cartonQrCode === qrCode.trim();
  const increment = isCartonBarcode ? Math.max(1, product.pcsPerCarton) : 1;
  const newQty = (item.actualQty ?? 0) + increment;

  // Same live-refresh fix as setCycleCountItemQty — see comment there.
  const currentStock = await prisma.productWarehouseStock.findUnique({
    where: { productId_warehouseId: { productId: product.id, warehouseId: session.warehouseId } },
    select: { quantityPieces: true },
  });
  const freshSystemQty = currentStock?.quantityPieces ?? item.systemQty;

  await prisma.cycleCountItem.update({
    where: { id: item.id },
    data: { actualQty: newQty, systemQty: freshSystemQty, variance: newQty - freshSystemQty },
  });

  return {
    productId: product.id,
    productName: product.name,
    itemNumber: product.itemNumber?.trim() || null,
    category: product.category,
    newQty,
    increment,
  };
}

export async function setCycleCountItemQty(
  token: string,
  productId: string,
  qty: number,
  unit: "CARTON" | "PIECE",
) {
  const session = await prisma.cycleCountSession.findUnique({
    where: { publicToken: token },
    select: { id: true, status: true, warehouseId: true },
  });
  if (!session) throw new AppError("الرابط غير صحيح", 404, "SESSION_NOT_FOUND");
  if (session.status !== CycleCountSessionStatus.OPEN)
    throw new AppError("الجلسة ليست مفتوحة للتعديل", 400, "SESSION_NOT_OPEN");

  const item = await prisma.cycleCountItem.findFirst({
    where: { sessionId: session.id, productId },
    include: { product: { select: { pcsPerCarton: true } } },
  });
  if (!item) throw new AppError("المنتج غير موجود في الجلسة", 404, "ITEM_NOT_FOUND");
  if (item.approvalStatus !== CycleCountApprovalStatus.PENDING)
    throw new AppError("تم معالجة هذا العنصر بالفعل", 400, "ITEM_ALREADY_PROCESSED");

  const actualPcsPerCarton = Math.max(1, item.product.pcsPerCarton);
  const qtyInPieces = unit === "CARTON" ? qty * actualPcsPerCarton : qty;

  // Re-read the LIVE system quantity at count time instead of trusting the
  // value captured when the session/item was created — that can be stale by
  // hours/days if other stock movements happened since. Stays invisible to
  // the worker: only the stored systemQty is refreshed server-side, never
  // exposed in this (or any public) response — see getPublicCycleCountSession.
  const currentStock = await prisma.productWarehouseStock.findUnique({
    where: { productId_warehouseId: { productId, warehouseId: session.warehouseId } },
    select: { quantityPieces: true },
  });
  const freshSystemQty = currentStock?.quantityPieces ?? item.systemQty;

  await prisma.cycleCountItem.update({
    where: { id: item.id },
    data: { actualQty: qtyInPieces, systemQty: freshSystemQty, variance: qtyInPieces - freshSystemQty },
  });

  return { productId, actualQty: qtyInPieces, unit, original: qty };
}

export async function submitPublicCycleCount(token: string) {
  const session = await prisma.cycleCountSession.findUnique({
    where: { publicToken: token },
    select: { id: true },
  });
  if (!session) throw new AppError("الرابط غير صحيح", 404, "SESSION_NOT_FOUND");

  await performSubmit(session.id);
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
