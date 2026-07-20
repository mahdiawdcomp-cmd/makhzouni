import { Router } from "express";
import { asyncHandler } from "../utils/async-handler";
import { adminOnly } from "../middleware/admin-only.middleware";
import { authMiddleware } from "../middleware/auth.middleware";
import { getTelegramBotStats, banTelegramChatId, unbanTelegramChatId } from "../services/telegram-stats.service";

const router = Router();

router.use(authMiddleware, adminOnly);

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await getTelegramBotStats());
  }),
);

router.post(
  "/ban",
  asyncHandler(async (req, res) => {
    const chatId = String(req.body?.chatId ?? "").trim();
    const telegramBotBannedChatIds = await banTelegramChatId(chatId);
    res.json({ telegramBotBannedChatIds });
  }),
);

router.post(
  "/unban",
  asyncHandler(async (req, res) => {
    const chatId = String(req.body?.chatId ?? "").trim();
    const telegramBotBannedChatIds = await unbanTelegramChatId(chatId);
    res.json({ telegramBotBannedChatIds });
  }),
);

export default router;
