import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/permission.middleware";
import {
  listWhatsappConversations,
  getWhatsappUnreadCount,
  getWhatsappConversationMessages,
  sendWhatsappConversationMessage,
  sendWhatsappConversationMedia,
  reactToWhatsappMessage,
  markWhatsappConversationRead,
  archiveWhatsappConversation,
  pinWhatsappConversation,
  updateWhatsappConversationNotes,
  getWhatsappQuickReplies,
  addWhatsappQuickReply,
  removeWhatsappQuickReply,
} from "../controllers/whatsapp-chat.controller";

const router = Router();

router.use(authMiddleware);
const access = requirePermission("ACCESS_WHATSAPP_CHAT");

router.get("/conversations", access, listWhatsappConversations);
router.get("/unread-count", access, getWhatsappUnreadCount);
router.get("/quick-replies", access, getWhatsappQuickReplies);
router.post("/quick-replies", access, addWhatsappQuickReply);
router.delete("/quick-replies/:id", access, removeWhatsappQuickReply);
router.get("/conversations/:phone/messages", access, getWhatsappConversationMessages);
router.post("/conversations/:phone/messages", access, sendWhatsappConversationMessage);
router.post("/conversations/:phone/media", access, sendWhatsappConversationMedia);
router.post("/conversations/:phone/reaction", access, reactToWhatsappMessage);
router.post("/conversations/:phone/read", access, markWhatsappConversationRead);
router.post("/conversations/:phone/archive", access, archiveWhatsappConversation);
router.post("/conversations/:phone/pin", access, pinWhatsappConversation);
router.put("/conversations/:phone/notes", access, updateWhatsappConversationNotes);

export default router;
