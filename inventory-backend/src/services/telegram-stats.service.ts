// «إحصائيات تيليكرام» — v1 scope: basic counts + top products, not a full BI
// system. Top-products is a one-off in-memory tally over recent Telegram-
// sourced OrderPreparation.items (JSON) rather than a new aggregation table —
// fine at this volume; CatalogProductStat.orders is NOT reused here because
// it mixes all catalog channels together, not just Telegram.
import { InvoiceStatus, OrderPreparationStatus } from "@prisma/client";
import prisma from "../config/database";
import { getSettings, updateSettings } from "./settings.service";

const TELEGRAM_SOURCE = "TELEGRAM_BOT";

export async function getTelegramBotStats() {
  const [botUsers, newLeads, ordersFromTelegram, revenueAgg, recentOrders, recentChats] = await Promise.all([
    prisma.telegramBotChat.count(),
    prisma.telegramBotChat.count({ where: { customerId: null } }),
    // Cancelled prep rows still "happened" as Telegram traffic but shouldn't
    // count as real orders — same exclusion as the revenue/top-products
    // queries below, so the three numbers on the stats card stay consistent.
    prisma.orderPreparation.count({
      where: { source: TELEGRAM_SOURCE, status: { not: OrderPreparationStatus.CANCELLED } },
    }),
    // ACTIVE only — a CANCELLED invoice must never count toward revenue
    // (same rule this codebase already enforces everywhere else revenue is
    // summed, e.g. daily-assistant.service.ts's activeSale filter).
    prisma.invoice.aggregate({
      where: { source: TELEGRAM_SOURCE, status: InvoiceStatus.ACTIVE },
      _sum: { totalAmount: true },
    }),
    prisma.orderPreparation.findMany({
      where: { source: TELEGRAM_SOURCE, status: { not: OrderPreparationStatus.CANCELLED } },
      select: { items: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.telegramBotChat.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { chatId: true, firstName: true, username: true, phone: true, createdAt: true, customerId: true },
    }),
  ]);

  const tally = new Map<string, { productName: string; quantity: number }>();
  for (const order of recentOrders) {
    const items = (order.items ?? []) as Array<{ productId?: string; productName?: string; quantity?: number }>;
    for (const item of items) {
      if (!item.productId) continue;
      const entry = tally.get(item.productId) ?? { productName: item.productName ?? item.productId, quantity: 0 };
      entry.quantity += Number(item.quantity ?? 0);
      tally.set(item.productId, entry);
    }
  }
  const topProducts = [...tally.entries()]
    .map(([productId, v]) => ({ productId, ...v }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10);

  return {
    botUsers,
    newLeads,
    ordersFromTelegram,
    revenueFromTelegram: Number(revenueAgg._sum.totalAmount ?? 0),
    topProducts,
    recentChats: recentChats.map((c) => ({
      chatId: String(c.chatId),
      firstName: c.firstName,
      username: c.username,
      phone: c.phone,
      createdAt: c.createdAt.toISOString(),
      isCustomer: !!c.customerId,
    })),
  };
}

export async function banTelegramChatId(chatId: string) {
  const settings = await getSettings();
  const list = new Set(settings.telegramBotBannedChatIds ?? []);
  list.add(String(chatId).trim());
  const banned = [...list];
  await updateSettings({ telegramBotBannedChatIds: banned });
  return banned;
}

export async function unbanTelegramChatId(chatId: string) {
  const settings = await getSettings();
  const target = String(chatId).trim();
  const banned = (settings.telegramBotBannedChatIds ?? []).filter((id) => id !== target);
  await updateSettings({ telegramBotBannedChatIds: banned });
  return banned;
}
