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
    // Arrived goods leave this list by definition: it is about what has NOT
    // landed, and leaving them would invite reservations for stock that is
    // already on the shelf and orderable normally.
    where: { active: true, arrivedAt: null },
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
    where: { id: input.itemId, active: true, arrivedAt: null },
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
    arrivedAt: r.arrivedAt,
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

/**
 * «وصلت البضاعة» — close the loop the reservation opened.
 *
 * Marks the shipment as landed, takes it off the storefront, and tells
 * everyone still holding a reservation. It deliberately does NOT create orders
 * or invoices: quantities were promised weeks ago against goods nobody had
 * seen, and turning that into a sale without asking would bill people for
 * something they may no longer want. The message brings them back instead.
 *
 * Cancelled reservations are skipped — that shopper already said no.
 */
export async function markIncomingArrived(id: string, opts?: { productId?: string }) {
  const item = await prisma.catalogIncomingItem.findUnique({
    where: { id },
    select: { id: true, name: true, arrivedAt: true },
  });
  if (!item) throw new AppError("المادة غير موجودة", 404, "INCOMING_ITEM_NOT_FOUND");
  if (item.arrivedAt) return { alreadyArrived: true, notified: 0 };

  await prisma.catalogIncomingItem.update({
    where: { id },
    data: {
      arrivedAt: new Date(),
      active: false,
      ...(opts?.productId ? { productId: opts.productId } : {}),
    },
  });

  const holders = await prisma.catalogIncomingReservation.findMany({
    where: { itemId: id, status: { not: "CANCELLED" } },
    select: { phone: true, quantity: true },
  });

  // Announced in the background and paced, like every other bulk send here: a
  // shipment can have dozens of holders, and a tight loop of identical
  // messages is what costs a number its quality rating.
  setImmediate(async () => {
    const { getSettings } = await import("./settings.service");
    const { sendWhatsAppText } = await import("./whatsapp.service");
    const settings = await getSettings().catch(() => null);
    const link = settings?.catalogPublicUrl?.trim();

    for (const [index, holder] of holders.entries()) {
      if (index > 0) await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 2000)));
      const text = [
        "وصلت البضاعة الي حجزتها",
        "",
        `«${item.name}» — حجزك ${holder.quantity}`,
        "",
        link ? `اطلبها الآن:\n${link}` : "تواصل وينا لإكمال الطلب.",
      ].join("\n");
      await sendWhatsAppText(holder.phone, text).catch((err) =>
        logger.warn(
          `[CatalogIncoming] arrival notice failed to ${holder.phone}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
    logger.info(`[CatalogIncoming] arrival of "${item.name}" announced to ${holders.length}`);
  });

  return { alreadyArrived: false, notified: holders.length };
}

export async function listItemReservations(itemId: string) {
  return prisma.catalogIncomingReservation.findMany({
    where: { itemId },
    orderBy: { createdAt: "desc" },
    select: { id: true, phone: true, name: true, quantity: true, note: true, status: true, createdAt: true },
  });
}

/**
 * Every reservation across every item, newest first.
 *
 * The per-item list answers "who wants this"; this one answers "who is waiting
 * on me", which is the question the merchant actually opens the screen with —
 * and the only way to see it before was to open each item in turn.
 */
export async function listAllReservations(status?: "PENDING" | "CONFIRMED" | "CANCELLED") {
  const rows = await prisma.catalogIncomingReservation.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 300,
    select: {
      id: true, phone: true, name: true, quantity: true, note: true,
      status: true, createdAt: true,
      item: { select: { id: true, name: true, arrivedAt: true } },
    },
  });
  // Resolve who these phones actually are. The name stored on a reservation is
  // whatever they typed at the time; a shop customer should show under the name
  // on the books, and a returning visitor under the one they gave the
  // storefront — a bare number tells the merchant nothing.
  const phones = [...new Set(rows.map((r) => r.phone))];
  const [customers, visitors] = phones.length
    ? await Promise.all([
        prisma.customer.findMany({
          where: { phone: { in: phones }, deletedAt: null },
          select: { phone: true, name: true },
        }),
        prisma.catalogVisitor.findMany({
          where: { phone: { in: phones } },
          select: { phone: true, name: true },
        }),
      ])
    : [[], []];
  const nameByPhone = new Map<string, string>();
  for (const v of visitors) if (v.name) nameByPhone.set(v.phone, v.name);
  for (const c of customers) nameByPhone.set(c.phone, c.name); // a customer wins

  return rows.map((r) => ({
    id: r.id,
    phone: r.phone,
    name: nameByPhone.get(r.phone) ?? r.name,
    quantity: r.quantity,
    note: r.note,
    status: r.status,
    createdAt: r.createdAt,
    itemId: r.item.id,
    itemName: r.item.name,
    itemArrived: Boolean(r.item.arrivedAt),
  }));
}

export async function setReservationStatus(id: string, status: "PENDING" | "CONFIRMED" | "CANCELLED") {
  return prisma.catalogIncomingReservation.update({ where: { id }, data: { status } });
}
