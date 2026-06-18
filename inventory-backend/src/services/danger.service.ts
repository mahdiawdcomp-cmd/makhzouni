import prisma from "../config/database";
import { AppError } from "../utils/app-error";

/**
 * Destructive maintenance operations. Every function here permanently removes
 * data and is gated behind an admin-only route + an explicit confirmation
 * phrase typed by the user. Always take a backup first (Settings → النسخ الاحتياطي).
 */

// The exact phrase the user must type to authorise an operational wipe.
export const WIPE_CONFIRM_PHRASE = "مسح نهائي";

/**
 * Operational (transactional) tables — everything that represents day-to-day
 * business activity. These are TRUNCATEd. Anything NOT listed here is kept:
 * customers, users, branches, settings, message_templates, catalog_categories,
 * retail_categories, retail_coupons, retail_customers, customer_tags,
 * customer_portal_links, catalog_access_links, counters, licensed_clients,
 * client_payments.
 *
 * Order does not matter because we pass them all to a single TRUNCATE ...
 * CASCADE statement; CASCADE only ever pulls in *child* tables, all of which
 * are themselves operational and already listed, so customer/user/branch rows
 * (parents) are never touched.
 */
const OPERATIONAL_TABLES = [
  "invoice_items",
  "invoices",
  "payment_vouchers",
  "quotation_items",
  "quotations",
  "coupon_redemptions",
  "coupons",
  "stock_movements",
  "transfer_items",
  "inventory_transfers",
  "stocktake_items",
  "stocktake_sessions",
  "order_preparations",
  "pending_approvals",
  "notifications",
  "retail_orders",
  "retail_catalog_items",
  "product_warehouse_stocks",
  "products",
  "audit_logs",
] as const;

export interface WipeResult {
  deleted: Record<string, number>;
  keptCustomers: number;
  keptUsers: number;
  keptBranches: number;
}

/**
 * Permanently deletes all operational data while preserving customers, user
 * logins, settings and warehouses. Counts are captured BEFORE truncation so we
 * can report exactly what was removed.
 */
export async function wipeOperationalData(confirmPhrase: string): Promise<WipeResult> {
  if (confirmPhrase?.trim() !== WIPE_CONFIRM_PHRASE) {
    throw new AppError(
      `عبارة التأكيد غير صحيحة. اكتب بالضبط: ${WIPE_CONFIRM_PHRASE}`,
      400,
      "WIPE_CONFIRM_MISMATCH",
    );
  }

  // Snapshot row counts for the report (best-effort).
  const [
    products,
    invoices,
    vouchers,
    quotations,
    stockMovements,
    transfers,
    coupons,
    keptCustomers,
    keptUsers,
    keptBranches,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.invoice.count(),
    prisma.paymentVoucher.count(),
    prisma.quotation.count(),
    prisma.stockMovement.count(),
    prisma.inventoryTransfer.count(),
    prisma.coupon.count(),
    prisma.customer.count({ where: { deletedAt: null } }),
    prisma.user.count(),
    prisma.branch.count(),
  ]);

  // Single atomic TRUNCATE across every operational table.
  const tableList = OPERATIONAL_TABLES.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`,
  );

  return {
    deleted: {
      products,
      invoices,
      vouchers,
      quotations,
      stockMovements,
      transfers,
      coupons,
    },
    keptCustomers,
    keptUsers,
    keptBranches,
  };
}

export interface MergeWarehousesInput {
  /** Branch that becomes the single merged main warehouse (will be renamed). */
  mainBranchId: string;
  /** New display name for the merged main warehouse. */
  mainName: string;
  /** Branch ids to keep as-is (e.g. شارع العباس). Everything else is merged+deleted. */
  keepBranchIds: string[];
}

export interface MergeWarehousesResult {
  mainBranch: { id: string; name: string };
  keptBranches: { id: string; name: string }[];
  deletedBranches: { id: string; name: string }[];
  reassignedCustomers: number;
}

/**
 * Collapses the warehouse list down to: one renamed "main" branch + the
 * explicitly-kept branches. Any other branch has its remaining references
 * (customers, products, warehouse stock) moved to the main branch and is then
 * deleted. Run AFTER an operational wipe so no invoices/movements reference the
 * branches being removed.
 */
export async function mergeWarehouses(
  input: MergeWarehousesInput,
): Promise<MergeWarehousesResult> {
  const mainName = input.mainName?.trim();
  if (!input.mainBranchId || !mainName) {
    throw new AppError("المخزن الرئيسي واسمه مطلوبان", 400, "MERGE_INVALID_INPUT");
  }

  const branches = await prisma.branch.findMany();
  const main = branches.find((b) => b.id === input.mainBranchId);
  if (!main) {
    throw new AppError("المخزن الرئيسي غير موجود", 404, "MAIN_BRANCH_NOT_FOUND");
  }

  const keepSet = new Set([input.mainBranchId, ...input.keepBranchIds]);
  const toDelete = branches.filter((b) => !keepSet.has(b.id));

  return prisma.$transaction(async (tx) => {
    let reassignedCustomers = 0;

    for (const branch of toDelete) {
      // Move any lingering references onto the main branch.
      const moved = await tx.customer.updateMany({
        where: { branchId: branch.id },
        data: { branchId: input.mainBranchId },
      });
      reassignedCustomers += moved.count;

      await tx.product.updateMany({
        where: { branchId: branch.id },
        data: { branchId: input.mainBranchId },
      });

      // Drop any leftover per-warehouse stock rows for the dead branch.
      await tx.productWarehouseStock.deleteMany({ where: { warehouseId: branch.id } });
    }

    // Point the "shop" warehouse setting at the merged main branch.
    const shopSetting = await tx.setting.findUnique({ where: { key: "shopWarehouseId" } });
    if (shopSetting) {
      await tx.setting.update({
        where: { key: "shopWarehouseId" },
        data: { value: input.mainBranchId },
      });
    }

    // Rename + activate the main branch.
    await tx.branch.update({
      where: { id: input.mainBranchId },
      data: { name: mainName, isActive: true },
    });

    // Delete the now-dereferenced branches. If any operational data still
    // points at them, this throws — telling the user to run the wipe first.
    for (const branch of toDelete) {
      try {
        await tx.branch.delete({ where: { id: branch.id } });
      } catch {
        throw new AppError(
          `تعذّر حذف المخزن «${branch.name}» لأن عليه بيانات مرتبطة. نفّذ «مسح البيانات التشغيلية» أولاً ثم أعد الدمج.`,
          409,
          "BRANCH_HAS_REFERENCES",
        );
      }
    }

    const refreshedMain = await tx.branch.findUnique({ where: { id: input.mainBranchId } });
    const kept = branches.filter(
      (b) => input.keepBranchIds.includes(b.id) && b.id !== input.mainBranchId,
    );

    return {
      mainBranch: { id: input.mainBranchId, name: refreshedMain?.name ?? mainName },
      keptBranches: kept.map((b) => ({ id: b.id, name: b.name })),
      deletedBranches: toDelete.map((b) => ({ id: b.id, name: b.name })),
      reassignedCustomers,
    };
  });
}
