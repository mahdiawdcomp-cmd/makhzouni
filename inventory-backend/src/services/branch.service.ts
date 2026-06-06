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

function currentStock(product: {
  openingBalancePcs: number;
  cartonsAvailable: number;
  pcsPerCarton: number;
}) {
  return product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton;
}

export async function listBranchSummaries() {
  const branches = await prisma.branch.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  const summaries = await Promise.all(
    branches.map(async (branch) => {
      const [
        products,
        customers,
        sales,
        salesReturns,
        purchases,
        receipts,
        payments,
        expenses,
        branchProducts,
        transfersOut,
        transfersIn,
      ] = await Promise.all([
        prisma.product.aggregate({
          where: { branchId: branch.id, deletedAt: null },
          _count: { _all: true },
          _sum: { openingBalancePcs: true, cartonsAvailable: true },
        }),
        prisma.customer.aggregate({
          where: { branchId: branch.id, deletedAt: null },
          _count: { _all: true },
          _sum: { currentBalance: true },
        }),
        prisma.invoice.aggregate({
          where: { branchId: branch.id, status: "ACTIVE", type: "SALE" },
          _count: { _all: true },
          _sum: { totalAmount: true, paidAmount: true, remainingAmount: true },
        }),
        prisma.invoice.aggregate({
          where: { branchId: branch.id, status: "ACTIVE", type: "SALES_RETURN" },
          _count: { _all: true },
          _sum: { totalAmount: true, paidAmount: true, remainingAmount: true },
        }),
        prisma.invoice.aggregate({
          where: { branchId: branch.id, status: "ACTIVE", type: "PURCHASE" },
          _count: { _all: true },
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
        prisma.product.findMany({
          where: { branchId: branch.id, deletedAt: null },
          select: {
            openingBalancePcs: true,
            cartonsAvailable: true,
            pcsPerCarton: true,
            minStock: true,
          },
        }),
        prisma.inventoryTransfer.count({ where: { fromBranchId: branch.id } }),
        prisma.inventoryTransfer.count({ where: { toBranchId: branch.id } }),
      ]);

      const lowStock = branchProducts.filter(
        (product) => currentStock(product) <= product.minStock
      ).length;
      const totalPieces = branchProducts.reduce(
        (sum, product) => sum + currentStock(product),
        0
      );

      return {
        branch,
        products: products._count._all,
        customers: customers._count._all,
        customerBalance: toNumber(customers._sum.currentBalance),
        sales: {
          count: sales._count._all,
          total: toNumber(sales._sum.totalAmount) - toNumber(salesReturns._sum.totalAmount),
          paid: toNumber(sales._sum.paidAmount) - toNumber(salesReturns._sum.paidAmount),
          remaining: toNumber(sales._sum.remainingAmount) - toNumber(salesReturns._sum.remainingAmount),
        },
        purchases: {
          count: purchases._count._all,
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
          openingPieces: toNumber(products._sum.openingBalancePcs),
          cartons: toNumber(products._sum.cartonsAvailable),
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
