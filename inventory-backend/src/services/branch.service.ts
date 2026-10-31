import { Prisma } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { resolveShopWarehouseId } from "./warehouse-stock.service";

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

  const shopId = await resolveShopWarehouseId(prisma).catch(() => null);
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
        invoiceTotals(branch.id, "SALE", shopId),
        invoiceTotals(branch.id, "PURCHASE", shopId),
        voucherTotal(branch.id, "RECEIPT", shopId),
        voucherTotal(branch.id, "PAYMENT", shopId),
        voucherTotal(branch.id, "EXPENSE", shopId),
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
          count: sales.count,
          total: sales.total,
          paid: sales.paid,
          remaining: sales.remaining,
        },
        purchases: {
          count: purchases.count,
          total: purchases.total,
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

// An invoice's header branch_id is almost never set — the warehouse lives on
// its stock movements. An invoice belongs to the warehouse its stock moved in;
// one that moved no stock (and has no header branch) is the shop's. Count
// settlements (origin STOCK_COUNT) are stock corrections, not trade.
async function invoiceTotals(branchId: string, type: "SALE" | "PURCHASE", shopId: string | null) {
  const isShop = branchId === shopId;
  const rows = await prisma.$queryRaw<{ count: bigint; total: unknown; paid: unknown; remaining: unknown }[]>`
    SELECT COUNT(*) AS count,
           COALESCE(SUM(i.total_amount), 0) AS total,
           COALESCE(SUM(i.paid_amount), 0) AS paid,
           COALESCE(SUM(i.remaining_amount), 0) AS remaining
      FROM invoices i
     WHERE i.type::text = ${type}
       AND i.status::text = 'ACTIVE'
       AND i.origin IS DISTINCT FROM 'STOCK_COUNT'
       AND (
         i.branch_id = ${branchId}::uuid
         OR EXISTS (SELECT 1 FROM stock_movements m WHERE m.invoice_id = i.id AND m.branch_id = ${branchId}::uuid)
         OR (${isShop} AND i.branch_id IS NULL
             AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.invoice_id = i.id))
       )`;
  const r = rows[0];
  return {
    count: Number(r?.count ?? 0),
    total: Number(r?.total ?? 0),
    paid: Number(r?.paid ?? 0),
    remaining: Number(r?.remaining ?? 0),
  };
}

// Vouchers carry no warehouse unless one was picked; unassigned ones are the shop's.
async function voucherTotal(branchId: string, type: "RECEIPT" | "PAYMENT" | "EXPENSE", shopId: string | null) {
  const where: Prisma.PaymentVoucherWhereInput =
    branchId === shopId ? { type, OR: [{ branchId }, { branchId: null }] } : { type, branchId };
  const agg = await prisma.paymentVoucher.aggregate({ where, _sum: { amount: true } });
  return { _sum: { amount: agg._sum.amount } };
}
