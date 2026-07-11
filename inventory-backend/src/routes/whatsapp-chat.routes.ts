import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/permission.middleware";
import {
  listWhatsappConversations,
  getWhatsappUnreadCount,
  getWhatsappConversationMessages,
  sendWhatsappConversationMessage,
  sendWhatsappConversationMedia,
  markWhatsappConversationRead,
} from "../controllers/whatsapp-chat.controller";

const router = Router();

router.use(authMiddleware);
const access = requirePermission("ACCESS_WHATSAPP_CHAT");

router.get("/conversations", access, listWhatsappConversations);
router.get("/unread-count", access, getWhatsappUnreadCount);
router.get("/conversations/:phone/messages", access, getWhatsappConversationMessages);
router.post("/conversations/:phone/messages", access, sendWhatsappConversationMessage);
router.post("/conversations/:phone/media", access, sendWhatsappConversationMedia);
router.post("/conversations/:phone/read", access, markWhatsappConversationRead);

export default router;
