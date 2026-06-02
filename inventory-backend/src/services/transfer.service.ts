import { Prisma, TransferStatus, Unit, StockMovementType } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";

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

function generateTransferNumber() {
  return `TRF-${Date.now()}`;
}

export async function listTransfers(query: {
  branchId?: string;
  page?: number;
  limit?: number;
}) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;

  const where: Prisma.InventoryTransferWhereInput = {};
  if (query.branchId) {
    where.OR = [
      { fromBranchId: query.branchId },
      { toBranchId: query.branchId },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.inventoryTransfer.findMany({
      where,
      include: {
        fromBranch: { select: { name: true } },
        toBranch: { select: { name: true } },
        creator: { select: { name: true } },
        items: {
          include: {
            product: { select: { name: true, itemNumber: true, pcsPerCarton: true } }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.inventoryTransfer.count({ where }),
  ]);

  return {
    data: rows,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
}

export async function getTransferById(id: string) {
  const transfer = await prisma.inventoryTransfer.findUnique({
    where: { id },
    include: {
      fromBranch: true,
      toBranch: true,
      creator: true,
      items: {
        include: {
          product: true
        }
      }
    }
  });

  if (!transfer) {
    throw new AppError("Transfer not found", 404, "TRANSFER_NOT_FOUND");
  }

  return transfer;
}

export async function createTransfer(input: CreateTransferInput, createdBy: string) {
  if (input.fromBranchId === input.toBranchId) {
    throw new AppError("Cannot transfer to the same branch", 400, "INVALID_TRANSFER");
  }

  if (!input.items || input.items.length === 0) {
    throw new AppError("Transfer must have at least one item", 400, "INVALID_TRANSFER");
  }

  return prisma.$transaction(async (tx) => {
    // 1. Create Transfer Record
    const transfer = await tx.inventoryTransfer.create({
      data: {
        transferNumber: generateTransferNumber(),
        fromBranchId: input.fromBranchId,
        toBranchId: input.toBranchId,
        notes: input.notes,
        createdBy,
        status: TransferStatus.COMPLETED,
        items: {
          create: input.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unit: item.unit,
          })),
        },
      },
      include: {
        items: {
          include: { product: true }
        }
      }
    });

    // 2. Create StockMovements (Documentary)
    // We create an OUT for fromBranch and an IN for toBranch
    for (const item of transfer.items) {
      const quantityInPieces = item.unit === Unit.CARTON 
        ? item.quantity * item.product.pcsPerCarton 
        : item.unit === Unit.DOZEN 
          ? item.quantity * 12 
          : item.quantity;
          
      const balanceBefore = item.product.openingBalancePcs + item.product.cartonsAvailable * item.product.pcsPerCarton;

      // Note: The system currently tracks global stock on Product. 
      // A transfer between branches doesn't change global stock! 
      // It only records documentary movements for reports.
      
      // OUT from source branch
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          branchId: input.fromBranchId,
          type: StockMovementType.OUT,
          quantity: quantityInPieces,
          balanceBefore,
          balanceAfter: balanceBefore, // Global stock doesn't change
        }
      });

      // IN to destination branch
      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          branchId: input.toBranchId,
          type: StockMovementType.IN,
          quantity: quantityInPieces,
          balanceBefore,
          balanceAfter: balanceBefore, // Global stock doesn't change
        }
      });
    }

    return transfer;
  });
}
