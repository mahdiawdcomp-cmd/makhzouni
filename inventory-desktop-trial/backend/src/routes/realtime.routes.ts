import { Router } from "express";
import prisma from "../config/database";
import { addRealtimeClient } from "../services/realtime.service";
import { AppError } from "../utils/app-error";
import { asyncHandler } from "../utils/async-handler";
import { verifyToken } from "../utils/jwt";

const router = Router();

router.get("/events", asyncHandler(async (req, res) => {
  const token = String(req.query.token ?? "");
  if (!token) {
    throw new AppError("Authorization token is required", 401, "TOKEN_REQUIRED");
  }

  const payload = verifyToken(token);
  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || !user.isActive) {
    throw new AppError("User is inactive or no longer exists", 401, "USER_INACTIVE");
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const remove = addRealtimeClient(user.id, res);
  req.on("close", remove);
}));

export default router;

