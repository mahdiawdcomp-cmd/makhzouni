import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { decryptSecret } from "../utils/crypto";
import { totalStock } from "../utils/product-stock";
import { saveImageAsset, saveDataUrlAsImageAsset, deleteMediaAsset, publicMediaUrl } from "./media-asset.service";

// «إنستغرام الجملة» — independent auto-publish system for wholesale Product.
//
// Deliberately does NOT touch instagram.service.ts / instagram-queue.service.ts
// (كتلوك المفرد's own system): this file re-implements the same proven Graph
// API + idempotency pattern for wholesale posts, reusing only the generic,
// already-exported building blocks — InstagramAccount (same connected
// accounts), MediaAsset (same permanent public-file store), totalStock()
// (the one unified stock reader used everywhere else in the codebase).
//
// Idempotency (same locked decision as retail): igCreationId is stored the
// moment the Meta container exists and igMediaId the moment media_publish
// returns, so a retry after a late failure never creates a duplicate post.
//
// Concurrency: every transition into PUBLISHING is an atomic conditional
// updateMany — `WHERE id = ? AND status IN (...)`. Only the caller that flips
// the row wins (count === 1); a second worker, a duplicated cron tick, or an
// overlapping manual click all lose the race and no-op. See claimPost().

const GRAPH = "https://graph.instagram.com/v21.0";
const MAX_MEDIA = 10; // Meta's own carousel cap

type GraphError = { message: string; type?: string; code?: number; error_subcode?: number; error_user_msg?: string };

async function graphFetch<T>(path: string, params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<T> {
  const qs = new URLSearchParams(params);
  const url = method === "GET" ? `${GRAPH}/${path}?${qs}` : `${GRAPH}/${path}`;
  const res = await fetch(url, method === "GET" ? {} : { method: "POST", body: qs });
  const json = (await res.json().catch(() => ({}))) as { error?: GraphError } & T;
  if (!res.ok || json.error) {
    const err = json.error;
    if (err) {
      console.error("[wholesale-instagram] Graph API error", { path, params: { ...params, access_token: "***" }, error: err, status: res.status });
    }
    const detail = err
      ? [err.error_user_msg, err.message, err.type, err.code !== undefined ? `code=${err.code}` : null].filter(Boolean).join(" | ")
      : null;
    throw new AppError(detail ? `Meta API: ${detail}` : `Meta API request failed (${res.status})`, 502, "META_API_ERROR");
  }
  return json;
}

async function waitForContainer(igCreationId: string, token: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await graphFetch<{ status_code?: string; status?: string }>(igCreationId, {
      access_token: token,
      fields: "status_code,status",
    });
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new AppError(`فشل تجهيز الصورة عند ميتا (${status.status ?? status.status_code})`, 502, "META_CONTAINER_ERROR");
    }
    if (Date.now() > deadline) throw new AppError("انتهت مهلة تجهيز الوسائط عند ميتا", 504, "META_CONTAINER_TIMEOUT");
    await new Promise((r) => setTimeout(r, 4000));
  }
}

// ── Accounts (read-only reuse — connection/OAuth stays on the retail Settings page) ──

export async function listConnectedAccounts() {
  const accounts = await prisma.instagramAccount.findMany({
    where: { status: "connected" },
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true, name: true, profilePictureUrl: true, status: true },
  });
  return accounts;
}

// ── Product image gallery (for the "pick from product images" step) ─────────

export async function getProductImageGallery(productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { imageUrl: true, catalogImages: { select: { url: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!product) throw new AppError("المنتج غير موجود", 404, "PRODUCT_NOT_FOUND");
  const images: string[] = [];
  if (product.imageUrl) images.push(product.imageUrl);
  for (const img of product.catalogImages) images.push(img.url);
  return images;
}

// ── Posts CRUD ────────────────────────────────────────────────────────────────

function serializePost<
  T extends {
    media: Array<{ id: string; sortOrder: number; source: string; mediaAsset: { publicToken: string; mime: string } }>;
    account: { id: string; username: string; profilePictureUrl: string | null };
  },
>(post: T) {
  const { media, ...rest } = post;
  return {
    ...rest,
    media: media
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => ({ id: m.id, source: m.source, url: publicMediaUrl(m.mediaAsset.publicToken), mime: m.mediaAsset.mime })),
  };
}

const postInclude = {
  account: { select: { id: true, username: true, profilePictureUrl: true } },
  media: { include: { mediaAsset: { select: { publicToken: true, mime: true } } } },
} as const;

export async function createDraftPost(input: { productId: string; accountId: string; caption?: string; notes?: string; createdById?: string }) {
  if (!input.accountId) throw new AppError("اختر حساب انستغرام أولاً", 400, "IG_ACCOUNT_REQUIRED");
  const product = await prisma.product.findUnique({ where: { id: input.productId }, select: { id: true, name: true } });
  if (!product) throw new AppError("المنتج غير موجود", 404, "PRODUCT_NOT_FOUND");
  const account = await prisma.instagramAccount.findUnique({ where: { id: input.accountId }, select: { id: true } });
  if (!account) throw new AppError("الحساب غير موجود", 404, "IG_ACCOUNT_NOT_FOUND");

  const post = await prisma.wholesaleInstagramPost.create({
    data: {
      productId: product.id,
      productTitle: product.name,
      accountId: input.accountId,
      postType: "IMAGE",
      status: "DRAFT",
      caption: input.caption ?? "",
      notes: input.notes ?? null,
      createdById: input.createdById,
    },
  });
  return getPost(post.id);
}

export async function getPost(id: string) {
  const post = await prisma.wholesaleInstagramPost.findUnique({ where: { id }, include: postInclude });
  if (!post) throw new AppError("المنشور غير موجود", 404, "WHOLESALE_IG_POST_NOT_FOUND");
  return serializePost(post);
}

export async function listPosts(filter: { status?: string; productId?: string }) {
  const posts = await prisma.wholesaleInstagramPost.findMany({
    where: { status: filter.status ? (filter.status as never) : undefined, productId: filter.productId },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: postInclude,
  });
  return posts.map(serializePost);
}

const EDITABLE_STATUSES = new Set(["DRAFT", "SCHEDULED", "FAILED", "SKIPPED_OUT_OF_STOCK"]);

export async function updatePost(
  id: string,
  patch: { accountId?: string; caption?: string; notes?: string | null },
) {
  const post = await prisma.wholesaleInstagramPost.findUnique({ where: { id }, select: { status: true } });
  if (!post) throw new AppError("المنشور غير موجود", 404, "WHOLESALE_IG_POST_NOT_FOUND");
  if (!EDITABLE_STATUSES.has(post.status)) {
    throw new AppError("لا يمكن تعديل منشور قيد النشر أو منشور فعلاً", 400, "WHOLESALE_IG_NOT_EDITABLE");
  }
  if (patch.accountId) {
    const account = await prisma.instagramAccount.findUnique({ where: { id: patch.accountId }, select: { id: true } });
    if (!account) throw new AppError("الحساب غير موجود", 404, "IG_ACCOUNT_NOT_FOUND");
  }
  await prisma.wholesaleInstagramPost.update({
    where: { id },
    data: {
      accountId: patch.accountId,
      caption: patch.caption,
      notes: patch.notes,
    },
  });
  return getPost(id);
}

export async function deletePost(id: string) {
  const post = await prisma.wholesaleInstagramPost.findUnique({
    where: { id },
    include: { media: { select: { id: true, mediaAssetId: true } } },
  });
  if (!post) throw new AppError("المنشور غير موجود", 404, "WHOLESALE_IG_POST_NOT_FOUND");
  if (post.status === "PUBLISHING") throw new AppError("لا يمكن حذف منشور قيد النشر حالياً", 400, "WHOLESALE_IG_IN_FLIGHT");
  if (post.status === "PUBLISHED") throw new AppError("المنشورات المنشورة تبقى بالسجل ولا تُحذف", 400, "WHOLESALE_IG_PUBLISHED");
  await prisma.wholesaleInstagramPost.delete({ where: { id } });
  // Cascade removed the join rows; the underlying files are now orphaned.
  for (const m of post.media) await deleteMediaAsset(m.mediaAssetId);
}

// ── Media (permanent MediaAsset per image — never Data URLs) ───────────────

async function assertMediaCapacity(postId: string) {
  const count = await prisma.wholesaleInstagramPostMedia.count({ where: { postId } });
  if (count >= MAX_MEDIA) throw new AppError(`الحد الأقصى ${MAX_MEDIA} صور بالمنشور الواحد`, 400, "WHOLESALE_IG_MEDIA_LIMIT");
  return count;
}

async function assertPostEditable(postId: string) {
  const post = await prisma.wholesaleInstagramPost.findUnique({ where: { id: postId }, select: { status: true } });
  if (!post) throw new AppError("المنشور غير موجود", 404, "WHOLESALE_IG_POST_NOT_FOUND");
  if (!EDITABLE_STATUSES.has(post.status)) {
    throw new AppError("لا يمكن تعديل وسائط منشور قيد النشر أو منشور فعلاً", 400, "WHOLESALE_IG_NOT_EDITABLE");
  }
}

export async function addMediaFromProductImage(postId: string, dataUrl: string) {
  await assertPostEditable(postId);
  const sortOrder = await assertMediaCapacity(postId);
  const asset = await saveDataUrlAsImageAsset(dataUrl);
  const row = await prisma.wholesaleInstagramPostMedia.create({
    data: { postId, mediaAssetId: asset.id, sortOrder, source: "product_image" },
  });
  await syncPostType(postId);
  return { id: row.id, url: asset.url };
}

export async function addUploadedMedia(postId: string, file: { buffer: Buffer; mime: string }) {
  await assertPostEditable(postId);
  const sortOrder = await assertMediaCapacity(postId);
  const asset = await saveImageAsset(file);
  const row = await prisma.wholesaleInstagramPostMedia.create({
    data: { postId, mediaAssetId: asset.id, sortOrder, source: "uploaded" },
  });
  await syncPostType(postId);
  return { id: row.id, url: asset.url };
}

export async function removeMedia(postId: string, mediaId: string) {
  await assertPostEditable(postId);
  const row = await prisma.wholesaleInstagramPostMedia.findFirst({ where: { id: mediaId, postId } });
  if (!row) throw new AppError("الصورة غير موجودة", 404, "WHOLESALE_IG_MEDIA_NOT_FOUND");
  await prisma.wholesaleInstagramPostMedia.delete({ where: { id: row.id } });
  await deleteMediaAsset(row.mediaAssetId);
  // Close the sortOrder gap so the carousel order stays 0..n-1.
  const rest = await prisma.wholesaleInstagramPostMedia.findMany({ where: { postId }, orderBy: { sortOrder: "asc" } });
  await prisma.$transaction(rest.map((r, i) => prisma.wholesaleInstagramPostMedia.update({ where: { id: r.id }, data: { sortOrder: i } })));
  await syncPostType(postId);
}

/** Persist a new, complete image order (drag-reorder in the prep UI). */
export async function reorderMedia(postId: string, orderedMediaIds: string[]) {
  await assertPostEditable(postId);
  const rows = await prisma.wholesaleInstagramPostMedia.findMany({ where: { postId }, select: { id: true } });
  const ids = new Set(rows.map((r) => r.id));
  if (orderedMediaIds.length !== rows.length || orderedMediaIds.some((id) => !ids.has(id))) {
    throw new AppError("قائمة الترتيب غير متطابقة مع صور المنشور", 400, "WHOLESALE_IG_REORDER_MISMATCH");
  }
  await prisma.$transaction(
    orderedMediaIds.map((id, i) => prisma.wholesaleInstagramPostMedia.update({ where: { id }, data: { sortOrder: i } })),
  );
}

async function syncPostType(postId: string) {
  const count = await prisma.wholesaleInstagramPostMedia.count({ where: { postId } });
  await prisma.wholesaleInstagramPost.update({ where: { id: postId }, data: { postType: count > 1 ? "CAROUSEL" : "IMAGE" } });
}

// ── Stock ─────────────────────────────────────────────────────────────────────

/** The one real read — same unified source (`totalStock`) used everywhere else. */
async function checkStock(productId: string | null): Promise<{ available: boolean; stock: number; reason?: string }> {
  if (!productId) return { available: false, stock: 0, reason: "المنتج انحذف نهائياً من قاعدة البيانات" };
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { deletedAt: true, openingBalancePcs: true, cartonsAvailable: true, pcsPerCarton: true, warehouseStocks: { select: { quantityPieces: true } } },
  });
  if (!product || product.deletedAt) return { available: false, stock: 0, reason: "المنتج غير موجود أو محذوف" };
  const stock = totalStock(product);
  if (stock <= 0) return { available: false, stock, reason: "الكمية صفر بالمخزون" };
  return { available: true, stock };
}

/**
 * Flags already-PUBLISHED posts whose product just ran out — Meta gives no
 * way to delete the live post from this OAuth flow (Instagram Login, not
 * Facebook Login; see the DELETE /{ig-media-id} requirement), so the only
 * honest thing the system can do is surface it somewhere that does not
 * disappear until a human dismisses it. Called every minute from the same
 * tick that runs scheduled posts (see wholesale-instagram-queue.service.ts) —
 * cheap: only PUBLISHED posts not already flagged are ever checked.
 */
export async function checkPublishedStockAlerts(): Promise<void> {
  const candidates = await prisma.wholesaleInstagramPost.findMany({
    where: { status: "PUBLISHED", stockAlertAt: null, productId: { not: null } },
    select: { id: true, productId: true },
  });
  for (const post of candidates) {
    const stock = await checkStock(post.productId);
    if (!stock.available) {
      await prisma.wholesaleInstagramPost.update({ where: { id: post.id }, data: { stockAlertAt: new Date() } });
    }
  }
}

export async function listStockAlerts() {
  const posts = await prisma.wholesaleInstagramPost.findMany({
    where: { status: "PUBLISHED", stockAlertAt: { not: null }, stockAlertDismissed: false },
    orderBy: { stockAlertAt: "desc" },
    include: postInclude,
  });
  return posts.map(serializePost);
}

/**
 * Admin has opened the live post and handled it (deleted it manually, or
 * chose to leave it). Only flips the `dismissed` flag — stockAlertAt itself
 * is immutable, which is what stops checkPublishedStockAlerts() from ever
 * re-flagging this same post once it is gone from the candidate query.
 */
export async function dismissStockAlert(id: string): Promise<void> {
  const res = await prisma.wholesaleInstagramPost.updateMany({
    where: { id, stockAlertAt: { not: null }, stockAlertDismissed: false },
    data: { stockAlertDismissed: true },
  });
  if (res.count !== 1) throw new AppError("ماكو تنبيه نشط لهذا المنشور", 400, "WHOLESALE_IG_NO_ALERT");
}

// ── Scheduling ────────────────────────────────────────────────────────────────

function assertPublishReady(post: { accountId: string; caption: string }, mediaCount: number) {
  if (!post.accountId) throw new AppError("اختر حساب انستغرام أولاً", 400, "IG_ACCOUNT_REQUIRED");
  if (!post.caption.trim()) throw new AppError("اكتب نص المنشور (الكابشن) أولاً", 400, "WHOLESALE_IG_CAPTION_REQUIRED");
  if (mediaCount === 0) throw new AppError("اختر صورة واحدة على الأقل", 400, "WHOLESALE_IG_MEDIA_REQUIRED");
}

/**
 * Schedule a post for a specific Baghdad-time instant.
 *
 * Stock is checked here ONLY as a non-blocking warning (locked decision): the
 * shop may legitimately restock before the scheduled time, so this never
 * refuses to schedule. The mandatory, publish-blocking check happens again
 * inside runWholesalePublish() at the moment the tick actually claims the post.
 */
export async function schedulePost(id: string, scheduledAtIso: string): Promise<{ warning?: string }> {
  const post = await prisma.wholesaleInstagramPost.findUnique({
    where: { id },
    include: { media: { select: { id: true } } },
  });
  if (!post) throw new AppError("المنشور غير موجود", 404, "WHOLESALE_IG_POST_NOT_FOUND");
  if (!EDITABLE_STATUSES.has(post.status)) throw new AppError("لا يمكن جدولة منشور قيد النشر أو منشور فعلاً", 400, "WHOLESALE_IG_NOT_EDITABLE");
  const scheduledAt = new Date(scheduledAtIso);
  if (Number.isNaN(scheduledAt.getTime())) throw new AppError("موعد غير صالح", 400, "WHOLESALE_IG_INVALID_DATE");
  if (scheduledAt.getTime() <= Date.now()) throw new AppError("الموعد يجب أن يكون بالمستقبل", 400, "WHOLESALE_IG_DATE_IN_PAST");
  assertPublishReady(post, post.media.length);

  await prisma.wholesaleInstagramPost.update({
    where: { id },
    data: { status: "SCHEDULED", scheduledAt, errorMessage: null, skipReason: null },
  });

  const stock = await checkStock(post.productId);
  return stock.available ? {} : { warning: `تنبيه: ${stock.reason} — راح يتحقق النظام مرة ثانية لحظة موعد النشر ولن ينشر إذا الكمية ما زالت صفر` };
}

/** SCHEDULED → DRAFT, keeps everything else (media/caption) intact. */
export async function cancelSchedule(id: string) {
  const res = await prisma.wholesaleInstagramPost.updateMany({
    where: { id, status: "SCHEDULED" },
    data: { status: "DRAFT", scheduledAt: null },
  });
  if (res.count !== 1) throw new AppError("المنشور مو مجدول حالياً", 400, "WHOLESALE_IG_NOT_SCHEDULED");
}

/** From SKIPPED_OUT_OF_STOCK/FAILED: pick a new time. Never automatic. */
export async function reschedulePost(id: string, scheduledAtIso: string) {
  return schedulePost(id, scheduledAtIso);
}

// ── Publish pipeline ──────────────────────────────────────────────────────────

const CLAIMABLE_STATUSES = ["DRAFT", "SCHEDULED", "FAILED", "SKIPPED_OUT_OF_STOCK"] as const;

/**
 * Atomic claim — the ONLY way a post may enter PUBLISHING. A single
 * conditional UPDATE (`WHERE id = ? AND status IN (...)`) is atomic in
 * Postgres: if two workers (two server instances, an overlapping cron tick,
 * a double-click) race for the same row, exactly one UPDATE affects a row
 * (count === 1) and every other caller sees count === 0 and backs off. No
 * SELECT-then-UPDATE window, so there is nothing to race.
 */
async function claimPost(id: string): Promise<boolean> {
  const res = await prisma.wholesaleInstagramPost.updateMany({
    where: { id, status: { in: [...CLAIMABLE_STATUSES] } },
    data: { status: "PUBLISHING", errorMessage: null, skipReason: null, attemptCount: { increment: 1 } },
  });
  return res.count === 1;
}

/** "انشر الآن" / retry — synchronous claim, then fires the same pipeline as the tick. */
export async function publishNow(id: string): Promise<void> {
  const claimed = await claimPost(id);
  if (!claimed) throw new AppError("المنشور مو جاهز للنشر الآن (قيد النشر أو منشور فعلاً)", 409, "WHOLESALE_IG_NOT_CLAIMABLE");
  void runWholesalePublish(id);
}

async function markSkipped(id: string, reason: string) {
  await prisma.wholesaleInstagramPost.update({ where: { id }, data: { status: "SKIPPED_OUT_OF_STOCK", skipReason: reason } }).catch(() => undefined);
}

async function markFailed(id: string, message: string) {
  await prisma.wholesaleInstagramPost.update({ where: { id }, data: { status: "FAILED", errorMessage: message } }).catch(() => undefined);
}

/**
 * Runs a CLAIMED post (status already PUBLISHING) to completion. Called by
 * publishNow() and by the per-minute tick — both go through claimPost() first,
 * so this never runs twice for the same post concurrently.
 */
export async function runWholesalePublish(postId: string): Promise<void> {
  const post = await prisma.wholesaleInstagramPost.findUnique({
    where: { id: postId },
    include: { account: true, media: { include: { mediaAsset: { select: { publicToken: true } } }, orderBy: { sortOrder: "asc" } } },
  });
  if (!post) return;
  if (post.status !== "PUBLISHING") return; // not claimed — nothing to do

  // Mandatory, publish-blocking stock check — right here, right before any
  // Meta call, never earlier. Never retried automatically on failure.
  const stock = await checkStock(post.productId);
  if (!stock.available) {
    await markSkipped(postId, stock.reason ?? "غير متوفر");
    return;
  }

  if (post.account.status !== "connected") {
    await markFailed(postId, "حساب انستغرام غير مربوط أو توكنه منتهي — أعد الربط من الإعدادات");
    return;
  }
  if (!post.media.length) {
    await markFailed(postId, "ماكو صور بهذا المنشور");
    return;
  }

  const token = decryptSecret(post.account.accessTokenEnc);
  const igUserId = post.account.igUserId;

  try {
    // Retry path: media already published in a previous attempt → just finish.
    if (post.igMediaId) {
      await finalizeSuccess(postId, post.igMediaId, token);
      return;
    }

    let creationId = post.igCreationId;
    if (!creationId) {
      if (post.media.length === 1) {
        const c = await graphFetch<{ id: string }>(`${igUserId}/media`, {
          access_token: token,
          media_type: "IMAGE",
          image_url: publicMediaUrl(post.media[0].mediaAsset.publicToken),
          caption: post.caption,
        }, "POST");
        creationId = c.id;
      } else {
        const childIds: string[] = [];
        for (const m of post.media) {
          const c = await graphFetch<{ id: string }>(`${igUserId}/media`, {
            access_token: token,
            media_type: "IMAGE",
            image_url: publicMediaUrl(m.mediaAsset.publicToken),
            is_carousel_item: "true",
          }, "POST");
          childIds.push(c.id);
        }
        const c = await graphFetch<{ id: string }>(`${igUserId}/media`, {
          access_token: token,
          media_type: "CAROUSEL",
          children: childIds.join(","),
          caption: post.caption,
        }, "POST");
        creationId = c.id;
      }
      // Idempotency checkpoint: container id saved BEFORE any later step.
      await prisma.wholesaleInstagramPost.update({ where: { id: postId }, data: { igCreationId: creationId } });
    }

    if (post.postType === "CAROUSEL") await waitForContainer(creationId, token, 5 * 60 * 1000);

    const published = await graphFetch<{ id: string }>(`${igUserId}/media_publish`, {
      access_token: token,
      creation_id: creationId,
    }, "POST");

    // Idempotency checkpoint: media id saved immediately after creation.
    await prisma.wholesaleInstagramPost.update({ where: { id: postId }, data: { igMediaId: published.id } });
    await finalizeSuccess(postId, published.id, token);
  } catch (error) {
    const message = error instanceof AppError ? error.message : error instanceof Error ? `خطأ غير متوقع: ${error.message}` : "فشل غير معروف";
    await markFailed(postId, message);
  }
}

async function finalizeSuccess(postId: string, igMediaId: string, token: string) {
  let permalink: string | null = null;
  try {
    const info = await graphFetch<{ permalink?: string }>(igMediaId, { access_token: token, fields: "permalink" });
    permalink = info.permalink ?? null;
  } catch {
    /* permalink is cosmetic — never fail the publish over it */
  }
  await prisma.wholesaleInstagramPost.update({
    where: { id: postId },
    data: { status: "PUBLISHED", permalink, publishedAt: new Date(), errorMessage: null },
  });
}
