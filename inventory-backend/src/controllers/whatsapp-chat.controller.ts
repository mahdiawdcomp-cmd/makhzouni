import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import { sendWhatsAppDocument, sendWhatsAppImage, sendWhatsAppText } from "../services/whatsapp.service";
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

// Meta Cloud caps images at 5MB; documents allow more but our express.json
// body limit is 8MB and base64 inflates ~33%, so 5MB of raw bytes is the
// practical ceiling for both kinds here.
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

/** Send an image or document (with optional caption) from the chat screen. */
export const sendWhatsappConversationMedia = asyncHandler(async (req, res) => {
  const phone = String(req.params.phone);
  const dataUrl = String(req.body?.dataUrl ?? "");
  const caption = String(req.body?.caption ?? "").trim().slice(0, MAX_MESSAGE_LENGTH);
  const filename = String(req.body?.filename ?? "").trim() || "file";

  const match = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new AppError("صيغة الملف غير صالحة", 400, "MEDIA_DATA_URL_INVALID");
  const mime = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.byteLength) throw new AppError("الملف فارغ", 400, "MEDIA_EMPTY");
  if (buffer.byteLength > MAX_MEDIA_BYTES) {
    throw new AppError("حجم الملف أكبر من الحد المسموح (5MB)", 400, "MEDIA_TOO_LARGE");
  }

  if (mime.startsWith("image/")) await sendWhatsAppImage(phone, caption, buffer, mime);
  else await sendWhatsAppDocument(phone, caption, buffer, filename, mime);

  const data = await getMessages(phone, { limit: 1 });
  res.json({ success: true, data: data.messages[0] ?? null });
});

export const markWhatsappConversationRead = asyncHandler(async (req, res) => {
  const phone = String(req.params.phone);
  const data = await markConversationRead(phone);
  res.json({ success: true, data });
});
