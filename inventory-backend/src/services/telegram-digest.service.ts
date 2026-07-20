// Daily «وصل حديثاً» digest — one pinned channel post aggregating products
// added in the last 7 days (in stock + has an image). Unpins yesterday's
// digest before pinning today's; tracked via the telegramDigestLastMessageId
// setting (no new table needed). Kept separate from telegram-channel.service
// (already large) even though it shares that file's bot credentials/tgCall.
import prisma from "../config/database";
import { getSettings, updateSettings } from "./settings.service";
import { tgCall } from "./telegram-channel.service";
import { totalStock } from "../utils/product-stock";

function currencyLabel(currency: string) {
  return currency === "IQD" ? "د.ع" : currency;
}

function formatPrice(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

async function getDigestProducts() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const products = await prisma.product.findMany({
    where: { deletedAt: null, createdAt: { gte: sevenDaysAgo } },
    select: {
      id: true,
      name: true,
      salePrice: true,
      pcsPerCarton: true,
      thumbnailUrl: true,
      imageUrl: true,
      openingBalancePcs: true,
      cartonsAvailable: true,
      warehouseStocks: { select: { quantityPieces: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return products.filter((p) => totalStock(p) > 0 && (p.thumbnailUrl || p.imageUrl));
}

export async function runDailyDigestJob(): Promise<void> {
  const settings = await getSettings();
  const botToken = (settings.telegramChannelBotToken || "").trim();
  const chatId = (settings.telegramChannelChatId || "").trim();
  if (!settings.telegramChannelEnabled || !botToken || !chatId) return;

  const products = await getDigestProducts();
  if (!products.length) return;

  const cur = currencyLabel(settings.currency || "IQD");
  const lines = ["🆕 وصل حديثاً", ""];
  for (const p of products.slice(0, 20)) {
    const piece = Number(p.salePrice) || 0;
    lines.push(`🛍️ ${p.name} — ${formatPrice(piece)} ${cur}`);
  }
  const catalogUrl = (settings.catalogPublicUrl || "").trim();
  if (catalogUrl) lines.push("", `🛒 الكتلوك: ${catalogUrl}`);
  const text = lines.join("\n").slice(0, 4096);

  const sent = (await tgCall(botToken, "sendMessage", { chat_id: chatId, text })) as { message_id: number };

  if (settings.telegramDigestLastMessageId) {
    await tgCall(botToken, "unpinChatMessage", {
      chat_id: chatId,
      message_id: settings.telegramDigestLastMessageId,
    }).catch(() => undefined);
  }
  await tgCall(botToken, "pinChatMessage", { chat_id: chatId, message_id: sent.message_id }).catch(() => undefined);

  await updateSettings({
    telegramDigestLastMessageId: sent.message_id,
    telegramDigestLastMessageDate: new Date().toISOString().slice(0, 10),
  });
}
