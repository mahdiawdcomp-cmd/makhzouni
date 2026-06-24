import { Prisma, StockMovementType, Unit } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { amountInPieces } from "../utils/financial";
import {
  adjustWarehouseStock,
  ensureLegacyWarehouseStock,
  resolveShopWarehouseId,
  syncProductTotalStock,
} from "./warehouse-stock.service";

export interface VarietyConvertItem {
  productId: string;
  unit: Unit;
  quantity: number;
}

export interface VarietyConvertInput {
  fromWarehouseId: string;
  targetProductId: string;
  toWarehouseId?: string; // defaults to المحل
  items: VarietyConvertItem[];
  allowNegative?: boolean;
  notes?: string;
}

function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Convert many named items from a (big) warehouse into a single generic
 * "variety" product in the shop. The named items are deducted from the source
 * warehouse; the SUM of their pieces is added to the target product in the shop.
 * The target's cost is recomputed as a weighted average so profit stays accurate.
 */
export async function convertToVariety(input: VarietyConvertInput, createdBy: string) {
  if (!input.items?.length) {
    throw new AppError("لا توجد مواد للتحويل", 400, "VARIETY_NO_ITEMS");
  }

  return prisma.$transaction(async (tx) => {
    const toWarehouseId = input.toWarehouseId?.trim() || (await resolveShopWarehouseId(tx));

    if (input.fromWarehouseId === toWarehouseId) {
      throw new AppError("مخزن المصدر والمحل لا يمكن أن يكونا نفس المخزن", 400, "VARIETY_SAME_WAREHOUSE");
    }

    const warehouses = await tx.branch.findMany({
      where: { id: { in: [input.fromWarehouseId, toWarehouseId] }, isActive: true },
      select: { id: true },
    });
    if (warehouses.length !== 2) {
      throw new AppError("المخزن غير موجود أو غير مفعّل", 404, "WAREHOUSE_NOT_FOUND");
    }

    // Group duplicate (product, unit) lines.
    const grouped = new Map<string, VarietyConvertItem>();
    for (const item of input.items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new AppError("الكمية يجب أن تكون رقماً موجباً", 400, "VARIETY_BAD_QTY");
      }
      const key = `${item.productId}:${item.unit}`;
      const prev = grouped.get(key);
      grouped.set(key, prev ? { ...item, quantity: prev.quantity + item.quantity } : item);
    }
    const items = [...grouped.values()];

    if (items.some((it) => it.productId === input.targetProductId)) {
      throw new AppError("لا يمكن تحويل المادة المتنوعة إلى نفسها", 400, "VARIETY_TARGET_IS_SOURCE");
    }

    // Target (variety) product + its current total stock & cost.
    const target = await tx.product.findFirst({
      where: { id: input.targetProductId, deletedAt: null },
    });
    if (!target) throw new AppError("المادة المتنوعة الهدف غير موجودة", 404, "VARIETY_TARGET_NOT_FOUND");
    await ensureLegacyWarehouseStock(tx, target);

    const targetAgg = await tx.productWarehouseStock.aggregate({
      where: { productId: target.id },
      _sum: { quantityPieces: true },
    });
    const targetExistingPieces = targetAgg._sum.quantityPieces ?? 0;
    const targetExistingCost = toNumber(target.costPrice) || toNumber(target.purchasePrice);

    // Source products.
    const sources = await tx.product.findMany({
      where: { id: { in: items.map((i) => i.productId) }, deletedAt: null },
    });
    if (sources.length !== new Set(items.map((i) => i.productId)).size) {
      throw new AppError("إحدى المواد غير موجودة", 404, "PRODUCT_NOT_FOUND");
    }
    const sourceMap = new Map(sources.map((p) => [p.id, p]));

    let totalPieces = 0;
    let totalCost = 0;
    const lines: Array<{ productId: string; productName: string; pieces: number }> = [];

    for (const item of items) {
      const product = sourceMap.get(item.productId)!;
      await ensureLegacyWarehouseStock(tx, product);
      const pieces = amountInPieces(item.unit, item.quantity, product.pcsPerCarton);

      const source = await adjustWarehouseStock(tx, {
        productId: product.id,
        warehouseId: input.fromWarehouseId,
        deltaPieces: -pieces,
        allowNegative: input.allowNegative ?? false,
      });

      await tx.stockMovement.create({
        data: {
          productId: product.id,
          branchId: input.fromWarehouseId,
          type: StockMovementType.OUT,
          quantity: pieces,
          balanceBefore: source.balanceBefore,
          balanceAfter: source.balanceAfter,
        },
      });

      const costPerPiece = toNumber(product.costPrice) || toNumber(product.purchasePrice);
      totalPieces += pieces;
      totalCost += pieces * costPerPiece;
      lines.push({ productId: product.id, productName: product.name, pieces });
      await syncProductTotalStock(tx, product.id);
    }

    // Add the combined pieces to the variety product in the shop.
    const dest = await adjustWarehouseStock(tx, {
      productId: target.id,
      warehouseId: toWarehouseId,
      deltaPieces: totalPieces,
    });
    await tx.stockMovement.create({
      data: {
        productId: target.id,
        branchId: toWarehouseId,
        type: StockMovementType.IN,
        quantity: totalPieces,
        balanceBefore: dest.balanceBefore,
        balanceAfter: dest.balanceAfter,
      },
    });

    // Weighted-average cost for the variety product → accurate profit.
    const newTotalPieces = targetExistingPieces + totalPieces;
    const newCost =
      newTotalPieces > 0
        ? round2((targetExistingPieces * targetExistingCost + totalCost) / newTotalPieces)
        : targetExistingCost;
    await tx.product.update({
      where: { id: target.id },
      data: { costPrice: newCost },
    });
    await syncProductTotalStock(tx, target.id);

    return {
      targetProductId: target.id,
      targetProductName: target.name,
      addedPieces: totalPieces,
      newCost,
      lines,
    };
  });
}
