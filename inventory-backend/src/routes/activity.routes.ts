import { Router } from "express";
import { z } from "zod";
import prisma from "../config/database";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminOnly } from "../middleware/admin-only.middleware";
import { asyncHandler } from "../utils/async-handler";
import { shopDayEndExclusive, shopDayStart } from "../utils/shop-day";

// «سجل الصفحات» — every account's page opens, for the owner.
const router = Router();
router.use(authMiddleware);

const RETENTION_DAYS = 90;
let lastPrune = 0;

// Any signed-in account records its own navigation (the web layout calls this).
router.post("/page-view", asyncHandler(async (req, res) => {
  const { path, label } = z.object({
    path: z.string().min(1).max(300),
    label: z.string().max(120).nullable().optional(),
  }).parse(req.body);
  await prisma.pageView.create({
    data: { userId: req.user!.id, userName: req.user!.name, path, label: label ?? null },
  });
  // Trim old rows at most once an hour — cheap, and no cron to forget.
  if (Date.now() - lastPrune > 60 * 60 * 1000) {
    lastPrune = Date.now();
    void prisma.pageView.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 86_400_000) } },
    }).catch(() => {});
  }
  res.status(204).end();
}));

// Owner only: who opened what, newest first.
router.get("/page-views", adminOnly, asyncHandler(async (req, res) => {
  const q = z.object({
    userId: z.string().uuid().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(300),
  }).parse(req.query);
  // Shop-day bounds (Baghdad), not the server's UTC midnight.
  const createdAt: { gte?: Date; lt?: Date } = {};
  if (q.from) createdAt.gte = shopDayStart(q.from);
  if (q.to) createdAt.lt = shopDayEndExclusive(q.to);
  const rows = await prisma.pageView.findMany({
    where: { ...(q.userId ? { userId: q.userId } : {}), ...(q.from || q.to ? { createdAt } : {}) },
    orderBy: { createdAt: "desc" },
    take: q.limit,
  });
  res.json({ success: true, data: rows });
}));

export default router;
