import { Router } from "express";
import { parseVoiceCommand, executeVoiceCommand } from "../controllers/voice.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

// POST /api/voice/parse  → classify + resolve → {type: confirm|clarify|answer}
router.post("/parse", authMiddleware, parseVoiceCommand);

// POST /api/voice/execute → execute confirmed plan → create invoice/voucher
router.post("/execute", authMiddleware, executeVoiceCommand);

// Legacy kept for backward compat
router.post("/invoice", authMiddleware, parseVoiceCommand);

export default router;
