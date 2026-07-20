// Admin-composed broadcast — a channel post (optionally pinned) and/or a DM
// blast to every Telegram bot user (TelegramBotChat). Uses the same channel
// bot credentials as telegram-channel.service; the DM blast is paced by
// runTelegramBroadcastTick (cron, same throttling constants as the channel
// mirror worker) since it can fan out to many recipients.
import prisma from "../config/database";
import { getSettings } from "./settings.service";
import { tgCall } from "./telegram-channel.service";
import { AppError } from "../utils/app-error";

const MAX_OPS_PER_TICK = 12;
const DELAY_BETWEEN_OPS_MS = 3_000;

let running = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDataUrl(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

export type CreateBroadcastInput = {
  text: string;
  imageDataUrl?: string;
  toChannel: boolean;
  toBotUsers: boolean;
  pinInChannel: boolean;
  createdById?: string;
};

export async function createBroadcast(input: CreateBroadcastInput) {
  const text = input.text.trim();
  if (!text) throw new AppError("النص مطلوب", 400, "BROADCAST_TEXT_REQUIRED");
  if (!input.toChannel && !input.toBotUsers) {
    throw new AppError("اختر وجهة واحدة على الأقل", 400, "BROADCAST_TARGET_REQUIRED");
  }

  const settings = await getSettings();
  const botToken = (settings.telegramChannelBotToken || "").trim();
  if (!botToken) throw new AppError("بوت التيليگرام غير مهيأ", 400, "TELEGRAM_NOT_CONFIGURED");
  const channelChatId = (settings.telegramChannelChatId || "").trim();
  if (input.toChannel && !channelChatId) {
    throw new AppError("معرّف القناة غير مهيأ", 400, "TELEGRAM_CHANNEL_NOT_CONFIGURED");
  }

  const broadcast = await prisma.telegramBroadcast.create({
    data: {
      text,
      imageDataUrl: input.imageDataUrl,
      toChannel: input.toChannel,
      toBotUsers: input.toBotUsers,
      pinInChannel: input.pinInChannel,
      createdById: input.createdById,
      status: "SENDING",
    },
  });

  if (input.toChannel) {
    try {
      const parsed = input.imageDataUrl ? parseDataUrl(input.imageDataUrl) : null;
      let messageId: number;
      if (parsed) {
        const form = new FormData();
        form.append("chat_id", channelChatId);
        form.append("photo", new Blob([new Uint8Array(parsed.buffer)], { type: parsed.mime }), "broadcast.jpg");
        form.append("caption", text.slice(0, 1024));
        const result = (await tgCall(botToken, "sendPhoto", form)) as { message_id: number };
        messageId = result.message_id;
      } else {
        const result = (await tgCall(botToken, "sendMessage", { chat_id: channelChatId, text })) as {
          message_id: number;
        };
        messageId = result.message_id;
      }
      if (input.pinInChannel) {
        await tgCall(botToken, "pinChatMessage", { chat_id: channelChatId, message_id: messageId }).catch(
          () => undefined,
        );
      }
      await prisma.telegramBroadcast.update({ where: { id: broadcast.id }, data: { channelMessageId: messageId } });
    } catch (error) {
      // Without this, a bad token/chat leaves the row at SENDING and the
      // cron tick later flips it to a false "DONE" once it finds zero
      // pending DM recipients — a failed post would silently read as sent.
      await prisma.telegramBroadcast
        .update({ where: { id: broadcast.id }, data: { status: "FAILED" } })
        .catch(() => undefined);
      throw error;
    }
  }

  if (input.toBotUsers) {
    const chats = await prisma.telegramBotChat.findMany({ select: { chatId: true } });
    if (chats.length) {
      await prisma.telegramBroadcastRecipient.createMany({
        data: chats.map((c) => ({ broadcastId: broadcast.id, chatId: c.chatId })),
      });
    }
    await prisma.telegramBroadcast.update({
      where: { id: broadcast.id },
      data: { totalRecipients: chats.length, status: chats.length ? "SENDING" : "DONE" },
    });
  } else {
    await prisma.telegramBroadcast.update({ where: { id: broadcast.id }, data: { status: "DONE" } });
  }

  return prisma.telegramBroadcast.findUnique({ where: { id: broadcast.id } });
}

export async function listBroadcasts() {
  return prisma.telegramBroadcast.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
}

// One small batch of DM recipients per tick — mirrors the channel mirror
// worker's pacing so we never trip Telegram's rate limits.
export async function runTelegramBroadcastTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const broadcast = await prisma.telegramBroadcast.findFirst({
      where: { status: "SENDING" },
      orderBy: { createdAt: "asc" },
    });
    if (!broadcast) return;

    const settings = await getSettings();
    const botToken = (settings.telegramChannelBotToken || "").trim();
    if (!botToken) {
      await prisma.telegramBroadcast.update({ where: { id: broadcast.id }, data: { status: "FAILED" } });
      return;
    }

    const pending = await prisma.telegramBroadcastRecipient.findMany({
      where: { broadcastId: broadcast.id, status: "PENDING" },
      take: MAX_OPS_PER_TICK,
    });

    for (const recipient of pending) {
      try {
        await tgCall(botToken, "sendMessage", { chat_id: Number(recipient.chatId), text: broadcast.text });
        await prisma.telegramBroadcastRecipient.update({
          where: { id: recipient.id },
          data: { status: "SENT", sentAt: new Date() },
        });
        await prisma.telegramBroadcast.update({
          where: { id: broadcast.id },
          data: { sentCount: { increment: 1 } },
        });
      } catch (error) {
        await prisma.telegramBroadcastRecipient.update({
          where: { id: recipient.id },
          data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) },
        });
      }
      await sleep(DELAY_BETWEEN_OPS_MS);
    }

    const remaining = await prisma.telegramBroadcastRecipient.count({
      where: { broadcastId: broadcast.id, status: "PENDING" },
    });
    if (remaining === 0) {
      await prisma.telegramBroadcast.update({ where: { id: broadcast.id }, data: { status: "DONE" } });
    }
  } catch (error) {
    console.error("[TelegramBroadcast] tick failed:", error);
  } finally {
    running = false;
  }
}
