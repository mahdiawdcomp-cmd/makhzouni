import { Prisma, TransferStatus, Unit, StockMovementType } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
import { approvalRequestTypes, createPendingApproval } from "./approval.service";
import { getSettings } from "./settings.service";
import { sendWhatsAppText } from "./whatsapp.service";
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

function pieces(item: TransferItemInput, pcsPerCarton: number) {
  return item.unit === Unit.CARTON
    ? item.quantity * pcsPerCarton
    : item.unit === Unit.DOZEN
      ? item.quantity * 12
      : item.quantity;
}

// Snapshot the source-warehouse availability for each item so the approval can
// show "available now" and warn when the request exceeds it.
export async function buildTransferSnapshot(input: CreateTransferInput) {
  const [fromWh, toWh, products] = await Promise.all([
    prisma.branch.findFirst({ where: { id: input.fromBranchId }, select: { id: true, name: true } }),
    prisma.branch.findFirst({ where: { id: input.toBranchId }, select: { id: true, name: true } }),
    prisma.product.findMany({
      where: { id: { in: input.items.map((i) => i.productId) }, deletedAt: null },
      select: { id: true, name: true, itemNumber: true, pcsPerCarton: true },
    }),
  ]);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const stocks = await prisma.productWarehouseStock.findMany({
    where: { warehouseId: input.fromBranchId, productId: { in: input.items.map((i) => i.productId) } },
    select: { productId: true, quantityPieces: true },
  });
  const stockMap = new Map(stocks.map((s) => [s.productId, s.quantityPieces]));

  const items = input.items.map((it) => {
    const p = productMap.get(it.productId);
    const requestedPieces = p ? pieces(it, p.pcsPerCarton) : it.quantity;
    const availablePieces = stockMap.get(it.productId) ?? 0;
    return {
      productId: it.productId,
      productName: p?.name ?? it.productId,
      itemNumber: p?.itemNumber ?? "",
      unit: it.unit,
      quantity: it.quantity,
      requestedPieces,
      availablePieces,
      exceedsStock: requestedPieces > availablePieces,
    };
  });

  return {
    fromName: fromWh?.name ?? "",
    toName: toWh?.name ?? "",
    items,
    anyExceeds: items.some((i) => i.exceedsStock),
  };
}

// Notify admin (and optionally assigned staff) that a transfer was requested.
async function notifyTransferRequested(requesterName: string, snapshot: Awaited<ReturnType<typeof buildTransferSnapshot>>) {
  const settings = await getSettings().catch(() => null);
  const target = settings?.adminApprovalWhatsappNumber?.trim() || settings?.storePhone?.trim();
  const lines = snapshot.items
    .map((i) => `• ${i.productName}: ${i.quantity} ${i.unit === "CARTON" ? "كرتون" : "قطعة"}${i.exceedsStock ? " ⚠️ أكبر من المتوفر" : ""}`)
    .join("\n");
  const message =
    `🔄 طلب تحويل جديد\n` +
    `الموظف: ${requesterName}\n` +
    `من: ${snapshot.fromName}\nإلى: ${snapshot.toName}\n${lines}\n\n` +
    `راجع وأقرّ من صفحة (الطلبات المعلّقة).`;
  if (target) await sendWhatsAppText(target, message).catch(() => {});
  else logger.warn("[Transfer] no admin WhatsApp number configured for transfer-request notice");
}

// Notify the requester (if they have a phone) + admin about an approve/reject.
export async function notifyTransferReviewed(
  requestData: unknown,
  requestedBy: string,
  status: "APPROVED" | "REJECTED"
) {
  const data = (requestData ?? {}) as {
    snapshot?: { fromName?: string; toName?: string; items?: Array<{ productName: string; quantity: number; unit: string }> };
    requesterName?: string;
  };
  const snap = data.snapshot ?? {};
  const verb = status === "APPROVED" ? "تمت الموافقة على" : "تم رفض";
  const lines = (snap.items ?? [])
    .map((i) => `• ${i.productName}: ${i.quantity} ${i.unit === "CARTON" ? "كرتون" : "قطعة"}`)
    .join("\n");
  const message =
    `${status === "APPROVED" ? "✅" : "❌"} ${verb} طلب التحويل\n` +
    `من: ${snap.fromName ?? ""}\nإلى: ${snap.toName ?? ""}\n${lines}`;

  const settings = await getSettings().catch(() => null);
  const adminTarget = settings?.adminApprovalWhatsappNumber?.trim() || settings?.storePhone?.trim();

  const requester = requestedBy
    ? await prisma.user.findUnique({ where: { id: requestedBy }, select: { phone: true, name: true } }).catch(() => null)
    : null;

  if (requester?.phone?.trim()) {
    await sendWhatsAppText(requester.phone.trim(), message).catch(() => {});
  } else {
    logger.warn(`[Transfer] لا يمكن إرسال إشعار للموظف (${requester?.name ?? requestedBy}) لعدم وجود رقم هاتف.`);
  }
  if (adminTarget) await sendWhatsAppText(adminTarget, message).catch(() => {});
}

// Create a transfer REQUEST that waits for approval (does not move stock yet).
export async function createTransferRequest(input: CreateTransferInput, requestedBy: string, requesterName: string) {
  if (input.fromBranchId === input.toBranchId) {
    throw new AppError("Source and destination warehouses must be different", 400, "INVALID_TRANSFER");
  }
  if (!input.items?.length) {
    throw new AppError("Transfer must have at least one item", 400, "INVALID_TRANSFER");
  }
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new AppError("Transfer quantity must be positive", 400, "INVALID_TRANSFER_QUANTITY");
    }
  }
  const warehouses = await prisma.branch.findMany({
    where: { id: { in: [input.fromBranchId, input.toBranchId] }, isActive: true },
    select: { id: true },
  });
  if (warehouses.length !== 2) {
    throw new AppError("Warehouse not found or inactive", 404, "WAREHOUSE_NOT_FOUND");
  }

  const snapshot = await buildTransferSnapshot(input);
  const approval = await createPendingApproval(
    approvalRequestTypes.CREATE_TRANSFER,
    {
      body: input,
      snapshot,
      requesterName,
    },
    requestedBy,
    requesterName
  );

  setImmediate(() => {
    notifyTransferRequested(requesterName, snapshot).catch((err) =>
      logger.error(`[Transfer] request notify failed: ${err}`)
    );
  });

  return { approvalId: approval.id, snapshot };
}

export async function createTransfer(input: CreateTransferInput, createdBy: string) {
  if (input.fromBranchId === input.toBranchId) {
    throw new AppError("Source and destination warehouses must be different", 400, "INVALID_TRANSFER");
  }
  if (!input.items?.length) {
    throw new AppError("Transfer must have at least one item", 400, "INVALID_TRANSFER");
  }
  return prisma.$transaction((tx) => executeTransferWithin(tx, input, createdBy, false));
}

// The actual stock movement + transfer record. Used directly (admin immediate)
// and from the approval executor (allowNegative=true so an approved transfer
// always goes through, surfacing any deficit later in the stocktake).
export async function executeTransferWithin(
  tx: Prisma.TransactionClient,
  input: CreateTransferInput,
  createdBy: string,
  allowNegative: boolean
) {
  {
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
        allowNegative,
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
  }
}
