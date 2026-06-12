import { Prisma, TransferStatus, Unit, StockMovementType } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import {
  adjustWarehouseStock,
  ensureLegacyWarehouseStock,
  syncProductTotalStock,
} from "./warehouse-stock.service";

export interface TransferItemInput {
  productId: string;
  quantity: number;
  unit: Unit;
}

export interface CreateTransferInput {
  fromBranchId: string;
  toBranchId: string;
  notes?: string;
  items: TransferItemInput[];
}

async function nextTransferNumber(tx: Prisma.TransactionClient) {
  const counter = await tx.counter.upsert({
    where: { key: "inventory_transfer" },
    update: { value: { increment: 1 } },
    create: { key: "inventory_transfer", value: 1 },
  });
  return `TRF-${String(counter.value).padStart(6, "0")}`;
}

const transferInclude = {
  fromBranch: { select: { id: true, name: true, code: true } },
  toBranch: { select: { id: true, name: true, code: true } },
  creator: { select: { id: true, name: true } },
  items: {
    include: {
      product: { select: { id: true, name: true, itemNumber: true, pcsPerCarton: true } },
    },
  },
};

export async function listTransfers(query: {
  branchId?: string;
  page?: number;
  limit?: number;
}) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const where: Prisma.InventoryTransferWhereInput = query.branchId
    ? { OR: [{ fromBranchId: query.branchId }, { toBranchId: query.branchId }] }
    : {};

  const [rows, total] = await Promise.all([
    prisma.inventoryTransfer.findMany({
      where,
      include: transferInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.inventoryTransfer.count({ where }),
  ]);

  return { data: rows, pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
}

export async function getTransferById(id: string) {
  const transfer = await prisma.inventoryTransfer.findUnique({
    where: { id },
    include: transferInclude,
  });
  if (!transfer) throw new AppError("Transfer not found", 404, "TRANSFER_NOT_FOUND");
  return transfer;
}

export async function createTransfer(input: CreateTransferInput, createdBy: string) {
  if (input.fromBranchId === input.toBranchId) {
    throw new AppError("Source and destination warehouses must be different", 400, "INVALID_TRANSFER");
  }
  if (!input.items?.length) {
    throw new AppError("Transfer must have at least one item", 400, "INVALID_TRANSFER");
  }

  return prisma.$transaction(async (tx) => {
    const warehouses = await tx.branch.findMany({
      where: { id: { in: [input.fromBranchId, input.toBranchId] }, isActive: true },
      select: { id: true },
    });
    if (warehouses.length !== 2) {
      throw new AppError("Warehouse not found or inactive", 404, "WAREHOUSE_NOT_FOUND");
    }

    const grouped = new Map<string, TransferItemInput>();
    for (const item of input.items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new AppError("Transfer quantity must be positive", 400, "INVALID_TRANSFER_QUANTITY");
      }
      const key = `${item.productId}:${item.unit}`;
      const previous = grouped.get(key);
      grouped.set(key, previous ? { ...item, quantity: previous.quantity + item.quantity } : item);
    }

    const normalizedItems = [...grouped.values()];
    const products = await tx.product.findMany({
      where: { id: { in: normalizedItems.map((item) => item.productId) }, deletedAt: null },
    });
    if (products.length !== new Set(normalizedItems.map((item) => item.productId)).size) {
      throw new AppError("One or more products were not found", 404, "PRODUCT_NOT_FOUND");
    }
    const productMap = new Map(products.map((product) => [product.id, product]));

    const transfer = await tx.inventoryTransfer.create({
      data: {
        transferNumber: await nextTransferNumber(tx),
        fromBranchId: input.fromBranchId,
        toBranchId: input.toBranchId,
        notes: input.notes?.trim() || null,
        createdBy,
        status: TransferStatus.COMPLETED,
        items: { create: normalizedItems },
      },
    });

    for (const item of normalizedItems) {
      const product = productMap.get(item.productId)!;
      await ensureLegacyWarehouseStock(tx, product);
      const quantityInPieces =
        item.unit === Unit.CARTON
          ? item.quantity * product.pcsPerCarton
          : item.unit === Unit.DOZEN
            ? item.quantity * 12
            : item.quantity;

      const source = await adjustWarehouseStock(tx, {
        productId: product.id,
        warehouseId: input.fromBranchId,
        deltaPieces: -quantityInPieces,
        allowNegative: false,
      });
      const destination = await adjustWarehouseStock(tx, {
        productId: product.id,
        warehouseId: input.toBranchId,
        deltaPieces: quantityInPieces,
      });

      await tx.stockMovement.createMany({
        data: [
          {
            productId: product.id,
            branchId: input.fromBranchId,
            type: StockMovementType.OUT,
            quantity: quantityInPieces,
            balanceBefore: source.balanceBefore,
            balanceAfter: source.balanceAfter,
          },
          {
            productId: product.id,
            branchId: input.toBranchId,
            type: StockMovementType.IN,
            quantity: quantityInPieces,
            balanceBefore: destination.balanceBefore,
            balanceAfter: destination.balanceAfter,
          },
        ],
      });
      await syncProductTotalStock(tx, product.id);
    }

    return tx.inventoryTransfer.findUniqueOrThrow({
      where: { id: transfer.id },
      include: transferInclude,
    });
  });
}
