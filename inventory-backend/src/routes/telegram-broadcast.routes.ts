import { Router } from "express";
import { asyncHandler } from "../utils/async-handler";
import { adminOnly } from "../middleware/admin-only.middleware";
import { authMiddleware } from "../middleware/auth.middleware";
import { createBroadcast, listBroadcasts } from "../services/telegram-broadcast.service";

const router = Router();

router.use(authMiddleware, adminOnly);

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await listBroadcasts());
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { text, imageDataUrl, toChannel, toBotUsers, pinInChannel } = req.body ?? {};
    const broadcast = await createBroadcast({
      text: String(text ?? ""),
      imageDataUrl: imageDataUrl ? String(imageDataUrl) : undefined,
      toChannel: Boolean(toChannel),
      toBotUsers: Boolean(toBotUsers),
      pinInChannel: Boolean(pinInChannel),
      createdById: req.user?.id,
    });
    res.json(broadcast);
  }),
);

export default router;
