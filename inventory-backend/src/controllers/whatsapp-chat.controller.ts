import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import { sendWhatsAppText } from "../services/whatsapp.service";
import {
  getConversations,
  getMessages,
  getUnreadCount,
  markConversationRead,
} from "../services/whatsapp-chat.service";

export const listWhatsappConversations = asyncHandler(async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const data = await getConversations(search);
  res.json({ success: true, data });
});

export const getWhatsappUnreadCount = asyncHandler(async (_req, res) => {
  const count = await getUnreadCount();
  res.json({ success: true, data: { count } });
});

export const getWhatsappConversationMessages = asyncHandler(async (req, res) => {
  const phone = String(req.params.phone);
  const before = typeof req.query.before === "string" ? req.query.before : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const data = await getMessages(phone, { before, limit });
  res.json({ success: true, data });
});

const MAX_MESSAGE_LENGTH = 4096; // WhatsApp's own free-text message cap

export const sendWhatsappConversationMessage = asyncHandler(async (req, res) => {
  const phone = String(req.params.phone);
  const text = String(req.body?.text ?? "").trim();
  if (!text) throw new AppError("نص الرسالة مطلوب", 400, "MESSAGE_TEXT_REQUIRED");
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new AppError(`الرسالة أطول من الحد المسموح (${MAX_MESSAGE_LENGTH} حرف)`, 400, "MESSAGE_TEXT_TOO_LONG");
  }

  await sendWhatsAppText(phone, text);
  const data = await getMessages(phone, { limit: 1 });
  res.json({ success: true, data: data.messages[0] ?? null });
});

export const markWhatsappConversationRead = asyncHandler(async (req, res) => {
  const phone = String(req.params.phone);
  const data = await markConversationRead(phone);
  res.json({ success: true, data });
});
