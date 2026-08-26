import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
import { normalizePhone } from "../utils/phone";
import { makeThumbnail } from "../utils/thumbnail";

/* ══════════════════════════════════════════════════════════════════════
   «احجز البضاعة القادمة الجديدة»

   Goods the shop has bought but not received. Customers reserve against them
   before they land, so the shipment is half sold on arrival instead of
   sitting in the warehouse waiting to be noticed.

   Nothing here touches stock. A reservation is a promise about goods that do
   not exist in the system yet; turning it into a real order is a decision the
   shop makes once the shipment actually arrives.
══════════════════════════════════════════════════════════════════════ */

export type IncomingItemInput = {
  name: string;
  description?: string;
  imageUrl?: string;
  expectedAt?: string | null;
  price?: number | null;
  active?: boolean;
  sortOrder?: number;
};

/* ── Public ────────────────────────────────────────────────────────── */

/**
 * What the storefront shows. Inactive rows never leave the server, so hiding
 * an item is enough to take it down without deleting the reservations people
 * have already made against it.
 */
export async function listPublicIncomingItems() {
  const rows = await prisma.catalogIncomingItem.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    select: {
      id: true, name: true, description: true, imageUrl: true,
      expectedAt: true, price: true,
    },
    take: 60,
  });
  return rows.map((r) => ({ ...r, price: r.price == null ? null : Number(r.price) }));
}

/**
 * Reserve, or change an existing reservation.
 *
 * Upserted on (item, phone): pressing «احجز» twice updates the quantity
 * rather than queueing a second promise for the same goods, which would have
 * the shop counting one customer as two.
 */
export async function reserveIncomingItem(input: {
  itemId: string;
  phone: string;
  name?: string;
  quantity?: number;
  note?: string;
}) {
  const phone = normalizePhone(String(input.phone ?? ""));
  if (!phone) throw new AppError("رقم هاتف غير صالح", 400, "PHONE_INVALID");

  const item = await prisma.catalogIncomingItem.findFirst({
    where: { id: input.itemId, active: true },
    select: { id: true, name: true },
  });
  if (!item) throw new AppError("هذه المادة غير متاحة للحجز", 404, "INCOMING_ITEM_NOT_FOUND");

  const quantity = Math.max(1, Math.min(9999, Math.round(Number(input.quantity) || 1)));

  await prisma.catalogIncomingReservation.upsert({
    where: { itemId_phone: { itemId: item.id, phone } },
    update: { quantity, note: input.note?.trim() || null, name: input.name?.trim() || undefined },
    create: {
      itemId: item.id,
      phone,
      name: input.name?.trim() || null,
      quantity,
      note: input.note?.trim() || null,
    },
  });

  // Best-effort: the reservation is recorded either way, and a failed
  // notification must not read to the shopper as a failed reservation.
  try {
    const { notifyAdmin } = await import("./app-notification.service");
    await notifyAdmin({
      type: "catalog_incoming_reservation",
      category: "catalog",
      severity: "info",
      title: "حجز بضاعة قادمة",
      message: `${input.name?.trim() || phone} حجز ${quantity} من «${item.name}»`,
      entityType: "catalog_incoming_item",
      entityId: item.id,
    });
  } catch (err) {
    logger.warn(`[CatalogIncoming] notify failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { ok: true, quantity };
}

/**
 * What this shopper has already reserved, so the storefront can show it back.
 *
 * Returns quantities only — never names, notes or anyone else's rows. A phone
 * number in a query string is not proof of identity, so this deliberately
 * exposes nothing a person could not already guess about themselves.
 */
export async function listMyReservations(rawPhone: string) {
  const phone = normalizePhone(String(rawPhone ?? ""));
  if (!phone) return {};
  const rows = await prisma.catalogIncomingReservation.findMany({
    where: { phone, status: { not: "CANCELLED" } },
    select: { itemId: true, quantity: true },
  });
  return Object.fromEntries(rows.map((r) => [r.itemId, r.quantity]));
}

/* ── Admin ─────────────────────────────────────────────────────────── */

export async function listIncomingItems() {
  const rows = await prisma.catalogIncomingItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: { _count: { select: { reservations: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    imageUrl: r.imageUrl,
    expectedAt: r.expectedAt,
    price: r.price == null ? null : Number(r.price),
    active: r.active,
    sortOrder: r.sortOrder,
    reservationCount: r._count.reservations,
  }));
}

async function itemData(input: IncomingItemInput) {
  const name = String(input.name ?? "").trim();
  if (name.length < 2) throw new AppError("الاسم مطلوب", 400, "NAME_REQUIRED");

  // Shrunk to a thumbnail before it is stored, the way products already are.
  // The public list returns every item's picture inline, so keeping originals
  // would have sent megabytes down a shopper's phone connection to draw a row
  // of 150px cards — the exact problem the product grid was fixed for.
  const raw = input.imageUrl?.trim() || null;
  const imageUrl = raw ? (await makeThumbnail(raw)) ?? raw : null;

  return {
    name,
    description: input.description?.trim() || null,
    imageUrl,
    expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
    price: input.price == null || Number.isNaN(Number(input.price)) ? null : Number(input.price),
    active: input.active !== false,
    sortOrder: Math.round(Number(input.sortOrder) || 0),
  };
}

export async function createIncomingItem(input: IncomingItemInput) {
  return prisma.catalogIncomingItem.create({ data: await itemData(input) });
}

export async function updateIncomingItem(id: string, input: IncomingItemInput) {
  return prisma.catalogIncomingItem.update({ where: { id }, data: await itemData(input) });
}

/** Deleting takes its reservations with it — see the cascade on the relation. */
export async function deleteIncomingItem(id: string) {
  await prisma.catalogIncomingItem.delete({ where: { id } });
  return { ok: true };
}

export async function listItemReservations(itemId: string) {
  return prisma.catalogIncomingReservation.findMany({
    where: { itemId },
    orderBy: { createdAt: "desc" },
    select: { id: true, phone: true, name: true, quantity: true, note: true, status: true, createdAt: true },
  });
}

export async function setReservationStatus(id: string, status: "PENDING" | "CONFIRMED" | "CANCELLED") {
  return prisma.catalogIncomingReservation.update({ where: { id }, data: { status } });
}
