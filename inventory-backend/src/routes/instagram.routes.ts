import { Router } from "express";
import multer from "multer";
import prisma from "../config/database";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middleware/permission.middleware";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  checkAccountHealth,
  connectWithToken,
  createPost,
  deleteAccount,
  disconnectAccount,
  getInstagramAppConfig,
  getOauthUrl,
  getPublishingQuota,
  listAccounts,
  publishPost,
  retryPost,
  saveInstagramAppConfig,
  validateMediaPlan,
  type MediaPlan,
} from "../services/instagram.service";
import {
  addPostToQueueGuard,
  createQueue,
  deleteQueue,
  listQueues,
  updateQueue,
} from "../services/instagram-queue.service";
import {
  MAX_VIDEO_BYTES,
  getMediaAssetMetaByItem,
  publicMediaUrl,
  saveVideoAsset,
  setRetailItemVideo,
} from "../services/media-asset.service";

// Permissions (Phase 11):
//   MANAGE_INSTAGRAM  — prepare posts, save drafts, manage hashtag groups
//   PUBLISH_INSTAGRAM — actually publish / queue / retry (manager tier)
// Account + app-config management stays under MANAGE_SETTINGS like WhatsApp.

const router = Router();
router.use(authMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_VIDEO_BYTES } });

// ── App config + accounts (Settings page) ───────────────────────────────────

router.get("/app-config", requirePermission("MANAGE_SETTINGS"), asyncHandler(async (_req, res) => {
  const cfg = await getInstagramAppConfig();
  res.json({ success: true, data: { appId: cfg.appId, hasAppSecret: Boolean(cfg.appSecret) } });
}));

router.put("/app-config", requirePermission("MANAGE_SETTINGS"), asyncHandler(async (req, res) => {
  const { appId, appSecret } = req.body as { appId?: string; appSecret?: string };
  const cfg = await saveInstagramAppConfig({ appId, appSecret });
  res.json({ success: true, data: { appId: cfg.appId, hasAppSecret: Boolean(cfg.appSecret) } });
}));

router.get("/accounts", requireAnyPermission("MANAGE_SETTINGS", "MANAGE_INSTAGRAM", "PUBLISH_INSTAGRAM"), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listAccounts() });
}));

router.get("/oauth-url", requirePermission("MANAGE_SETTINGS"), asyncHandler(async (req, res) => {
  const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "/settings";
  res.json({ success: true, data: { url: await getOauthUrl(returnTo) } });
}));

router.post("/accounts/manual", requirePermission("MANAGE_SETTINGS"), asyncHandler(async (req, res) => {
  const token = (req.body as { accessToken?: string }).accessToken;
  if (!token?.trim()) throw new AppError("أدخل التوكن أولاً", 400, "TOKEN_REQUIRED");
  res.json({ success: true, data: await connectWithToken(token) });
}));

router.post("/accounts/:id/check", requirePermission("MANAGE_SETTINGS"), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await checkAccountHealth(String(req.params.id)) });
}));

router.post("/accounts/:id/disconnect", requirePermission("MANAGE_SETTINGS"), asyncHandler(async (req, res) => {
  await disconnectAccount(String(req.params.id));
  res.json({ success: true, data: { ok: true } });
}));

router.delete("/accounts/:id", requirePermission("MANAGE_SETTINGS"), asyncHandler(async (req, res) => {
  await deleteAccount(String(req.params.id));
  res.json({ success: true, data: { ok: true } });
}));

router.get("/accounts/:id/quota", requireAnyPermission("MANAGE_INSTAGRAM", "PUBLISH_INSTAGRAM"), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getPublishingQuota(String(req.params.id)) });
}));

// ── Catalog item video (Phase 0) ─────────────────────────────────────────────

router.post(
  "/catalog-items/:id/video",
  requirePermission("MANAGE_PRODUCTS"),
  upload.single("video"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError("ما وصل ملف فيديو", 400, "VIDEO_REQUIRED");
    const duration = req.body.duration ? Number(req.body.duration) : undefined;
    const asset = await saveVideoAsset({
      buffer: req.file.buffer,
      mime: req.file.mimetype,
      duration: Number.isFinite(duration) ? duration : undefined,
      width: req.body.width ? Number(req.body.width) : undefined,
      height: req.body.height ? Number(req.body.height) : undefined,
    });
    await setRetailItemVideo(String(req.params.id), asset.id);
    res.json({ success: true, data: { ...asset, url: publicMediaUrl(asset.publicToken) } });
  })
);

router.delete("/catalog-items/:id/video", requirePermission("MANAGE_PRODUCTS"), asyncHandler(async (req, res) => {
  await setRetailItemVideo(String(req.params.id), null);
  res.json({ success: true, data: { ok: true } });
}));

router.get("/catalog-items/:id/video", requireAnyPermission("MANAGE_PRODUCTS", "MANAGE_INSTAGRAM", "PUBLISH_INSTAGRAM"), asyncHandler(async (req, res) => {
  const meta = await getMediaAssetMetaByItem(String(req.params.id));
  res.json({ success: true, data: meta ? { ...meta, url: publicMediaUrl(meta.publicToken) } : null });
}));

// ── Hashtag groups (Phase 3) ─────────────────────────────────────────────────

router.get("/hashtag-groups", requireAnyPermission("MANAGE_INSTAGRAM", "PUBLISH_INSTAGRAM"), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await prisma.instagramHashtagGroup.findMany({ orderBy: { name: "asc" } }) });
}));

router.post("/hashtag-groups", requireAnyPermission("MANAGE_INSTAGRAM", "PUBLISH_INSTAGRAM"), asyncHandler(async (req, res) => {
  const { name, category, hashtags } = req.body as { name?: string; category?: string; hashtags?: string[] };
  if (!name?.trim()) throw new AppError("اسم المجموعة مطلوب", 400, "NAME_REQUIRED");
  res.status(201).json({ success: true, data: await prisma.instagramHashtagGroup.create({
    data: { name: name.trim(), category: category?.trim() || null, hashtags: (hashtags ?? []).filter(Boolean) },
  }) });
}));

router.put("/hashtag-groups/:id", requireAnyPermission("MANAGE_INSTAGRAM", "PUBLISH_INSTAGRAM"), asyncHandler(async (req, res) => {
  const { name, category, hashtags } = req.body as { name?: string; category?: string; hashtags?: string[] };
  res.json({ success: true, data: await prisma.instagramHashtagGroup.update({
    where: { id: String(req.params.id) },
    data: {
      name: name?.trim() || undefined,
      category: category !== undefined ? category?.trim() || null : undefined,
      hashtags: hashtags?.filter(Boolean),
    },
  }) });
}));

router.delete("/hashtag-groups/:id", requireAnyPermission("MANAGE_INSTAGRAM", "PUBLISH_INSTAGRAM"), asyncHandler(async (req, res) => {
  await prisma.instagramHashtagGroup.delete({ where: { id: String(req.params.id) } });
  res.json({ success: true, data: { ok: true } });
}));

// ── Validation + posts ───────────────────────────────────────────────────────

router.post("/validate-media", requireAnyPermission("MANAGE_INSTAGRAM", "PUBLISH_INSTAGRAM"), asyncHandler(async (req, res) => {
  const { retailItemId, mediaPlan } = req.body as { retailItemId: string; mediaPlan: MediaPlan };
  res.json({ success: true, data: await validateMediaPlan(retailItemId, mediaPlan) });
}));

// Draft (MANAGE_INSTAGRAM is enough)
router.post("/posts/draft", requireAnyPermission("MANAGE_INSTAGRAM", "PUBLISH_INSTAGRAM"), asyncHandler(async (req, res) => {
  const body = req.body as { retailItemId: string; accountId: string; caption?: string; mediaPlan: MediaPlan };
  const post = await createPost({
    retailItemId: body.retailItemId,
    accountId: body.accountId,
    caption: body.caption ?? "",
    mediaPlan: body.mediaPlan,
    asDraft: true,
    createdById: req.user?.id,
  });
  res.status(201).json({ success: true, data: post });
}));

// Publish now (PUBLISH_INSTAGRAM only) — async, never blocks (Phase 8)
router.post("/posts/publish", requirePermission("PUBLISH_INSTAGRAM"), asyncHandler(async (req, res) => {
  const body = req.body as { retailItemId: string; accountId: string; caption?: string; mediaPlan: MediaPlan; draftId?: string };
  let postId: string;
  if (body.draftId) {
    const draft = await prisma.instagramPost.findUnique({ where: { id: body.draftId } });
    if (!draft) throw new AppError("المسودة غير موجودة", 404, "DRAFT_NOT_FOUND");
    await prisma.instagramPost.update({
      where: { id: body.draftId },
      data: { status: "PREPARING", caption: body.caption ?? draft.caption, errorMessage: null },
    });
    postId = body.draftId;
  } else {
    const post = await createPost({
      retailItemId: body.retailItemId,
      accountId: body.accountId,
      caption: body.caption ?? "",
      mediaPlan: body.mediaPlan,
      asDraft: false,
      createdById: req.user?.id,
    });
    postId = post.id;
  }
  void publishPost(postId);
  res.status(202).json({ success: true, data: { id: postId, status: "PREPARING" } });
}));

router.post("/posts/:id/retry", requirePermission("PUBLISH_INSTAGRAM"), asyncHandler(async (req, res) => {
  await retryPost(String(req.params.id));
  res.status(202).json({ success: true, data: { ok: true } });
}));

router.get("/posts", requireAnyPermission("MANAGE_INSTAGRAM", "PUBLISH_INSTAGRAM"), asyncHandler(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const retailItemId = typeof req.query.retailItemId === "string" ? req.query.retailItemId : undefined;
  const posts = await prisma.instagramPost.findMany({
    where: {
      status: status ? (status as never) : undefined,
      retailItemId,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      account: { select: { username: true, profilePictureUrl: true } },
      queue: { select: { id: true, name: true } },
    },
  });
  res.json({ success: true, data: posts });
}));

router.get("/posts/:id", requireAnyPermission("MANAGE_INSTAGRAM", "PUBLISH_INSTAGRAM"), asyncHandler(async (req, res) => {
  const post = await prisma.instagramPost.findUnique({
    where: { id: String(req.params.id) },
    include: { account: { select: { username: true } } },
  });
  if (!post) throw new AppError("المنشور غير موجود", 404, "IG_POST_NOT_FOUND");
  res.json({ success: true, data: post });
}));

router.delete("/posts/:id", requireAnyPermission("MANAGE_INSTAGRAM", "PUBLISH_INSTAGRAM"), asyncHandler(async (req, res) => {
  const post = await prisma.instagramPost.findUnique({ where: { id: String(req.params.id) } });
  if (!post) throw new AppError("المنشور غير موجود", 404, "IG_POST_NOT_FOUND");
  if (post.status === "PREPARING" || post.status === "UPLOADING") {
    throw new AppError("لا يمكن حذف منشور قيد النشر حالياً", 400, "POST_IN_FLIGHT");
  }
  // History stays for PUBLISHED; only drafts/queued/failed rows are deletable.
  if (post.status === "PUBLISHED") throw new AppError("المنشورات المنشورة تبقى بالسجل ولا تُحذف", 400, "POST_PUBLISHED");
  await prisma.instagramPost.delete({ where: { id: String(req.params.id) } });
  res.json({ success: true, data: { ok: true } });
}));

// ── Queues (Phase 7) ─────────────────────────────────────────────────────────

router.get("/queues", requireAnyPermission("MANAGE_INSTAGRAM", "PUBLISH_INSTAGRAM"), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listQueues() });
}));

router.post("/queues", requirePermission("PUBLISH_INSTAGRAM"), asyncHandler(async (req, res) => {
  const body = req.body as { accountId: string; name?: string; scheduleType: "FIXED_TIMES" | "INTERVAL"; times?: string[]; intervalMinutes?: number; postsPerDay: number };
  res.status(201).json({ success: true, data: await createQueue({ ...body, createdById: req.user?.id }) });
}));

router.put("/queues/:id", requirePermission("PUBLISH_INSTAGRAM"), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await updateQueue(String(req.params.id), req.body) });
}));

router.delete("/queues/:id", requirePermission("PUBLISH_INSTAGRAM"), asyncHandler(async (req, res) => {
  await deleteQueue(String(req.params.id));
  res.json({ success: true, data: { ok: true } });
}));

// Add a prepared post to a queue (runs the prep modal per product at build time)
router.post("/queues/:id/posts", requirePermission("PUBLISH_INSTAGRAM"), asyncHandler(async (req, res) => {
  const body = req.body as { retailItemId: string; accountId: string; caption?: string; mediaPlan: MediaPlan };
  await addPostToQueueGuard(String(req.params.id), body.accountId);
  const post = await createPost({
    retailItemId: body.retailItemId,
    accountId: body.accountId,
    caption: body.caption ?? "",
    mediaPlan: body.mediaPlan,
    asDraft: false,
    queueId: String(req.params.id),
    createdById: req.user?.id,
  });
  res.status(201).json({ success: true, data: post });
}));

router.get("/queues/:id/posts", requireAnyPermission("MANAGE_INSTAGRAM", "PUBLISH_INSTAGRAM"), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await prisma.instagramPost.findMany({
    where: { queueId: String(req.params.id) },
    orderBy: { position: "asc" },
  }) });
}));

export default router;
