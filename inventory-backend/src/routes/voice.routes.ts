import { Router } from "express";
import { processVoiceCommand } from "../controllers/voice.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

// POST /api/voice/invoice
// المستخدم يرسل أمر صوتي نصي → النظام ينشئ الفاتورة
router.post("/invoice", authMiddleware, processVoiceCommand);

export default router;
