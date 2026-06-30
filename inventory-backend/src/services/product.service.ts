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
import { makeThumbnail } from "../utils/thumbnail";

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
  shopWarehouseId?: string | null,
  hidePurchasePrice = false
) {
  const warehouseTotal = product.warehouseStocks?.reduce(
    (sum, stock) => sum + stock.quantityPieces,
    0
  );
  // shopStock = pieces in المحل (the default sale warehouse). Sales come out of
  // here only, so the UI must show this rather than the all-warehouse total.
  const shopStock = shopWarehouseId
    ? product.warehouseStocks?.find((s) => s.warehouseId === shopWarehouseId)?.quantityPieces ?? 0
    : undefined;
  const result = {
    ...product,
    currentStock: warehouseTotal ?? stockFrom(product),
    ...(shopStock === undefined ? {} : { shopStock }),
  };
  // Staff without VIEW_PURCHASE_PRICE must never see cost price — stripped
  // server-side (not just hidden in the UI) so it can't leak via devtools.
  if (hidePurchasePrice) {
    const { purchasePrice, ...rest } = result as typeof result & { purchasePrice?: unknown };
    void purchasePrice;
    return rest;
  }
  return result;
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

// AWD-700, AWD-701, ... (counter starts at 700 and increments by 1)
const ITEM_NUMBER_COUNTER_KEY = "product_item_number_awd";

function encodeItemNumber(seq: number) {
  return `AWD-${seq}`;
}

async function nextItemNumber(db: Db): Promise<string> {
  const counter = await db.counter.upsert({
    where: { key: ITEM_NUMBER_COUNTER_KEY },
    update: { value: { increment: 1 } },
    create: { key: ITEM_NUMBER_COUNTER_KEY, value: 700 },
  });
  const candidate = encodeItemNumber(counter.value);
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
  hidePurchasePrice?: boolean;
}) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  // Smart multi-term search: every whitespace-separated token must match at
  // least one field (AND across tokens, OR across fields). So "بيبسي 0.5"
  // matches a product whose name has both, and "AWD-700" still matches the code.
  const searchTokens = (query.search ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(searchTokens.length
      ? {
          AND: searchTokens.map((token) => ({
            OR: [
              { name: { contains: token, mode: "insensitive" as const } },
              { itemNumber: { contains: token, mode: "insensitive" as const } },
              { qrCode: { contains: token, mode: "insensitive" as const } },
              { cartonQrCode: { contains: token, mode: "insensitive" as const } },
              { category: { contains: token, mode: "insensitive" as const } },
            ],
          })),
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
      omit: { imageUrl: true }, // list never needs the full image — thumbnailUrl is enough
      orderBy: { name: "asc" },
    });
    const filtered = rows
      .map((p) => serializeProduct(p, shopWarehouseId, query.hidePurchasePrice))
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
      omit: { imageUrl: true }, // list never needs the full image — thumbnailUrl is enough
      orderBy: { name: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  const data = rows.map((p) => serializeProduct(p, shopWarehouseId, query.hidePurchasePrice));

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

export async function getProductById(id: string, db: Db = prisma, hidePurchasePrice = false) {
  const product = await db.product.findFirst({
    where: { id, deletedAt: null },
    include: productWarehouseInclude,
  });

  if (!product) {
    throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
  }

  const shopWarehouseId = await resolveShopWarehouseId(db).catch(() => null);
  return serializeProduct(product, shopWarehouseId, hidePurchasePrice);
}

export async function getProductByQrCode(qrCode: string, db: Db = prisma, hidePurchasePrice = false) {
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

  // Tell the caller WHICH barcode matched so the POS can pre-select the right unit:
  // the carton barcode → CARTON, otherwise → PIECE.
  const code = qrCode.trim();
  const scannedUnit: "CARTON" | "PIECE" =
    product.cartonQrCode && product.cartonQrCode === code ? "CARTON" : "PIECE";

  return { ...serializeProduct(product, undefined, hidePurchasePrice), scannedUnit };
}

/* ─── Manual stock adjustment (تعديل الكمية يدوياً) ───────────────────── */
// Sets exact per-warehouse quantities (0 allowed), and records a StockMovement
// for each change WITHOUT an invoice/loss/transfer — so it never touches sales
// or profit, but stays in a clear audit log (who / when / from → to / why).
// Record a single per-warehouse stock change into the movement ledger so the
// product's "full history" shows creations and manual quantity edits too — not
// just sales/transfers/losses (those already write their own movements).
async function recordStockChange(
  tx: Db,
  args: {
    productId: string;
    warehouseId: string;
    before: number;
    after: number;
    note: string;
    user?: { id?: string; name?: string };
  }
) {
  if (args.after === args.before) return;
  await tx.stockMovement.create({
    data: {
      productId: args.productId,
      branchId: args.warehouseId,
      type: args.after > args.before ? "IN" : "OUT",
      quantity: Math.abs(args.after - args.before),
      balanceBefore: args.before,
      balanceAfter: args.after,
      userId: args.user?.id ?? null,
      userName: args.user?.name ?? null,
      note: args.note,
    },
  });
}

export async function adjustProductStockManual(
  productId: string,
  input: {
    warehouses: Array<{ warehouseId: string; quantityPieces: number }>;
    note?: string;
    user?: { id?: string; name?: string };
  }
) {
  const entries = (input.warehouses ?? []).filter(
    (w) => w.warehouseId && Number.isFinite(w.quantityPieces) && w.quantityPieces >= 0
  );
  if (entries.length === 0) throw new AppError("لا يوجد تعديل صالح", 400, "NO_ADJUSTMENT");

  await prisma.$transaction(async (tx) => {
    const existing = await tx.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } });
    if (!existing) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");

    for (const e of entries) {
      await upsertWarehouseStock(tx, { productId, warehouseId: e.warehouseId });
      const current = await tx.productWarehouseStock.findUnique({
        where: { productId_warehouseId: { productId, warehouseId: e.warehouseId } },
        select: { quantityPieces: true },
      });
      const before = current?.quantityPieces ?? 0;
      const after = Math.trunc(e.quantityPieces);
      if (after === before) continue;

      await tx.productWarehouseStock.update({
        where: { productId_warehouseId: { productId, warehouseId: e.warehouseId } },
        data: { quantityPieces: after },
      });

      await tx.stockMovement.create({
        data: {
          productId,
          branchId: e.warehouseId,
          type: after > before ? "IN" : "OUT",
          quantity: Math.abs(after - before),
          balanceBefore: before,
          balanceAfter: after,
          userId: input.user?.id ?? null,
          userName: input.user?.name ?? null,
          note: input.note?.trim() || "تعديل كمية يدوي",
        },
      });
    }

    await syncProductTotalStock(tx, productId);
  });

  return getProductById(productId);
}

// Manual adjustments only = movements with no invoice/loss/transfer link.
export async function listManualStockAdjustments(productId: string) {
  const rows = await prisma.stockMovement.findMany({
    where: { productId, invoiceId: null, lossId: null, transferId: null },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { branch: { select: { name: true } } },
  });
  return rows.map((m) => ({
    id: m.id,
    type: m.type,
    quantity: m.quantity,
    balanceBefore: m.balanceBefore,
    balanceAfter: m.balanceAfter,
    warehouseName: m.branch?.name ?? null,
    userName: m.userName,
    note: m.note,
    createdAt: m.createdAt,
  }));
}


// Full movement ledger for ONE product: creation, manual edits, sales, returns,
// transfers, and losses — across every warehouse, newest first. Each row carries
// a `source` tag + human reference so the UI can show "وين راحت/منين جت" exactly.
export async function listStockHistory(productId: string) {
  const rows = await prisma.stockMovement.findMany({
    where: { productId },
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      branch: { select: { name: true } },
      invoice: { select: { invoiceNumber: true, type: true } },
      transfer: {
        select: {
          transferNumber: true,
          fromBranch: { select: { name: true } },
          toBranch: { select: { name: true } },
        },
      },
      loss: { select: { id: true, reason: true } },
    },
  });

  return rows.map((m) => {
    let source:
      | "create"
      | "manual"
      | "sale"
      | "purchase"
      | "return"
      | "transfer"
      | "loss" = "manual";
    let reference: string | null = null;

    if (m.invoiceId && m.invoice) {
      const t = m.invoice.type;
      source = t === "PURCHASE" ? "purchase" : t === "SALES_RETURN" ? "return" : "sale";
      reference = m.invoice.invoiceNumber;
    } else if (m.transferId && m.transfer) {
      source = "transfer";
      reference = `${m.transfer.transferNumber} (${m.transfer.fromBranch?.name ?? "?"} ← ${m.transfer.toBranch?.name ?? "?"})`;
    } else if (m.lossId) {
      source = "loss";
      reference = m.loss?.reason ?? null;
    } else if ((m.note ?? "").includes("إنشاء")) {
      source = "create";
    } else {
      source = "manual";
    }

    return {
      id: m.id,
      type: m.type,
      quantity: m.quantity,
      balanceBefore: m.balanceBefore,
      balanceAfter: m.balanceAfter,
      warehouseName: m.branch?.name ?? null,
      userName: m.userName,
      note: m.note,
      source,
      reference,
      createdAt: m.createdAt,
    };
  });
}

export async function createProduct(
  input: ProductInput,
  createdBy: string,
  db: Db = prisma,
  user?: { id?: string; name?: string }
) {
  // Auto-generate item number / QR codes if not provided.
  const runner = async (tx: Db) => {
    const itemNumber = input.itemNumber?.trim() || (await nextItemNumber(tx));
    const { qrCode, cartonQrCode } = normalizeQrCodes(input);

    const warehouseId = await resolveWarehouseId(tx, input.branchId);
    const thumbnailUrl = await makeThumbnail(input.imageUrl);
    const product = await tx.product.create({
      data: {
        itemNumber,
        name: input.name,
        qrCode,
        cartonQrCode,
        imageUrl: input.imageUrl || null,
        thumbnailUrl,
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
        await recordStockChange(tx, {
          productId: product.id,
          warehouseId: d.warehouseId,
          before: 0,
          after: d.pieces,
          note: "إنشاء المادة",
          user,
        });
      }
      await syncProductTotalStock(tx, product.id);
    } else {
      // No distribution given. With opening stock AND more than one warehouse, we
      // can't guess where it lives unless the caller explicitly named a branch.
      if (totalPieces > 0 && !input.branchId) {
        const activeCount = await tx.branch.count({ where: { isActive: true } });
        if (activeCount > 1) {
          throw new AppError(
            "وزّع الكمية على المخازن أو حدّد المخزن قبل الحفظ (لا يمكن إضافة كمية بدون تحديد المخزن).",
            400,
            "WAREHOUSE_REQUIRED_FOR_QUANTITY"
          );
        }
      }
      await upsertWarehouseStock(tx, {
        productId: product.id,
        warehouseId,
        quantityPieces: totalPieces,
        storageLocation: input.storageLocation,
        minStock: input.minStock ?? 0,
      });
      await recordStockChange(tx, {
        productId: product.id,
        warehouseId,
        before: 0,
        after: totalPieces,
        note: "إنشاء المادة",
        user,
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
  db: Db = prisma,
  user?: { id?: string; name?: string }
) {
  const runner = async (tx: Db) => {
  const existing = await getProductById(id, tx);
  // Snapshot per-warehouse pieces BEFORE the edit so we can log each change.
  const beforeByWarehouse = new Map<string, number>();
  for (const s of existing.warehouseStocks ?? []) {
    beforeByWarehouse.set(s.warehouseId, s.quantityPieces);
  }
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
  if (input.imageUrl !== undefined) {
    data.imageUrl = input.imageUrl || null;
    // Regenerate the thumbnail whenever the image changes (or clear it if removed).
    data.thumbnailUrl = input.imageUrl ? await makeThumbnail(input.imageUrl) : null;
  }
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
    // Explicit per-warehouse redistribution — apply each warehouse's new stock directly.
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
      await recordStockChange(tx, {
        productId: id,
        warehouseId: d.warehouseId,
        before: beforeByWarehouse.get(d.warehouseId) ?? 0,
        after: d.pieces,
        note: "تعديل كمية يدوي",
        user,
      });
    }
    await syncProductTotalStock(tx, id);
  } else {
    const quantityWasEdited =
      input.openingBalancePcs !== undefined || input.cartonsAvailable !== undefined;
    const warehouseMetadataWasEdited =
      input.storageLocation !== undefined || input.minStock !== undefined;

    // How many warehouses can hold stock right now. Bare quantity edits (no
    // explicit per-warehouse distribution) are only unambiguous when there is a
    // single warehouse — otherwise writing the GLOBAL total onto one guessed
    // warehouse is exactly what corrupted sibling depots (e.g. شارع العباس).
    const activeWarehouses = await tx.branch.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    const pcsPerCarton = input.pcsPerCarton ?? product.pcsPerCarton;

    if (quantityWasEdited) {
      const currentTotalPieces =
        existing.openingBalancePcs + existing.cartonsAvailable * existing.pcsPerCarton;
      const requestedTotalPieces =
        (input.openingBalancePcs ?? existing.openingBalancePcs) +
        (input.cartonsAvailable ?? existing.cartonsAvailable) * pcsPerCarton;

      if (activeWarehouses.length > 1) {
        // Multi-warehouse shop: a bare quantity field cannot say WHICH warehouse
        // changed. If the total actually changed, reject and force the caller to
        // send `warehouseDistribution` (or use the per-warehouse adjust-stock
        // endpoint). If it's unchanged (a plain re-save of a non-stock field),
        // ignore it silently so normal edits don't break.
        if (requestedTotalPieces !== currentTotalPieces) {
          throw new AppError(
            "حدّد المخزن ووزّع الكمية على المخازن عند تغيير الكمية (لا يمكن تعديل الكمية بدون تحديد المخزن).",
            400,
            "WAREHOUSE_REQUIRED_FOR_QUANTITY"
          );
        }
      } else {
        // Single warehouse: global total == that warehouse, so it's unambiguous.
        const warehouseId = await resolveWarehouseId(tx, product.branchId);
        const targetPieces =
          existing.warehouseStocks?.find((stock: any) => stock.warehouseId === warehouseId)
            ?.quantityPieces ?? 0;
        await upsertWarehouseStock(tx, {
          productId: id,
          warehouseId,
          quantityPieces: requestedTotalPieces,
          storageLocation: input.storageLocation,
          minStock: input.minStock,
        });
        if (requestedTotalPieces !== targetPieces) {
          await recordStockChange(tx, {
            productId: id,
            warehouseId,
            before: targetPieces,
            after: requestedTotalPieces,
            note: "تعديل كمية يدوي",
            user,
          });
        }
        await syncProductTotalStock(tx, id);
      }
    }

    // Warehouse metadata (storage location / min stock) or an explicit branch
    // move — never touches quantity, so it's safe to apply to the resolved
    // warehouse regardless of warehouse count.
    if (warehouseMetadataWasEdited || input.branchId !== undefined) {
      const warehouseId = await resolveWarehouseId(tx, input.branchId ?? product.branchId);
      await upsertWarehouseStock(tx, {
        productId: id,
        warehouseId,
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

const RESTORE_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours

export async function getDeletedProducts(db: Db = prisma) {
  const cutoff = new Date(Date.now() - RESTORE_WINDOW_MS);
  const products = await db.product.findMany({
    where: { deletedAt: { not: null, gte: cutoff } },
    orderBy: { deletedAt: "desc" },
  });
  return products.map((p) => serializeProduct(p));
}

export async function restoreProduct(id: string, db: Db = prisma) {
  const product = await db.product.findUnique({ where: { id } });
  if (!product) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
  if (!product.deletedAt) throw new AppError("المادة غير محذوفة", 400, "PRODUCT_NOT_DELETED");

  const cutoff = new Date(Date.now() - RESTORE_WINDOW_MS);
  if (product.deletedAt < cutoff) throw new AppError("انتهت مهلة الاسترجاع (48 ساعة)", 400, "RESTORE_WINDOW_EXPIRED");

  const restored = await db.product.update({
    where: { id },
    data: { deletedAt: null },
  });
  return serializeProduct(restored);
}

/**
 * List "stale" products — items with NO stock movement (no sale, transfer, loss,
 * or restock) for the last `days` days. Products created within the window are
 * excluded (they're new, not stale). Returns last-activity date + current stock
 * so the user can decide whether to delete or keep each one.
 */
export async function getStaleProducts(days = 60) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const shopWarehouseId = await resolveShopWarehouseId(prisma).catch(() => null);

  const products = await prisma.product.findMany({
    where: {
      deletedAt: null,
      createdAt: { lt: cutoff }, // brand-new products are never "stale"
    },
    include: {
      ...productWarehouseInclude,
      stockMovements: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
    omit: { imageUrl: true },
    orderBy: { name: "asc" },
  });

  const stale = products
    .filter((p) => {
      const lastMovement = p.stockMovements[0]?.createdAt;
      // Stale = either never moved, or last movement is older than the cutoff.
      return !lastMovement || lastMovement < cutoff;
    })
    .map((p) => {
      const { stockMovements, ...rest } = p;
      return {
        ...serializeProduct(rest, shopWarehouseId),
        lastMovementAt: stockMovements[0]?.createdAt ?? null,
      };
    });

  return { days, cutoff, count: stale.length, data: stale };
}

/** Soft-delete many products at once (used by the stale-products cleanup). */
export async function bulkDeleteProducts(ids: string[]) {
  if (!ids.length) return { deleted: 0 };
  const result = await prisma.product.updateMany({
    where: { id: { in: ids }, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return { deleted: result.count };
}

/**
 * One-time admin op: generate thumbnails for existing products that have an
 * image but no thumbnail yet (so the legacy 1000 products load fast too).
 */
export async function backfillThumbnails() {
  const products = await prisma.product.findMany({
    where: { deletedAt: null, imageUrl: { not: null }, thumbnailUrl: null },
    select: { id: true, imageUrl: true },
  });
  let updated = 0;
  for (const p of products) {
    const thumbnailUrl = await makeThumbnail(p.imageUrl);
    if (thumbnailUrl) {
      await prisma.product.update({ where: { id: p.id }, data: { thumbnailUrl } });
      updated++;
    }
  }
  return { scanned: products.length, updated };
}

// Guarantees the product has a carton QR code DISTINCT from its piece code,
// generating and persisting one if missing. Called right before printing a
// carton label so the label never accidentally encodes the piece code (which
// would make a carton scan register as a single piece).
export async function ensureCartonQrCode(productId: string): Promise<string> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { qrCode: true, cartonQrCode: true },
  });
  if (!product) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");

  if (product.cartonQrCode && product.cartonQrCode !== product.qrCode) {
    return product.cartonQrCode;
  }
  const cartonQrCode = generateCartonQrCode();
  await prisma.product.update({ where: { id: productId }, data: { cartonQrCode } });
  return cartonQrCode;
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
