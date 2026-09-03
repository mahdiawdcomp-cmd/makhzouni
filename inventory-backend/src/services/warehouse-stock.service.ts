import { Prisma } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { getSettings } from "./settings.service";

export type WarehouseDb = Prisma.TransactionClient | typeof prisma;

/**
 * The "المحل" warehouse that sales deduct from. Uses the explicitly configured
 * settings.shopWarehouseId when set + still active; otherwise falls back to the
 * oldest active warehouse. NOTE: do NOT infer المحل as "oldest" elsewhere — the
 * oldest may be a depot (e.g. شارع العباس).
 */
export async function resolveShopWarehouseId(db: WarehouseDb): Promise<string> {
  const settings = await getSettings().catch(() => null);
  const configured = settings?.shopWarehouseId?.trim();
  if (configured) {
    const wh = await db.branch.findFirst({
      where: { id: configured, isActive: true },
      select: { id: true },
    });
    if (wh) return wh.id;
  }
  // Fallback: prefer any branch whose name contains "محل" over the oldest branch,
  // so that a misconfigured (or not-yet-configured) shopWarehouseId doesn't silently
  // resolve to a depot warehouse that happens to be the oldest.
  const shopByName = await db.branch.findFirst({
    where: { isActive: true, name: { contains: "محل" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (shopByName) return shopByName.id;
  return resolveWarehouseId(db, null);
}

export function normalizeProductStock(totalPieces: number, pcsPerCarton: number) {
  if (totalPieces < 0 || pcsPerCarton <= 0) {
    return { openingBalancePcs: totalPieces, cartonsAvailable: 0 };
  }

  const cartonsAvailable = Math.floor(totalPieces / pcsPerCarton);
  return {
    openingBalancePcs: totalPieces - cartonsAvailable * pcsPerCarton,
    cartonsAvailable,
  };
}

export async function resolveWarehouseId(db: WarehouseDb, preferredId?: string | null) {
  if (preferredId) {
    const warehouse = await db.branch.findFirst({
      where: { id: preferredId, isActive: true },
      select: { id: true },
    });
    if (!warehouse) {
      throw new AppError("Warehouse not found or inactive", 404, "WAREHOUSE_NOT_FOUND");
    }
    return warehouse.id;
  }

  const warehouse = await db.branch.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (warehouse) return warehouse.id;

  const created = await db.branch.create({
    data: { name: "المخزن الرئيسي", code: `MAIN-${Date.now()}`, isActive: true },
    select: { id: true },
  });
  return created.id;
}

export async function upsertWarehouseStock(
  db: WarehouseDb,
  input: {
    productId: string;
    warehouseId: string;
    quantityPieces?: number;
    storageLocation?: string | null;
    minStock?: number | null;
  }
) {
  return db.productWarehouseStock.upsert({
    where: {
      productId_warehouseId: {
        productId: input.productId,
        warehouseId: input.warehouseId,
      },
    },
    create: {
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantityPieces: input.quantityPieces ?? 0,
      storageLocation: input.storageLocation?.trim() || null,
      minStock: input.minStock ?? null,
    },
    update: {
      ...(input.quantityPieces === undefined ? {} : { quantityPieces: input.quantityPieces }),
      ...(input.storageLocation === undefined
        ? {}
        : { storageLocation: input.storageLocation?.trim() || null }),
      ...(input.minStock === undefined ? {} : { minStock: input.minStock }),
    },
  });
}

export async function syncProductTotalStock(db: WarehouseDb, productId: string) {
  const [aggregate, product] = await Promise.all([
    db.productWarehouseStock.aggregate({
      where: { productId },
      _sum: { quantityPieces: true },
    }),
    db.product.findUnique({
      where: { id: productId },
      select: { pcsPerCarton: true },
    }),
  ]);

  if (!product) throw new AppError("المادة غير موجودة", 404, "PRODUCT_NOT_FOUND");
  const totalPieces = aggregate._sum.quantityPieces ?? 0;
  const normalized = normalizeProductStock(totalPieces, product.pcsPerCarton);
  await db.product.update({ where: { id: productId }, data: normalized });
  return totalPieces;
}

export async function adjustWarehouseStock(
  db: WarehouseDb,
  input: {
    productId: string;
    warehouseId: string;
    deltaPieces: number;
    allowNegative?: boolean;
  }
) {
  await upsertWarehouseStock(db, {
    productId: input.productId,
    warehouseId: input.warehouseId,
  });

  const rows = await db.$queryRaw<Array<{ quantity_pieces: number }>>(Prisma.sql`
    SELECT "quantity_pieces"
    FROM "product_warehouse_stocks"
    WHERE "product_id" = ${input.productId}::uuid
      AND "warehouse_id" = ${input.warehouseId}::uuid
    FOR UPDATE
  `);
  const balanceBefore = rows[0]?.quantity_pieces ?? 0;
  const balanceAfter = balanceBefore + input.deltaPieces;

  // An INFLOW can never make a balance worse. Refusing "+100 into a row sitting
  // at -240" blocked the one operation that fixes a negative warehouse — you
  // could not receive a purchase into it until someone corrected the number by
  // hand. Only a withdrawal is ever worth guarding.
  const isWithdrawal = input.deltaPieces < 0;
  if (isWithdrawal && !input.allowNegative && balanceAfter < 0) {
    // Named, in Arabic, and with the numbers that matter. The old English
    // "Insufficient warehouse stock. Available: -240" named neither the product
    // nor the warehouse, so there was nothing to act on.
    const [prod, wh] = await Promise.all([
      db.product.findUnique({ where: { id: input.productId }, select: { name: true } }),
      db.branch.findUnique({ where: { id: input.warehouseId }, select: { name: true } }),
    ]);
    const whName = wh?.name ?? "المخزن";
    throw new AppError(
      `"${prod?.name ?? "المادة"}": ${whName} فيه ${balanceBefore} قطعة` +
        `${balanceBefore < 0 ? " (رصيد سالب)" : ""} والمطلوب ${Math.abs(input.deltaPieces)} — الرصيد سيصبح ${balanceAfter}.`,
      409,
      "INSUFFICIENT_WAREHOUSE_STOCK"
    );
  }

  await db.productWarehouseStock.update({
    where: {
      productId_warehouseId: {
        productId: input.productId,
        warehouseId: input.warehouseId,
      },
    },
    data: { quantityPieces: balanceAfter },
  });

  return { balanceBefore, balanceAfter };
}

export async function ensureLegacyWarehouseStock(
  db: WarehouseDb,
  product: {
    id: string;
    branchId: string | null;
    openingBalancePcs: number;
    cartonsAvailable: number;
    pcsPerCarton: number;
    storageLocation: string | null;
    minStock: number;
  }
) {
  const existing = await db.productWarehouseStock.count({ where: { productId: product.id } });
  if (existing > 0) return;

  const warehouseId = await resolveWarehouseId(db, product.branchId);
  await upsertWarehouseStock(db, {
    productId: product.id,
    warehouseId,
    quantityPieces:
      product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton,
    storageLocation: product.storageLocation,
    minStock: product.minStock,
  });
  if (!product.branchId) {
    await db.product.update({ where: { id: product.id }, data: { branchId: warehouseId } });
  }
}
