import { InboundMessageStatus } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { sendWhatsAppText } from "./whatsapp.service";

export async function listInboundMessages(opts?: { status?: InboundMessageStatus }) {
  const where = opts?.status ? { status: opts.status } : {};
  const [items, unreadCount] = await Promise.all([
    prisma.inboundMessage.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.inboundMessage.count({ where: { status: InboundMessageStatus.UNREAD } }),
  ]);
  return { items, unreadCount };
}

export async function markInboundMessageRead(id: string) {
  const msg = await prisma.inboundMessage.findUnique({ where: { id } });
  if (!msg) throw new AppError("غير موجود", 404, "INBOUND_MESSAGE_NOT_FOUND");
  if (msg.status === InboundMessageStatus.UNREAD) {
    return prisma.inboundMessage.update({ where: { id }, data: { status: InboundMessageStatus.READ } });
  }
  return msg;
}

export async function replyToInboundMessage(id: string, replyText: string) {
  const msg = await prisma.inboundMessage.findUnique({ where: { id } });
  if (!msg) throw new AppError("غير موجود", 404, "INBOUND_MESSAGE_NOT_FOUND");
  if (!replyText.trim()) throw new AppError("نص الرد مطلوب", 400, "REPLY_TEXT_REQUIRED");

  await sendWhatsAppText(msg.phone, replyText.trim());

  return prisma.inboundMessage.update({
    where: { id },
    data: { status: InboundMessageStatus.REPLIED, replyText: replyText.trim(), repliedAt: new Date() },
  });
}
