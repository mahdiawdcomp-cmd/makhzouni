import prisma from "../config/database";
import { normalizePhone } from "../utils/phone";
import { sendWhatsAppText } from "./whatsapp.service";
import { getSettings } from "./settings.service";
import { notifyAdmin, buildDedupeKey } from "./app-notification.service";
import { NotificationType, NotificationCategory, NotificationSeverity } from "../constants/notifications";

// ── Abandoned cart ────────────────────────────────────────────────────────────
// The public catalog cart is pure client-side state until checkout (see
// RetailShopPage.tsx) — a phone number only exists once the customer reaches
// the checkout form. This tracks from THAT point, not from first add-to-cart.

const ABANDONED_SESSION_LOOKBACK_HOURS = 2;

export async function upsertCartSession(input: { phone: string; itemCount: number; totalValue: number }) {
  const phone = normalizePhone(input.phone);
  if (!phone) return null;

  const recent = await prisma.catalogCartSession.findFirst({
    where: {
      phone,
      completedAt: null,
      startedAt: { gte: new Date(Date.now() - ABANDONED_SESSION_LOOKBACK_HOURS * 60 * 60 * 1000) },
    },
    orderBy: { startedAt: "desc" },
  });

  if (recent) {
    return prisma.catalogCartSession.update({
      where: { id: recent.id },
      data: { itemCount: input.itemCount, totalValue: input.totalValue },
    });
  }

  return prisma.catalogCartSession.create({
    data: { phone, itemCount: input.itemCount, totalValue: input.totalValue },
  });
}

// Called right after a successful order placement — explicit completion, not
// inferred, so the abandoned-cart cron never has to guess from timing alone.
export async function completeCartSession(phone: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return;
  await prisma.catalogCartSession.updateMany({
    where: { phone: normalized, completedAt: null },
    data: { completedAt: new Date() },
  });
}

const ABANDONED_TIMEOUT_MINUTES = 45;

// Runs frequently (see notification-jobs.service.ts) — checks for checkout
// sessions that went quiet without completing, notifies the admin once per
// session (notifiedAt guards against re-notifying on the next tick).
export async function runAbandonedCartCheckJob() {
  const cutoff = new Date(Date.now() - ABANDONED_TIMEOUT_MINUTES * 60 * 1000);
  const sessions = await prisma.catalogCartSession.findMany({
    where: { completedAt: null, notifiedAt: null, updatedAt: { lte: cutoff } },
    take: 100,
  });
  if (sessions.length === 0) return { checked: 0 };

  const settings = await getSettings().catch(() => null);
  const adminTarget = settings?.adminApprovalWhatsappNumber?.trim() || settings?.storePhone?.trim();

  for (const s of sessions) {
    const message = `🛒 زبون بدأ طلب بالكتالوج (${s.itemCount} مادة، ${Math.round(Number(s.totalValue)).toLocaleString()}) ولم يكمل — هاتفه: ${s.phone}`;
    await notifyAdmin({
      type: NotificationType.ABANDONED_CART,
      category: NotificationCategory.CATALOG,
      severity: NotificationSeverity.MEDIUM,
      title: "سلة متروكة بالكتالوج",
      message,
      entityType: "CATALOG_CART_SESSION",
      entityId: s.id,
      actionUrl: "/reports",
      metadata: { phone: s.phone, itemCount: s.itemCount, totalValue: Number(s.totalValue) },
      dedupeKey: buildDedupeKey(NotificationType.ABANDONED_CART, s.id),
    });
    if (adminTarget) {
      await sendWhatsAppText(adminTarget, message).catch(() => {});
    }
    await prisma.catalogCartSession.update({ where: { id: s.id }, data: { notifiedAt: new Date() } });
  }

  return { checked: sessions.length };
}

// ── Search misses ─────────────────────────────────────────────────────────────
// Catalog search is client-side filtering over an already-fetched product list
// (see RetailShopPage.tsx) — reported explicitly by the frontend when a search
// term matches zero products.

export async function logSearchMiss(input: { query: string; phone?: string }) {
  const query = input.query.trim().slice(0, 200);
  if (!query) return;
  const phone = input.phone ? normalizePhone(input.phone) : null;
  await prisma.catalogSearchMiss.create({ data: { query, phone } });
}

export async function getTopSearchMisses(limit = 30) {
  const rows = await prisma.catalogSearchMiss.groupBy({
    by: ["query"],
    _count: { query: true },
    orderBy: { _count: { query: "desc" } },
    take: limit,
  });
  return rows.map((r) => ({ query: r.query, count: r._count.query }));
}
