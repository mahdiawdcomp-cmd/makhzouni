import { Router } from "express";
import { agentChat } from "../controllers/agent.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

// POST /api/agent/chat
router.post("/chat", authMiddleware, agentChat);

export default router;
