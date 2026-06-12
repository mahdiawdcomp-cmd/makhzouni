import { Prisma } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";

export interface BranchInput {
  name: string;
  code: string;
  phone?: string;
  address?: string;
  isActive?: boolean;
}

export async function listBranches(query: { search?: string; isActive?: boolean }) {
  const where: Prisma.BranchWhereInput = {
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { code: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
  };

  return prisma.branch.findMany({
    where,
    include: { _count: { select: { productStocks: true } } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

export async function getBranchById(id: string) {
  const branch = await prisma.branch.findUnique({ where: { id } });

  if (!branch) {
    throw new AppError("Branch not found", 404, "BRANCH_NOT_FOUND");
  }

  return branch;
}

export async function createBranch(input: BranchInput, createdBy?: string) {
  return prisma.branch.create({
    data: {
      name: input.name,
      code: input.code,
      phone: input.phone,
      address: input.address,
      isActive: input.isActive ?? true,
      createdBy,
    },
  });
}

export async function updateBranch(id: string, input: Partial<BranchInput>) {
  await getBranchById(id);

  return prisma.branch.update({
    where: { id },
    data: input,
  });
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export async function listBranchSummaries() {
  const branches = await prisma.branch.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  const summaries = await Promise.all(
    branches.map(async (branch) => {
      const [
        stocks,
        transfersOut,
        transfersIn,
        customers,
        sales,
        purchases,
        receipts,
        payments,
        expenses,
      ] = await Promise.all([
        prisma.productWarehouseStock.findMany({
          where: { warehouseId: branch.id, product: { deletedAt: null } },
          select: {
            quantityPieces: true,
            minStock: true,
            storageLocation: true,
            product: {
              select: {
                minStock: true,
                purchasePrice: true,
                costPrice: true,
                openingBalancePcs: true,
                cartonsAvailable: true,
                pcsPerCarton: true,
              },
            },
          },
        }),
        prisma.inventoryTransfer.count({ where: { fromBranchId: branch.id } }),
        prisma.inventoryTransfer.count({ where: { toBranchId: branch.id } }),
        prisma.customer.count({ where: { branchId: branch.id, deletedAt: null } }),
        prisma.invoice.aggregate({
          where: { branchId: branch.id, type: "SALE", status: "ACTIVE" },
          _count: { id: true },
          _sum: { totalAmount: true, paidAmount: true, remainingAmount: true },
        }),
        prisma.invoice.aggregate({
          where: { branchId: branch.id, type: "PURCHASE", status: "ACTIVE" },
          _count: { id: true },
          _sum: { totalAmount: true },
        }),
        prisma.paymentVoucher.aggregate({
          where: { branchId: branch.id, type: "RECEIPT" },
          _sum: { amount: true },
        }),
        prisma.paymentVoucher.aggregate({
          where: { branchId: branch.id, type: "PAYMENT" },
          _sum: { amount: true },
        }),
        prisma.paymentVoucher.aggregate({
          where: { branchId: branch.id, type: "EXPENSE" },
          _sum: { amount: true },
        }),
      ]);

      const lowStock = stocks.filter(
        (stock) => stock.quantityPieces <= (stock.minStock ?? stock.product.minStock)
      ).length;
      const totalPieces = stocks.reduce((sum, stock) => sum + stock.quantityPieces, 0);
      const openingPieces = stocks.reduce(
        (sum, stock) => sum + stock.product.openingBalancePcs,
        0
      );
      const cartons = stocks.reduce(
        (sum, stock) => sum + stock.product.cartonsAvailable,
        0
      );
      const inventoryValue = stocks.reduce((sum, stock) => {
        const unitCost = toNumber(stock.product.costPrice) || toNumber(stock.product.purchasePrice);
        return sum + stock.quantityPieces * unitCost;
      }, 0);

      return {
        branch,
        products: stocks.length,
        customers,
        customerBalance: 0,
        sales: {
          count: sales._count.id,
          total: toNumber(sales._sum.totalAmount),
          paid: toNumber(sales._sum.paidAmount),
          remaining: toNumber(sales._sum.remainingAmount),
        },
        purchases: {
          count: purchases._count.id,
          total: toNumber(purchases._sum.totalAmount),
        },
        vouchers: {
          receipts: toNumber(receipts._sum.amount),
          payments: toNumber(payments._sum.amount),
          expenses: toNumber(expenses._sum.amount),
        },
        stock: {
          lowStock,
          totalPieces,
          openingPieces,
          cartons,
          inventoryValue,
          locatedProducts: stocks.filter((stock) => Boolean(stock.storageLocation)).length,
        },
        transfers: {
          out: transfersOut,
          in: transfersIn,
        },
      };
    }),
  );

  return summaries;
}
