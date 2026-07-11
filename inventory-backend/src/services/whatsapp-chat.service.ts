import { WhatsappMessageDirection } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { normalizePhone } from "../utils/phone";
import { publishRealtimeChange } from "./realtime.service";

const MESSAGE_PAGE_SIZE = 50;
const MESSAGE_PAGE_SIZE_MAX = 200;

async function resolveContact(phone: string): Promise<{ name: string | null; customerId: string | null }> {
  const customer = await prisma.customer.findUnique({ where: { phone }, select: { id: true, name: true } });
  if (customer) return { name: customer.name, customerId: customer.id };
  const prospect = await prisma.prospect.findUnique({ where: { phone }, select: { name: true } });
  return { name: prospect?.name ?? null, customerId: null };
}

/** Readable placeholder shown for a media message with no caption — also what
 * the conversation-list preview falls back to, so it's never blank. */
export function mediaFallbackText(mediaType?: string | null, filename?: string | null): string {
  switch (mediaType) {
    case "IMAGE": return "📷 صورة";
    case "DOCUMENT": return filename ? `📄 ${filename}` : "📄 مستند";
    case "AUDIO": return "🎤 رسالة صوتية";
    case "VIDEO": return "🎥 فيديو";
    case "STICKER": return "😀 ملصق";
    case "LOCATION": return "📍 موقع";
    default: return "📎 مرفق";
  }
}

/**
 * Single entry point for the WhatsApp chat log — every outbound send
 * (manual reply, bot auto-reply, invoice/campaign notification) and every
 * inbound webhook message goes through here, so a conversation thread
 * mirrors the real WhatsApp chat for that phone number. Completely separate
 * from InboundMessage (inbound-message.service.ts), which only logs
 * bot-unmatched messages for the old inbox.
 */
export async function logChatMessage(input: {
  phone: string;
  direction: WhatsappMessageDirection;
  text: string;
  waMessageId?: string | null;
  mediaType?: string | null;
  mediaDataUrl?: string | null;
  mediaFilename?: string | null;
  mediaMimeType?: string | null;
}) {
  const phone = normalizePhone(input.phone);
  const text = input.text?.trim() || (input.mediaType ? mediaFallbackText(input.mediaType, input.mediaFilename) : "");
  if (!phone || !text) return null;

  if (input.waMessageId) {
    const existing = await prisma.whatsappMessage.findUnique({ where: { waMessageId: input.waMessageId } });
    if (existing) return existing; // webhook retry — already logged
  }

  const conversation = await prisma.whatsappConversation.findUnique({ where: { phone } });

  const conv = conversation
    ? await prisma.whatsappConversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: new Date(),
          lastMessageText: text,
          lastDirection: input.direction,
          ...(input.direction === "IN" ? { unreadCount: { increment: 1 } } : {}),
        },
      })
    : await (async () => {
        const contact = await resolveContact(phone);
        return prisma.whatsappConversation.create({
          data: {
            phone,
            contactName: contact.name,
            customerId: contact.customerId,
            lastMessageAt: new Date(),
            lastMessageText: text,
            lastDirection: input.direction,
            unreadCount: input.direction === "IN" ? 1 : 0,
          },
        });
      })();

  const message = await prisma.whatsappMessage.create({
    data: {
      conversationId: conv.id,
      direction: input.direction,
      text,
      mediaType: input.mediaType ?? null,
      mediaDataUrl: input.mediaDataUrl ?? null,
      mediaFilename: input.mediaFilename ?? null,
      mediaMimeType: input.mediaMimeType ?? null,
      waMessageId: input.waMessageId ?? null,
    },
  });

  publishRealtimeChange({ resource: "whatsapp-chat", action: input.direction === "IN" ? "inbound" : "outbound" });

  return message;
}

export async function getConversations(search?: string) {
  const term = search?.trim();
  const where = term
    ? {
        OR: [
          { phone: { contains: normalizePhone(term) || term } },
          { contactName: { contains: term, mode: "insensitive" as const } },
        ],
      }
    : {};
  return prisma.whatsappConversation.findMany({ where, orderBy: { lastMessageAt: "desc" }, take: 200 });
}

export async function getUnreadCount() {
  const result = await prisma.whatsappConversation.aggregate({ _sum: { unreadCount: true } });
  return result._sum.unreadCount ?? 0;
}

export async function getMessages(phone: string, opts?: { before?: string; limit?: number }) {
  const normalized = normalizePhone(phone);
  const conversation = await prisma.whatsappConversation.findUnique({ where: { phone: normalized } });
  if (!conversation) return { conversation: null, messages: [], hasMore: false };

  const limit = Math.min(opts?.limit ?? MESSAGE_PAGE_SIZE, MESSAGE_PAGE_SIZE_MAX);
  const rows = await prisma.whatsappMessage.findMany({
    where: {
      conversationId: conversation.id,
      ...(opts?.before ? { createdAt: { lt: new Date(opts.before) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1, // fetch one extra to detect whether older messages remain
  });
  const hasMore = rows.length > limit;

  return { conversation, messages: rows.slice(0, limit).reverse(), hasMore };
}

export async function markConversationRead(phone: string) {
  const normalized = normalizePhone(phone);
  const conversation = await prisma.whatsappConversation.findUnique({ where: { phone: normalized } });
  if (!conversation) throw new AppError("المحادثة غير موجودة", 404, "WHATSAPP_CONVERSATION_NOT_FOUND");
  if (conversation.unreadCount === 0) return conversation;
  return prisma.whatsappConversation.update({ where: { id: conversation.id }, data: { unreadCount: 0 } });
}
