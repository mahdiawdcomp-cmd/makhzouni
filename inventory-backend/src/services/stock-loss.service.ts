import { LossReason, Prisma, Unit } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
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

function unitToPieces(unit: Unit, quantity: number, pcsPerCarton: number) {
  if (unit === "CARTON") return quantity * pcsPerCarton;
  if (unit === "DOZEN") return quantity * 12;
  return quantity;
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

      const pcs = unitToPieces(item.unit, item.quantity, product.pcsPerCarton);

      await ensureLegacyWarehouseStock(tx as typeof prisma, product);
      await adjustWarehouseStock(tx as typeof prisma, {
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
          balanceBefore: 0,
          balanceAfter: 0,
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
  const loss = await prisma.stockLoss.findUnique({
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

export async function cancelStockLoss(id: string) {
  const loss = await prisma.stockLoss.findUnique({
    where: { id },
    include: { items: { include: { product: true } } },
  });
  if (!loss) throw new AppError("سجل الخسارة غير موجود", 404, "LOSS_NOT_FOUND");
  if (loss.cancelledAt) return loss;

  return prisma.$transaction(async (tx) => {
    for (const item of loss.items) {
      const pcs = unitToPieces(item.unit, item.quantity, item.product.pcsPerCarton);
      await ensureLegacyWarehouseStock(tx as typeof prisma, item.product);
      await adjustWarehouseStock(tx as typeof prisma, {
        productId: item.productId,
        warehouseId: loss.warehouseId,
        deltaPieces: pcs,
        allowNegative: true,
      });
      await syncProductTotalStock(tx as typeof prisma, item.productId);
    }

    await tx.stockMovement.deleteMany({ where: { lossId: id } });

    return (tx as typeof prisma).stockLoss.update({
      where: { id },
      data: { cancelledAt: new Date() },
    });
  });
}
