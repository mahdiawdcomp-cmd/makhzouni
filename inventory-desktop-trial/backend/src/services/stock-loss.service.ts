import { LossReason, Prisma, Unit } from "@prisma/client";
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
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product) throw new AppError(`المادة غير موجودة: ${item.productId}`, 404, "PRODUCT_NOT_FOUND");

      // Strict conversion: rejects zero/negative/NaN quantities and bad units so a
      // loss can never *raise* stock. (Also enforced by the zod route schema.)
      const pcs = lossUnitToPieces(item.unit, item.quantity, product.pcsPerCarton);

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

      await (tx as typeof prisma).stockLossItem.create({
        data: {
          lossId: loss.id,
          productId: product.id,
          productName: product.name,
          unit: item.unit,
          quantity: item.quantity,
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
      include: { items: { include: { product: true } } },
    });
    if (!loss) throw new AppError("سجل الخسارة غير موجود", 404, "LOSS_NOT_FOUND");

    for (const item of loss.items) {
      const pcs = lossUnitToPieces(item.unit, item.quantity, item.product.pcsPerCarton);
      await ensureLegacyWarehouseStock(tx as typeof prisma, item.product);
      const { balanceBefore, balanceAfter } = await adjustWarehouseStock(tx as typeof prisma, {
        productId: item.productId,
        warehouseId: loss.warehouseId,
        deltaPieces: pcs, // restore the damaged pieces back into the warehouse
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
          type: "IN",
          quantity: pcs,
          balanceBefore,
          balanceAfter,
        },
      });
    }

    return getStockLossByIdFrom(tx, id);
  });
}
