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
  replyToWaMessageId?: string | null;
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

  // Quote snapshot: resolve the quoted message's text once at write time so
  // the quote block renders even when the original falls off the loaded page.
  let replyToText: string | null = null;
  if (input.replyToWaMessageId) {
    const quoted = await prisma.whatsappMessage.findUnique({
      where: { waMessageId: input.replyToWaMessageId },
      select: { text: true },
    });
    replyToText = quoted?.text ?? null;
  }

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
      replyToWaMessageId: input.replyToWaMessageId ?? null,
      replyToText,
    },
  });

  publishRealtimeChange({ resource: "whatsapp-chat", action: input.direction === "IN" ? "inbound" : "outbound" });

  return message;
}

/** Latest emoji reaction on a message (empty emoji = reaction removed). */
export async function applyMessageReaction(waMessageId: string, emoji: string | null) {
  const message = await prisma.whatsappMessage.findUnique({ where: { waMessageId } });
  if (!message) return null;
  const updated = await prisma.whatsappMessage.update({
    where: { id: message.id },
    data: { reactionEmoji: emoji || null },
  });
  publishRealtimeChange({ resource: "whatsapp-chat", action: "reaction" });
  return updated;
}

/** Fills the conversation's contact name from Meta's inbound profile.name —
 * only when we don't already have a name (customer/prospect match wins). */
export async function fillConversationContactName(phone: string, profileName: string) {
  const normalized = normalizePhone(phone);
  const name = profileName.trim();
  if (!normalized || !name) return;
  const conversation = await prisma.whatsappConversation.findUnique({ where: { phone: normalized } });
  if (!conversation || conversation.contactName) return;
  await prisma.whatsappConversation.update({ where: { id: conversation.id }, data: { contactName: name } });
}


/** Archive/unarchive a conversation — hides it from the default list. */
export async function setConversationArchived(phone: string, isArchived: boolean) {
  const normalized = normalizePhone(phone);
  const conversation = await prisma.whatsappConversation.findUnique({ where: { phone: normalized } });
  if (!conversation) throw new AppError("المحادثة غير موجودة", 404, "WHATSAPP_CONVERSATION_NOT_FOUND");
  const updated = await prisma.whatsappConversation.update({ where: { id: conversation.id }, data: { isArchived } });
  publishRealtimeChange({ resource: "whatsapp-chat", action: "conversation-updated" });
  return updated;
}

/** Pin/unpin a conversation to the top of the list. */
export async function setConversationPinned(phone: string, isPinned: boolean) {
  const normalized = normalizePhone(phone);
  const conversation = await prisma.whatsappConversation.findUnique({ where: { phone: normalized } });
  if (!conversation) throw new AppError("المحادثة غير موجودة", 404, "WHATSAPP_CONVERSATION_NOT_FOUND");
  const updated = await prisma.whatsappConversation.update({ where: { id: conversation.id }, data: { isPinned } });
  publishRealtimeChange({ resource: "whatsapp-chat", action: "conversation-updated" });
  return updated;
}

/** Staff-only note on a conversation — never sent to the customer. */
export async function setConversationNotes(phone: string, notes: string) {
  const normalized = normalizePhone(phone);
  const conversation = await prisma.whatsappConversation.findUnique({ where: { phone: normalized } });
  if (!conversation) throw new AppError("المحادثة غير موجودة", 404, "WHATSAPP_CONVERSATION_NOT_FOUND");
  const updated = await prisma.whatsappConversation.update({
    where: { id: conversation.id },
    data: { internalNotes: notes.trim() || null },
  });
  return updated;
}

// Lifecycle order — a late/out-of-order webhook must never downgrade READ back
// to DELIVERED. FAILED is terminal and always applies (Meta can fail after
// "sent", e.g. 24h-window rejection).
const STATUS_RANK: Record<string, number> = { SENT: 0, DELIVERED: 1, READ: 2, FAILED: 3 };

/**
 * Applies a Meta `statuses` webhook event to the matching outbound message.
 * Unknown waMessageId (campaign sends predating chat log, other tenants'
 * numbers) is a silent no-op — status events must never 500 the webhook.
 */
export async function updateMessageStatus(waMessageId: string, status: string, statusError?: string | null) {
  const normalized = status.toUpperCase();
  if (!(normalized in STATUS_RANK)) return null;

  const message = await prisma.whatsappMessage.findUnique({ where: { waMessageId } });
  if (!message) return null;
  if (STATUS_RANK[normalized] <= (STATUS_RANK[message.status] ?? -1)) return message;

  const updated = await prisma.whatsappMessage.update({
    where: { id: message.id },
    data: { status: normalized, statusError: normalized === "FAILED" ? statusError ?? null : null },
  });
  publishRealtimeChange({ resource: "whatsapp-chat", action: "status" });
  return updated;
}

export async function getConversations(search?: string, opts?: { includeArchived?: boolean }) {
  const term = search?.trim();
  const where = {
    ...(opts?.includeArchived ? {} : { isArchived: false }),
    ...(term
      ? {
          OR: [
            { phone: { contains: normalizePhone(term) || term } },
            { contactName: { contains: term, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const rows = await prisma.whatsappConversation.findMany({ where, orderBy: { lastMessageAt: "desc" }, take: 200 });
  // Pinned conversations float to the top; each group keeps its recency order.
  return [...rows].sort((a, b) => Number(b.isPinned) - Number(a.isPinned));
}

export async function getUnreadCount() {
  const result = await prisma.whatsappConversation.aggregate({ _sum: { unreadCount: true } });
  return result._sum.unreadCount ?? 0;
}

export async function getMessages(phone: string, opts?: { before?: string; limit?: number }) {
  const normalized = normalizePhone(phone);
  const conversation = await prisma.whatsappConversation.findUnique({ where: { phone: normalized } });
  if (!conversation) return { conversation: null, messages: [], hasMore: false, lastInboundAt: null };

  // Meta's 24h customer-service window opens on each INBOUND message — the UI
  // warns that free-text sends may be rejected once it has lapsed.
  const lastInbound = await prisma.whatsappMessage.findFirst({
    where: { conversationId: conversation.id, direction: "IN" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

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

  return { conversation, messages: rows.slice(0, limit).reverse(), hasMore, lastInboundAt: lastInbound?.createdAt ?? null };
}

export async function markConversationRead(phone: string) {
  const normalized = normalizePhone(phone);
  const conversation = await prisma.whatsappConversation.findUnique({ where: { phone: normalized } });
  if (!conversation) throw new AppError("المحادثة غير موجودة", 404, "WHATSAPP_CONVERSATION_NOT_FOUND");
  if (conversation.unreadCount === 0) return conversation;
  return prisma.whatsappConversation.update({ where: { id: conversation.id }, data: { unreadCount: 0 } });
}
