import { LossReason, Prisma, StockLossDirection, StockLossSource, Unit } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { lossUnitToPieces } from "../utils/loss-math";
import {
  adjustWarehouseStock,
  ensureLegacyWarehouseStock,
  resolveWarehouseId,
  syncProductTotalStock,
} from "./warehouse-stock.service";

type Db = Prisma.TransactionClient | typeof prisma;

export interface LossItemInput {
  productId: string;
  unit: Unit;
  quantity: number;
}

export interface CreateStockLossInput {
  date: string;
  warehouseId: string;
  reason: LossReason;
  notes?: string;
  items: LossItemInput[];
}

export interface ListLossesQuery {
  from?: string;
  to?: string;
  warehouseId?: string;
  page: number;
  limit: number;
}

async function getStockLossByIdFrom(db: Db, id: string) {
  const loss = await db.stockLoss.findUnique({
    where: { id },
    include: {
      warehouse: { select: { id: true, name: true } },
      items: { include: { product: { select: { id: true, name: true, pcsPerCarton: true } } } },
      creator: { select: { id: true, name: true, username: true } },
    },
  });
  if (!loss) throw new AppError("سجل الخسارة غير موجود", 404, "LOSS_NOT_FOUND");
  return loss;
}

async function generateLossNumber(tx: Db, date: Date) {
  const year = date.getFullYear();
  const counterKey = `loss-${year}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    const counter = await tx.counter.upsert({
      where: { key: counterKey },
      update: { value: { increment: 1 } },
      create: { key: counterKey, value: 1 },
    });
    const candidate = `LOSS-${year}-${String(counter.value).padStart(4, "0")}`;
    const exists = await (tx as typeof prisma).stockLoss?.findUnique?.({
      where: { lossNumber: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  throw new AppError("Could not generate loss number", 409, "LOSS_NUMBER_CONFLICT");
}

export interface RecordStockAdjustmentVarianceInput {
  warehouseId: string;
  productId: string;
  productName: string;
  /** Signed; negative = shrinkage (LOSS), positive = overage (GAIN). Caller guarantees != 0. */
  deltaPieces: number;
  reason: LossReason;
  source: Exclude<StockLossSource, "MANUAL">;
  /** Pre-fetched cost; when omitted, fetched from the product (costPrice, falling back to purchasePrice). */
  costPriceOverride?: number;
  createdBy: string;
  notes?: string;
}

/**
 * Shared plumbing for the three automatic stock-correction call sites (manual
 * "تعديل الكمية", cycle-count approval, stocktake approval): wraps a quantity
 * variance in a StockLoss (+ one StockLossItem) so it gets a cost value and
 * enters net-profit reporting instead of being a silent quantity change — same
 * mechanism as the manual "خسائر/تلف" flow (createStockLoss above), just with
 * source != MANUAL and a direction resolved from the sign of deltaPieces.
 *
 * Does NOT touch ProductWarehouseStock and does NOT create a StockMovement —
 * callers own their own stock mutation and already write their own
 * StockMovement; they should set that row's lossId to the id returned here.
 * MUST run inside the caller's own transaction (no nested prisma.$transaction).
 */
export async function recordStockAdjustmentVariance(
  tx: Db,
  input: RecordStockAdjustmentVarianceInput
): Promise<{ lossId: string }> {
  const date = new Date();
  const lossNumber = await generateLossNumber(tx, date);
  const direction: StockLossDirection = input.deltaPieces < 0 ? "LOSS" : "GAIN";

  const loss = await (tx as typeof prisma).stockLoss.create({
    data: {
      lossNumber,
      date,
      warehouseId: input.warehouseId,
      reason: input.reason,
      direction,
      source: input.source,
      notes: input.notes,
      createdBy: input.createdBy,
    },
  });

  let costPrice = input.costPriceOverride;
  if (costPrice === undefined) {
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: { costPrice: true, purchasePrice: true },
    });
    const costNum = Number(product?.costPrice ?? 0);
    costPrice = costNum > 0 ? costNum : Number(product?.purchasePrice ?? 0);
  }

  const absPieces = Math.abs(input.deltaPieces);
  await (tx as typeof prisma).stockLossItem.create({
    data: {
      lossId: loss.id,
      productId: input.productId,
      productName: input.productName,
      unit: Unit.PIECE,
      quantity: absPieces,
      quantityPieces: absPieces,
      costPrice,
    },
  });

  return { lossId: loss.id };
}

export async function createStockLoss(input: CreateStockLossInput, createdBy: string) {
  if (!input.items.length) throw new AppError("يجب إضافة مادة واحدة على الأقل", 400, "NO_ITEMS");

  return prisma.$transaction(async (tx) => {
    const date = new Date(input.date);
    const lossNumber = await generateLossNumber(tx, date);
    const resolvedWarehouseId = await resolveWarehouseId(tx as typeof prisma, input.warehouseId);

    const loss = await (tx as typeof prisma).stockLoss.create({
      data: {
        lossNumber,
        date,
        warehouseId: resolvedWarehouseId,
        reason: input.reason,
        notes: input.notes,
        createdBy,
      },
    });

    for (const item of input.items) {
      const product = await tx.product.findUnique({
        where: { id: item.productId },
        select: {
          id: true, name: true, pcsPerCarton: true, boxPieces: true, costPrice: true, purchasePrice: true,
          branchId: true, openingBalancePcs: true, cartonsAvailable: true, storageLocation: true, minStock: true,
        },
      });
      if (!product) throw new AppError(`المادة غير موجودة: ${item.productId}`, 404, "PRODUCT_NOT_FOUND");

      // Strict conversion: rejects zero/negative/NaN quantities and bad units so a
      // loss can never *raise* stock. (Also enforced by the zod route schema.)
      const pcs = lossUnitToPieces(item.unit, item.quantity, product.pcsPerCarton, product.boxPieces);

      await ensureLegacyWarehouseStock(tx as typeof prisma, product);
      const { balanceBefore, balanceAfter } = await adjustWarehouseStock(tx as typeof prisma, {
        productId: product.id,
        warehouseId: resolvedWarehouseId,
        deltaPieces: -pcs,
        allowNegative: false,
      });
      await syncProductTotalStock(tx as typeof prisma, product.id);

      await (tx as typeof prisma).stockMovement.create({
        data: {
          productId: product.id,
          branchId: resolvedWarehouseId,
          lossId: loss.id,
          type: "DAMAGE",
          quantity: pcs,
          balanceBefore,
          balanceAfter,
        },
      });

      // Freeze the accounting cost at loss time: costPrice first (weighted-average
      // accounting cost), falling back to purchasePrice (last purchase price) only
      // when no cost is set. Mirrors the sale-invoice cost snapshot.
      const costNum = Number(product.costPrice ?? 0);
      const snapshotCost = costNum > 0 ? costNum : Number(product.purchasePrice ?? 0);

      await (tx as typeof prisma).stockLossItem.create({
        data: {
          lossId: loss.id,
          productId: product.id,
          productName: product.name,
          unit: item.unit,
          quantity: item.quantity,
          // Freeze pieces too (see schema): valuation must not shift if
          // pcsPerCarton is edited after the loss.
          quantityPieces: pcs,
          costPrice: snapshotCost,
        },
      });
    }

    return getStockLossById(loss.id);
  });
}

export async function listStockLosses(query: ListLossesQuery) {
  const where: Prisma.StockLossWhereInput = {};
  if (query.warehouseId) where.warehouseId = query.warehouseId;
  if (query.from || query.to) {
    where.date = {};
    if (query.from) where.date.gte = new Date(query.from);
    if (query.to) where.date.lte = new Date(`${query.to}T23:59:59Z`);
  }

  const skip = (query.page - 1) * query.limit;
  const [total, losses] = await Promise.all([
    prisma.stockLoss.count({ where }),
    prisma.stockLoss.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, pcsPerCarton: true } } } },
        creator: { select: { id: true, name: true, username: true } },
      },
      orderBy: { date: "desc" },
      skip,
      take: query.limit,
    }),
  ]);

  return {
    data: losses,
    pagination: { total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) },
  };
}

export async function getStockLossById(id: string) {
  return getStockLossByIdFrom(prisma, id);
}

export async function cancelStockLoss(id: string) {
  return prisma.$transaction(async (tx) => {
    // Only hand-entered damage reports may be cancelled here. Rows written by
    // ADJUST_STOCK / CYCLE_COUNT / STOCKTAKE are the *audit trace* of a stock
    // correction that was already applied by that flow — cancelling one adds
    // stock a second time (and, for a GAIN row, adds it in the wrong direction
    // entirely) while leaving the source item marked APPROVED, so the
    // correction silently reappears on the next count.
    const target = await tx.stockLoss.findUnique({
      where: { id },
      select: { source: true, lossNumber: true },
    });
    if (!target) throw new AppError("سجل الخسارة غير موجود", 404, "LOSS_NOT_FOUND");
    // `source` carries the schema default MANUAL, so an absent value is a
    // hand-entered report, not an unknown one.
    const source = target.source ?? StockLossSource.MANUAL;
    if (source !== StockLossSource.MANUAL) {
      throw new AppError(
        `السجل ${target.lossNumber} ناتج عن تعديل مخزون أو جرد — عدّله من نفس الشاشة التي أنشأته، لا من هنا`,
        400,
        "LOSS_NOT_CANCELLABLE"
      );
    }

    // Atomically *claim* the cancellation: only the caller that flips
    // null -> now() proceeds to restore stock. A second concurrent cancel
    // updates 0 rows and returns the record untouched — so stock is never
    // returned twice (idempotent + race-safe).
    const claimed = await tx.stockLoss.updateMany({
      where: { id, cancelledAt: null },
      data: { cancelledAt: new Date() },
    });

    if (claimed.count === 0) {
      const existing = await tx.stockLoss.findUnique({ where: { id } });
      if (!existing) throw new AppError("سجل الخسارة غير موجود", 404, "LOSS_NOT_FOUND");
      return getStockLossByIdFrom(tx, id); // already cancelled — no stock change
    }

    const loss = await tx.stockLoss.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true, branchId: true, pcsPerCarton: true, boxPieces: true,
                openingBalancePcs: true, cartonsAvailable: true, storageLocation: true, minStock: true,
              },
            },
          },
        },
      },
    });
    if (!loss) throw new AppError("سجل الخسارة غير موجود", 404, "LOSS_NOT_FOUND");

    // A GAIN row added stock, so its reversal must subtract. Signing by
    // direction keeps this correct even if a non-MANUAL source is ever allowed
    // through the guard above.
    const sign = loss.direction === StockLossDirection.GAIN ? -1 : 1;

    for (const item of loss.items) {
      // Prefer the pieces frozen at creation time. Recomputing from the
      // product's *current* packing invents stock when pcsPerCarton was edited
      // after the loss was recorded (2 cartons at 100 → cancel at 120 = +240).
      const pcs =
        item.quantityPieces ??
        lossUnitToPieces(item.unit, item.quantity, item.product.pcsPerCarton, item.product.boxPieces);
      await ensureLegacyWarehouseStock(tx as typeof prisma, item.product);
      const { balanceBefore, balanceAfter } = await adjustWarehouseStock(tx as typeof prisma, {
        productId: item.productId,
        warehouseId: loss.warehouseId,
        deltaPieces: sign * pcs, // undo the original movement, in its own direction
        allowNegative: true,
      });
      await syncProductTotalStock(tx as typeof prisma, item.productId);

      // Audit-preserving reversal: keep the original DAMAGE movement and append a
      // compensating IN movement carrying the REAL before/after balances.
      await (tx as typeof prisma).stockMovement.create({
        data: {
          productId: item.productId,
          branchId: loss.warehouseId,
          lossId: loss.id,
          type: sign > 0 ? "IN" : "OUT",
          quantity: pcs,
          balanceBefore,
          balanceAfter,
        },
      });
    }

    return getStockLossByIdFrom(tx, id);
  });
}
