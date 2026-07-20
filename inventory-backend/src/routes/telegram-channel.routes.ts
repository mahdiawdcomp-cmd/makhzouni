import { Router } from "express";
import { asyncHandler } from "../utils/async-handler";
import { adminOnly } from "../middleware/admin-only.middleware";
import { authMiddleware } from "../middleware/auth.middleware";
import {
  getTelegramChannelStatus,
  runTelegramChannelSyncTick,
  testTelegramChannel,
} from "../services/telegram-channel.service";

const router = Router();

router.use(authMiddleware, adminOnly);

router.get(
  "/status",
  asyncHandler(async (_req, res) => {
    res.json(await getTelegramChannelStatus());
  }),
);

router.post(
  "/test",
  asyncHandler(async (_req, res) => {
    res.json(await testTelegramChannel());
  }),
);

// Kicks a reconcile pass immediately (same capped tick the cron runs).
router.post(
  "/sync-now",
  asyncHandler(async (_req, res) => {
    await runTelegramChannelSyncTick();
    res.json(await getTelegramChannelStatus());
  }),
);

export default router;
