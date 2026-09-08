import { Router } from "express";
import multer from "multer";
import prisma from "../config/database";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middleware/permission.middleware";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import { MAX_IMAGE_BYTES } from "../services/media-asset.service";
import { getPublishingQuota } from "../services/instagram.service";
import {
  listConnectedAccounts,
  getProductImageGallery,
  createDraftPost,
  getPost,
  listPosts,
  updatePost,
  deletePost,
  addMediaFromProductImage,
  addUploadedMedia,
  removeMedia,
  reorderMedia,
  schedulePost,
  cancelSchedule,
  reschedulePost,
  publishNow,
} from "../services/wholesale-instagram.service";

// «إنستغرام الجملة» — routes completely independent of /instagram (retail).
// Reuses only read-only/generic pieces of that system: connected
// InstagramAccount rows and getPublishingQuota() (account-scoped, not tied to
// retail at all). Everything else here is its own service.
//
// Permissions: MANAGE_WHOLESALE_INSTAGRAM (prepare/schedule) vs
// PUBLISH_WHOLESALE_INSTAGRAM (schedule/publish-now/retry — the "actually
// talks to Meta" tier), mirroring the MANAGE_INSTAGRAM/PUBLISH_INSTAGRAM split
// used by the retail system. An ADMIN account bypasses both automatically
// (see permission.middleware.ts) — no manual grant is needed after deploy.

const router = Router();
router.use(authMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES } });

const READ = ["MANAGE_WHOLESALE_INSTAGRAM", "PUBLISH_WHOLESALE_INSTAGRAM"] as const;

// ── Accounts (read-only — connect/reconnect stays on the retail Settings page) ──

router.get("/accounts", requireAnyPermission(...READ), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listConnectedAccounts() });
}));

router.get("/accounts/:id/quota", requireAnyPermission(...READ), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getPublishingQuota(String(req.params.id)) });
}));

// ── Suggested posting times (non-binding presets — a plain Setting, editable anytime) ──

router.get("/suggested-times", requireAnyPermission(...READ), asyncHandler(async (_req, res) => {
  const row = await prisma.setting.findUnique({ where: { key: "wholesaleInstagramSuggestedTimes" } });
  const times = Array.isArray(row?.value) ? (row.value as string[]) : [];
  res.json({ success: true, data: { times } });
}));

router.put("/suggested-times", requirePermission("MANAGE_WHOLESALE_INSTAGRAM"), asyncHandler(async (req, res) => {
  const times = (req.body as { times?: unknown }).times;
  if (!Array.isArray(times) || !times.every((t) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
    throw new AppError("صيغة الأوقات غير صحيحة — استخدم HH:MM", 400, "INVALID_TIMES");
  }
  await prisma.setting.upsert({
    where: { key: "wholesaleInstagramSuggestedTimes" },
    create: { key: "wholesaleInstagramSuggestedTimes", value: times },
    update: { value: times },
  });
  res.json({ success: true, data: { times } });
}));

// ── Product image gallery (source images for "pick from product photos") ────

router.get("/products/:id/gallery", requireAnyPermission(...READ), asyncHandler(async (req, res) => {
  res.json({ success: true, data: { images: await getProductImageGallery(String(req.params.id)) } });
}));

// ── Posts ─────────────────────────────────────────────────────────────────────

router.post("/posts", requireAnyPermission(...READ), asyncHandler(async (req, res) => {
  const body = req.body as { productId: string; accountId: string; caption?: string; notes?: string };
  const post = await createDraftPost({ ...body, createdById: req.user?.id });
  res.status(201).json({ success: true, data: post });
}));

router.get("/posts", requireAnyPermission(...READ), asyncHandler(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
  res.json({ success: true, data: await listPosts({ status, productId }) });
}));

router.get("/posts/:id", requireAnyPermission(...READ), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getPost(String(req.params.id)) });
}));

router.put("/posts/:id", requireAnyPermission(...READ), asyncHandler(async (req, res) => {
  const body = req.body as { accountId?: string; caption?: string; notes?: string | null };
  res.json({ success: true, data: await updatePost(String(req.params.id), body) });
}));

router.delete("/posts/:id", requireAnyPermission(...READ), asyncHandler(async (req, res) => {
  await deletePost(String(req.params.id));
  res.json({ success: true, data: { ok: true } });
}));

// ── Media ─────────────────────────────────────────────────────────────────────

router.post("/posts/:id/media/from-product", requireAnyPermission(...READ), asyncHandler(async (req, res) => {
  const dataUrl = (req.body as { dataUrl?: string }).dataUrl;
  if (!dataUrl) throw new AppError("الصورة مطلوبة", 400, "IMAGE_REQUIRED");
  res.status(201).json({ success: true, data: await addMediaFromProductImage(String(req.params.id), dataUrl) });
}));

router.post(
  "/posts/:id/media/upload",
  requireAnyPermission(...READ),
  upload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError("ما وصلت صورة", 400, "IMAGE_REQUIRED");
    res.status(201).json({
      success: true,
      data: await addUploadedMedia(String(req.params.id), { buffer: req.file.buffer, mime: req.file.mimetype }),
    });
  }),
);

router.delete("/posts/:id/media/:mediaId", requireAnyPermission(...READ), asyncHandler(async (req, res) => {
  await removeMedia(String(req.params.id), String(req.params.mediaId));
  res.json({ success: true, data: { ok: true } });
}));

router.put("/posts/:id/media/reorder", requireAnyPermission(...READ), asyncHandler(async (req, res) => {
  const order = (req.body as { order?: string[] }).order;
  if (!Array.isArray(order)) throw new AppError("ترتيب غير صالح", 400, "INVALID_ORDER");
  await reorderMedia(String(req.params.id), order);
  res.json({ success: true, data: { ok: true } });
}));

// ── Scheduling / publishing (PUBLISH_WHOLESALE_INSTAGRAM — the "talks to Meta" tier) ──

router.post("/posts/:id/schedule", requirePermission("PUBLISH_WHOLESALE_INSTAGRAM"), asyncHandler(async (req, res) => {
  const scheduledAt = (req.body as { scheduledAt?: string }).scheduledAt;
  if (!scheduledAt) throw new AppError("الموعد مطلوب", 400, "WHOLESALE_IG_DATE_REQUIRED");
  res.json({ success: true, data: await schedulePost(String(req.params.id), scheduledAt) });
}));

router.post("/posts/:id/cancel-schedule", requirePermission("PUBLISH_WHOLESALE_INSTAGRAM"), asyncHandler(async (req, res) => {
  await cancelSchedule(String(req.params.id));
  res.json({ success: true, data: { ok: true } });
}));

router.post("/posts/:id/reschedule", requirePermission("PUBLISH_WHOLESALE_INSTAGRAM"), asyncHandler(async (req, res) => {
  const scheduledAt = (req.body as { scheduledAt?: string }).scheduledAt;
  if (!scheduledAt) throw new AppError("الموعد مطلوب", 400, "WHOLESALE_IG_DATE_REQUIRED");
  res.json({ success: true, data: await reschedulePost(String(req.params.id), scheduledAt) });
}));

// Publish now / retry — async like the retail system: fires and returns, the
// UI polls GET /posts for the outcome.
router.post("/posts/:id/publish-now", requirePermission("PUBLISH_WHOLESALE_INSTAGRAM"), asyncHandler(async (req, res) => {
  await publishNow(String(req.params.id));
  res.status(202).json({ success: true, data: { id: req.params.id, status: "PUBLISHING" } });
}));

export default router;
