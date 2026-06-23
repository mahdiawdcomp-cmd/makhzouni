import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import {
  ensureLegacyWarehouseStock,
  resolveShopWarehouseId,
  resolveWarehouseId,
  syncProductTotalStock,
  upsertWarehouseStock,
} from "./warehouse-stock.service";
import { validateDistribution } from "../utils/warehouse-math";

type Db = Prisma.TransactionClient | typeof prisma;

type ProductInput = {
  itemNumber?: string;
  name: string;
  qrCode?: string;
  cartonQrCode?: string;
  imageUrl?: string | null;
  category?: string;
  categoryTags?: string[];
  typeTags?: string[];
  isNewArrival?: boolean;
  isOffer?: boolean;
  oldPrice?: number | null;
  openingBalancePcs?: number;
  cartonsAvailable?: number;
  pcsPerCarton?: number;
  purchasePrice?: number;
  salePrice?: number;
  retailPrice?: number;
  costPrice?: number;
  expiryDate?: string | null;
  minStock?: number;
  storageLocation?: string | null;
  branchId?: string;
  // Optional split of the opening stock across warehouses (pieces per warehouse).
  // When given, the sum must equal the total opening pieces.
  warehouseDistribution?: { warehouseId: string; pieces: number }[];
};

function stockFrom(product: {
  openingBalancePcs: number;
  cartonsAvailable: number;
  pcsPerCarton: number;
}) {
  return product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton;
}

function serializeProduct<T extends {
  openingBalancePcs: number;
  cartonsAvailable: number;
  pcsPerCarton: number;
  warehouseStocks?: Array<{ quantityPieces: number; warehouseId?: string }>;
}>(
  product: T,
  shopWarehouseId?: string | null
) {
  const warehouseTotal = product.warehouseStocks?.reduce(
    (sum, stock) => sum + stock.quantityPieces,
    0
  );
  // shopStock = pieces in Ø§Ù„Ù…Ø­Ù„ (the default sale warehouse). Sales come out of
  // here only, so the UI must show this rather than the all-warehouse total.
  const shopStock = shopWarehouseId
    ? product.warehouseStocks?.find((s) => s.warehouseId === shopWarehouseId)?.quantityPieces ?? 0
    : undefined;
  return {
    ...product,
    currentStock: warehouseTotal ?? stockFrom(product),
    ...(shopStock === undefined ? {} : { shopStock }),
  };
}

const productWarehouseInclude = {
  warehouseStocks: {
    include: {
      warehouse: { select: { id: true, name: true, code: true, isActive: true } },
    },
    orderBy: { warehouse: { name: "asc" as const } },
  },
  branch: { select: { id: true, name: true, code: true } },
};

// ---------- Auto-generation helpers ----------

const ITEM_NUMBER_COUNTER_KEY = "product_item_number";

// AB0001 â†’ AB9999 â†’ AC0001 ... ZZ9999 (676 Ã— 10000 = 6.76M codes)
function encodeItemNumber(seq: number) {
  const within = ((seq - 1) % 10000) + 1; // 1..10000
  const letterIdx = Math.floor((seq - 1) / 10000); // 0..675 (AA..ZZ)
  const A = "A".charCodeAt(0);
  const first = String.fromCharCode(A + Math.floor(letterIdx / 26));
  const second = String.fromCharCode(A + (letterIdx % 26));
  return `${first}${second}${String(within).padStart(4, "0")}`;
}

async function nextItemNumber(db: Db): Promise<string> {
  // upsert + increment atomically; on Postgres this is a single round-trip
  const counter = await db.counter.upsert({
    where: { key: ITEM_NUMBER_COUNTER_KEY },
    update: { value: { increment: 1 } },
    create: { key: ITEM_NUMBER_COUNTER_KEY, value: 1 },
  });
  const candidate = encodeItemNumber(counter.value);
  // protect against the (rare) case where a manually-typed item number already uses this code
  const clash = await db.product.findUnique({ where: { itemNumber: candidate } });
  if (clash) return nextItemNumber(db);
  return candidate;
}

function generateQrCode() {
  return `PCS-${randomUUID()}`;
}

function generateCartonQrCode() {
  return `CTN-${randomUUID()}`;
}

function normalizeQrCodes(input: { qrCode?: string | null; cartonQrCode?: string | null }) {
  const qrCode = input.qrCode?.trim() || generateQrCode();
  const cartonQrCodeInput = input.cartonQrCode?.trim();
  const cartonQrCode =
    cartonQrCodeInput && cartonQrCodeInput !== qrCode
      ? cartonQrCodeInput
      : generateCartonQrCode();

  return { qrCode, cartonQrCode };
}

// ---------- CRUD ----------

export async function listProducts(query: {
  search?: string;
  category?: string;
  lowStock?: boolean;
  branchId?: string;
  page?: number;
  limit?: number;
}) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search } },
            { itemNumber: { contains: query.search } },
            { qrCode: { contains: query.search } },
            { cartonQrCode: { contains: query.search } },
          ],
        }
      : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.branchId
      ? { warehouseStocks: { some: { warehouseId: query.branchId } } }
      : {}),
  };

  const shopWarehouseId = await resolveShopWarehouseId(prisma).catch(() => null);

  if (query.lowStock) {
    const rows = await prisma.product.findMany({
      where,
      include: productWarehouseInclude,
      orderBy: { name: "asc" },
    });
    const filtered = rows
      .map((p) => serializeProduct(p, shopWarehouseId))
      .filter((product) => product.currentStock <= product.minStock);
    const total = filtered.length;
    const data = filtered.slice((page - 1) * limit, page * limit);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: productWarehouseInclude,
      orderBy: { name: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  const data = rows.map((p) => serializeProduct(p, shopWarehouseId));

  return {
    data,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
}

export async function getProductById(id: string, db: Db = prisma) {
  const product = await db.product.findFirst({
    where: { id, deletedAt: null },
    include: productWarehouseInclude,
  });

  if (!product) {
    throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
  }

  const shopWarehouseId = await resolveShopWarehouseId(db).catch(() => null);
  return serializeProduct(product, shopWarehouseId);
}

export async function getProductByQrCode(qrCode: string, db: Db = prisma) {
  const product = await db.product.findFirst({
    where: {
      OR: [{ qrCode }, { cartonQrCode: qrCode }],
      deletedAt: null,
    },
    include: productWarehouseInclude,
  });

  if (!product) {
    throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
  }

  return serializeProduct(product);
}

export async function createProduct(
  input: ProductInput,
  createdBy: string,
  db: Db = prisma
) {
  // Auto-generate item number / QR codes if not provided.
  const runner = async (tx: Db) => {
    const itemNumber = input.itemNumber?.trim() || (await nextItemNumber(tx));
    const { qrCode, cartonQrCode } = normalizeQrCodes(input);

    const warehouseId = await resolveWarehouseId(tx, input.branchId);
    const product = await tx.product.create({
      data: {
        itemNumber,
        name: input.name,
        qrCode,
        cartonQrCode,
        imageUrl: input.imageUrl || null,
        category: input.category?.trim() || null,
        categoryTags: input.categoryTags ?? [],
        typeTags: input.typeTags ?? [],
        isNewArrival: input.isNewArrival ?? false,
        isOffer: input.isOffer ?? false,
        oldPrice: input.oldPrice ?? null,
        openingBalancePcs: input.openingBalancePcs ?? 0,
        cartonsAvailable: input.cartonsAvailable ?? 0,
        pcsPerCarton: input.pcsPerCarton ?? 1,
        purchasePrice: input.purchasePrice ?? 0,
        salePrice: input.salePrice ?? 0,
        retailPrice: input.retailPrice ?? 0,
        costPrice: input.costPrice ?? 0,
        expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
        minStock: input.minStock ?? 0,
        storageLocation: input.storageLocation?.trim() || null,
        branchId: warehouseId,
        createdBy,
      },
    });

    const totalPieces =
      (input.openingBalancePcs ?? 0) +
      (input.cartonsAvailable ?? 0) * (input.pcsPerCarton ?? 1);

    const rawDistribution = (input.warehouseDistribution ?? []).filter((d) => d.pieces > 0);
    if (rawDistribution.length > 0) {
      // Distribute the opening stock across the chosen warehouses (sum must match).
      const distribution = validateDistribution(rawDistribution, totalPieces);
      const validWarehouses = await tx.branch.findMany({
        where: { id: { in: distribution.map((d) => d.warehouseId) }, isActive: true },
        select: { id: true },
      });
      const validIds = new Set(validWarehouses.map((w) => w.id));
      for (const d of distribution) {
        if (!validIds.has(d.warehouseId)) {
          throw new AppError("Warehouse not found or inactive", 404, "WAREHOUSE_NOT_FOUND");
        }
        await upsertWarehouseStock(tx, {
          productId: product.id,
          warehouseId: d.warehouseId,
          quantityPieces: d.pieces,
          storageLocation: input.storageLocation,
          minStock: input.minStock ?? 0,
        });
      }
      await syncProductTotalStock(tx, product.id);
    } else {
      await upsertWarehouseStock(tx, {
        productId: product.id,
        warehouseId,
        quantityPieces: totalPieces,
        storageLocation: input.storageLocation,
        minStock: input.minStock ?? 0,
      });
    }

    return tx.product.findUniqueOrThrow({
      where: { id: product.id },
      include: productWarehouseInclude,
    });
  };

  // If a TransactionClient was passed in (e.g. from approval flow), reuse it; otherwise open one.
  const product = db === prisma ? await prisma.$transaction(runner) : await runner(db);

  return serializeProduct(product);
}

export async function updateProduct(
  id: string,
  input: Partial<ProductInput>,
  db: Db = prisma
) {
  const runner = async (tx: Db) => {
  const existing = await getProductById(id, tx);
  const data: Prisma.ProductUpdateInput = {};
  if (input.itemNumber !== undefined) data.itemNumber = input.itemNumber;
  if (input.name !== undefined) data.name = input.name;
  if (input.qrCode !== undefined || input.cartonQrCode !== undefined) {
    const nextQrCode = input.qrCode !== undefined ? input.qrCode : existing.qrCode;
    const nextCartonQrCode =
      input.cartonQrCode !== undefined ? input.cartonQrCode : existing.cartonQrCode;
    const normalized = normalizeQrCodes({
      qrCode: nextQrCode,
      cartonQrCode: nextCartonQrCode,
    });
    data.qrCode = normalized.qrCode;
    data.cartonQrCode = normalized.cartonQrCode;
  }
  if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl || null;
  if (input.category !== undefined) data.category = input.category?.trim() || null;
  if (input.openingBalancePcs !== undefined) data.openingBalancePcs = input.openingBalancePcs;
  if (input.cartonsAvailable !== undefined) data.cartonsAvailable = input.cartonsAvailable;
  if (input.pcsPerCarton !== undefined) data.pcsPerCarton = input.pcsPerCarton;
  if (input.purchasePrice !== undefined) data.purchasePrice = input.purchasePrice;
  if (input.salePrice !== undefined) data.salePrice = input.salePrice;
  if (input.retailPrice !== undefined) data.retailPrice = input.retailPrice;
  if (input.costPrice !== undefined) data.costPrice = input.costPrice;
  if (input.expiryDate !== undefined) data.expiryDate = input.expiryDate ? new Date(input.expiryDate) : null;
  if (input.minStock !== undefined) data.minStock = input.minStock;
  if (input.storageLocation !== undefined) data.storageLocation = input.storageLocation?.trim() || null;
  if (input.branchId !== undefined) data.branch = input.branchId ? { connect: { id: input.branchId } } : { disconnect: true };
  if (input.categoryTags !== undefined) data.categoryTags = input.categoryTags;
  if (input.typeTags !== undefined) data.typeTags = input.typeTags;
  if (input.isNewArrival !== undefined) data.isNewArrival = input.isNewArrival;
  if (input.isOffer !== undefined) data.isOffer = input.isOffer;
  if (input.oldPrice !== undefined) data.oldPrice = input.oldPrice;

  const product = await tx.product.update({
    where: { id },
    data,
  });

  await ensureLegacyWarehouseStock(tx, product);

  const rawDistribution = (input.warehouseDistribution ?? []).filter((d) => d.pieces >= 0);
  if (rawDistribution.length > 0) {
    // Explicit per-warehouse redistribution â€” apply each warehouse's new stock directly.
    const validWarehouses = await tx.branch.findMany({
      where: { id: { in: rawDistribution.map((d) => d.warehouseId) }, isActive: true },
      select: { id: true },
    });
    const validIds = new Set(validWarehouses.map((w) => w.id));
    for (const d of rawDistribution) {
      if (!validIds.has(d.warehouseId)) {
        throw new AppError("Warehouse not found or inactive", 404, "WAREHOUSE_NOT_FOUND");
      }
      await upsertWarehouseStock(tx, {
        productId: id,
        warehouseId: d.warehouseId,
        quantityPieces: d.pieces,
        storageLocation: input.storageLocation,
        minStock: input.minStock ?? 0,
      });
    }
    await syncProductTotalStock(tx, id);
  } else {
    const quantityWasEdited =
      input.openingBalancePcs !== undefined || input.cartonsAvailable !== undefined;
    const warehouseMetadataWasEdited =
      input.storageLocation !== undefined || input.minStock !== undefined;

    if (input.branchId !== undefined || quantityWasEdited || warehouseMetadataWasEdited) {
      const warehouseId = await resolveWarehouseId(tx, input.branchId ?? product.branchId);
      const pcsPerCarton = input.pcsPerCarton ?? product.pcsPerCarton;
      const targetStock = existing.warehouseStocks?.find(
        (stock: any) => stock.warehouseId === warehouseId
      );
      const targetPieces = targetStock?.quantityPieces ?? 0;
      const targetCartons = targetPieces >= 0 ? Math.floor(targetPieces / pcsPerCarton) : 0;
      const targetLoosePieces = targetPieces - targetCartons * pcsPerCarton;
      const quantityPieces = quantityWasEdited
        ? (input.openingBalancePcs ?? targetLoosePieces) +
          (input.cartonsAvailable ?? targetCartons) * pcsPerCarton
        : undefined;

      await upsertWarehouseStock(tx, {
        productId: id,
        warehouseId,
        quantityPieces,
        storageLocation: input.storageLocation,
        minStock: input.minStock,
      });
      await syncProductTotalStock(tx, id);
    }
  }

  return tx.product.findUniqueOrThrow({
    where: { id },
    include: productWarehouseInclude,
  });
  };

  const product = db === prisma ? await prisma.$transaction(runner) : await runner(db);
  return serializeProduct(product);
}

export async function deleteProduct(id: string, db: Db = prisma) {
  await getProductById(id, db);
  const product = await db.product.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return serializeProduct(product);
}

// Backfill missing QR codes / carton QR codes for legacy products (admin op).
export async function backfillQrCodes() {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: { id: true, qrCode: true, cartonQrCode: true },
  });
  let updated = 0;
  for (const p of products) {
    const data: { qrCode?: string; cartonQrCode?: string } = {};
    if (!p.qrCode) data.qrCode = generateQrCode();
    const nextQrCode = data.qrCode ?? p.qrCode;
    if (!p.cartonQrCode || p.cartonQrCode === nextQrCode) {
      data.cartonQrCode = generateCartonQrCode();
    }
    if (Object.keys(data).length) {
      await prisma.product.update({ where: { id: p.id }, data });
      updated++;
    }
  }
  return { updated };
}
