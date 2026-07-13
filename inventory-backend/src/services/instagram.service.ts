import sharp from "sharp";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { encryptSecret, decryptSecret } from "../utils/crypto";
import { publicMediaUrl } from "./media-asset.service";

// Instagram auto-publish for «كتلوك المفرد» — Meta Graph API (Business/Creator
// accounts). Every publish goes through an InstagramPost row prepared in the
// web prep modal; this service turns that row into live Meta containers.
//
// Idempotency (locked decision): igCreationId is stored the moment the Meta
// container exists and igMediaId the moment media_publish returns, so a retry
// after a late-stage failure NEVER creates a duplicate live post.

// Meta retired the old Facebook-Login-based Instagram Graph API path for new
// apps; the "Manage messaging and content on Instagram" use case provisions
// the newer "Instagram API with Instagram Login" instead. That flow talks
// directly to Instagram (no Facebook Page indirection): auth at
// instagram.com, token exchange at api.instagram.com, everything else at
// graph.instagram.com. The IG account itself is the top-level entity.
const GRAPH = "https://graph.instagram.com/v21.0";

// ── App credentials (per-tenant DB override → env fallback) ─────────────────

async function settingValue(key: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  const v = row?.value;
  return typeof v === "string" ? v : "";
}

export async function getInstagramAppConfig() {
  const appId = (await settingValue("instagramAppId")) || process.env.INSTAGRAM_APP_ID?.trim() || "";
  const appSecret = (await settingValue("instagramAppSecret")) || process.env.INSTAGRAM_APP_SECRET?.trim() || "";
  return { appId, appSecret };
}

export async function saveInstagramAppConfig(input: { appId?: string; appSecret?: string }) {
  const entries: Array<[string, string]> = [];
  if (input.appId !== undefined) entries.push(["instagramAppId", input.appId.trim()]);
  if (input.appSecret !== undefined) entries.push(["instagramAppSecret", input.appSecret.trim()]);
  for (const [key, value] of entries) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  return getInstagramAppConfig();
}

// ── Graph helpers ────────────────────────────────────────────────────────────

type GraphError = { message: string; code?: number; error_subcode?: number };

async function graphFetch<T>(path: string, params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<T> {
  const qs = new URLSearchParams(params);
  const url = method === "GET" ? `${GRAPH}/${path}?${qs}` : `${GRAPH}/${path}`;
  const res = await fetch(url, method === "GET" ? {} : { method: "POST", body: qs });
  const json = (await res.json().catch(() => ({}))) as { error?: GraphError } & T;
  if (!res.ok || json.error) {
    const err = json.error;
    throw new AppError(
      err?.message ? `Meta API: ${err.message}` : `Meta API request failed (${res.status})`,
      502,
      "META_API_ERROR"
    );
  }
  return json;
}

function accountToken(account: { accessTokenEnc: string }): string {
  return decryptSecret(account.accessTokenEnc);
}

// ── OAuth / connection ───────────────────────────────────────────────────────

const OAUTH_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
].join(",");

export function oauthRedirectUri(): string {
  const base = (process.env.BACKEND_PUBLIC_URL?.trim() || "https://api.mazbwoni.com").replace(/\/$/, "");
  return `${base}/public/instagram/oauth-callback`;
}

export async function getOauthUrl(returnTo: string): Promise<string> {
  const { appId } = await getInstagramAppConfig();
  if (!appId) {
    throw new AppError(
      "لم يتم إعداد تطبيق ميتا بعد — أدخل Instagram App ID و App Secret في الإعدادات أولاً",
      400,
      "INSTAGRAM_APP_NOT_CONFIGURED"
    );
  }
  const qs = new URLSearchParams({
    client_id: appId,
    redirect_uri: oauthRedirectUri(),
    scope: OAUTH_SCOPES,
    response_type: "code",
    state: Buffer.from(JSON.stringify({ returnTo })).toString("base64url"),
  });
  return `https://www.instagram.com/oauth/authorize?${qs}`;
}

/** Register (or refresh) an account from a long-lived Instagram User Access Token. */
async function upsertAccountFromToken(token: string, expiresAt: Date | null) {
  const profile = await graphFetch<{ user_id: string; username: string; name?: string; profile_picture_url?: string }>(
    "me",
    { access_token: token, fields: "user_id,username,name,profile_picture_url" }
  );
  const data = {
    username: profile.username,
    name: profile.name,
    profilePictureUrl: profile.profile_picture_url,
    accessTokenEnc: encryptSecret(token),
    tokenExpiresAt: expiresAt,
    status: "connected" as const,
    lastError: null,
  };
  return prisma.instagramAccount.upsert({
    where: { igUserId: profile.user_id },
    create: { igUserId: profile.user_id, ...data },
    update: data,
  });
}

/** Manual-token connect path (pre-App-Review testing): token must already be
 *  an Instagram User Access Token (short or long-lived) for a Business/Creator
 *  account — obtained via the Instagram Login OAuth dialog. */
export async function connectWithToken(userAccessToken: string) {
  const { appSecret } = await getInstagramAppConfig();
  const token = userAccessToken.trim();
  let longToken = token;
  let expiresAt: Date | null = null;
  if (appSecret) {
    try {
      const long = await graphFetch<{ access_token: string; expires_in: number }>("access_token", {
        grant_type: "ig_exchange_token",
        client_secret: appSecret,
        access_token: token,
      });
      longToken = long.access_token;
      expiresAt = new Date(Date.now() + long.expires_in * 1000);
    } catch {
      // Token may already be long-lived — proceed with it as-is.
    }
  }
  const account = await upsertAccountFromToken(longToken, expiresAt);
  return [serializeAccount(account)];
}

export async function handleOauthCallback(code: string, state: string): Promise<string> {
  const { appId, appSecret } = await getInstagramAppConfig();
  const form = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: oauthRedirectUri(),
    code,
  });
  const res = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
  const shortJson = (await res.json().catch(() => ({}))) as { access_token?: string; error_message?: string };
  if (!res.ok || !shortJson.access_token) {
    throw new AppError(`Meta API: ${shortJson.error_message ?? "فشل تبادل رمز الدخول"}`, 502, "META_API_ERROR");
  }
  const long = await graphFetch<{ access_token: string; expires_in: number }>("access_token", {
    grant_type: "ig_exchange_token",
    client_secret: appSecret,
    access_token: shortJson.access_token,
  });
  await upsertAccountFromToken(long.access_token, new Date(Date.now() + long.expires_in * 1000));
  let returnTo = "/settings";
  try {
    returnTo = (JSON.parse(Buffer.from(state, "base64url").toString()) as { returnTo?: string }).returnTo || returnTo;
  } catch {
    /* keep default */
  }
  return returnTo;
}

export function serializeAccount(a: {
  id: string;
  igUserId: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
  tokenExpiresAt: Date | null;
  pageName: string | null;
  status: string;
  lastError: string | null;
  createdAt: Date;
}) {
  const expiringSoon =
    a.tokenExpiresAt !== null && a.tokenExpiresAt.getTime() - Date.now() < 14 * 24 * 60 * 60 * 1000;
  return {
    id: a.id,
    igUserId: a.igUserId,
    username: a.username,
    name: a.name,
    profilePictureUrl: a.profilePictureUrl,
    pageName: a.pageName,
    status: a.status,
    lastError: a.lastError,
    tokenExpiresAt: a.tokenExpiresAt,
    tokenExpiringSoon: expiringSoon,
    createdAt: a.createdAt,
  };
}

export async function listAccounts() {
  const accounts = await prisma.instagramAccount.findMany({ orderBy: { createdAt: "asc" } });
  return accounts.map(serializeAccount);
}

export async function disconnectAccount(id: string) {
  await prisma.instagramAccount.update({ where: { id }, data: { status: "disconnected", lastError: null } });
}

export async function deleteAccount(id: string) {
  await prisma.instagramAccount.delete({ where: { id } });
}

/** Verify a stored token still works; refresh profile picture/name while at it. */
export async function checkAccountHealth(id: string) {
  const account = await prisma.instagramAccount.findUnique({ where: { id } });
  if (!account) throw new AppError("الحساب غير موجود", 404, "IG_ACCOUNT_NOT_FOUND");
  try {
    const profile = await graphFetch<{ username: string; name?: string; profile_picture_url?: string }>(
      account.igUserId,
      { access_token: accountToken(account), fields: "username,name,profile_picture_url" }
    );
    const updated = await prisma.instagramAccount.update({
      where: { id },
      data: {
        username: profile.username,
        name: profile.name,
        profilePictureUrl: profile.profile_picture_url,
        status: "connected",
        lastError: null,
      },
    });
    return serializeAccount(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "token check failed";
    const updated = await prisma.instagramAccount.update({
      where: { id },
      data: { status: "error", lastError: message },
    });
    return serializeAccount(updated);
  }
}

// ── Media plan + validation ──────────────────────────────────────────────────

export type MediaPlan = {
  media: Array<{ kind: "image"; imageIndex: number } | { kind: "video" }>;
  coverImageIndex?: number;
};

function parseDataUrl(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

/** Server-side gate before any Meta call (Phase 4). Client validates too for instant UX. */
export async function validateMediaPlan(retailItemId: string, plan: MediaPlan) {
  const item = await prisma.retailCatalogItem.findUnique({
    where: { id: retailItemId },
    include: { videoAsset: { select: { id: true, sizeBytes: true, duration: true, mime: true } } },
  });
  if (!item) throw new AppError("المنتج غير موجود بالكتلوك", 404, "RETAIL_ITEM_NOT_FOUND");
  const images = Array.isArray(item.images) ? (item.images as string[]) : [];
  const warnings: string[] = [];
  if (!plan.media.length) throw new AppError("اختر وسائط واحدة على الأقل", 400, "MEDIA_PLAN_EMPTY");
  if (plan.media.length > 10) throw new AppError("انستغرام يسمح بحد أقصى 10 وسائط بالمنشور الواحد", 400, "MEDIA_PLAN_TOO_LARGE");
  for (const m of plan.media) {
    if (m.kind === "video") {
      if (!item.videoAsset) throw new AppError("هذا المنتج ما بيه فيديو", 400, "NO_VIDEO");
      if (item.videoAsset.duration && item.videoAsset.duration > 40) {
        throw new AppError("مدة الفيديو تتجاوز 40 ثانية", 400, "VIDEO_TOO_LONG");
      }
    } else {
      const dataUrl = images[m.imageIndex];
      if (!dataUrl) throw new AppError("صورة مختارة غير موجودة", 400, "IMAGE_NOT_FOUND");
      const parsed = parseDataUrl(dataUrl);
      if (!parsed) throw new AppError("صيغة صورة غير صالحة", 400, "IMAGE_INVALID");
      try {
        const meta = await sharp(parsed.buffer).metadata();
        if (meta.width && meta.height) {
          const ratio = meta.width / meta.height;
          if (ratio < 0.8 - 0.01 || ratio > 1.91 + 0.01) {
            warnings.push(
              `الصورة رقم ${m.imageIndex + 1} أبعادها ${meta.width}×${meta.height} خارج نطاق انستغرام (4:5 حتى 1.91:1) — راح تُقص تلقائياً`
            );
          }
          if (meta.width < 320) warnings.push(`الصورة رقم ${m.imageIndex + 1} عرضها أقل من 320 بكسل — الجودة راح تكون ضعيفة`);
        }
      } catch {
        throw new AppError("تعذر قراءة الصورة المختارة", 400, "IMAGE_UNREADABLE");
      }
    }
  }
  return { warnings };
}

/** Media-type → post-type mapping (Phase 5, locked). */
export function resolvePostType(plan: MediaPlan): "IMAGE" | "CAROUSEL" | "REEL" {
  const hasVideo = plan.media.some((m) => m.kind === "video");
  const imageCount = plan.media.filter((m) => m.kind === "image").length;
  if (plan.media.length === 1) return hasVideo ? "REEL" : "IMAGE";
  return imageCount + (hasVideo ? 1 : 0) > 1 ? "CAROUSEL" : "IMAGE";
}

// ── Publishing pipeline ──────────────────────────────────────────────────────

/**
 * Materialize a catalog image as a public JPEG MediaAsset (Meta only accepts
 * JPEG over image_url). Center-cropped into range only when out of IG bounds.
 */
async function materializeImage(dataUrl: string): Promise<{ id: string; url: string }> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new AppError("صيغة صورة غير صالحة", 400, "IMAGE_INVALID");
  let pipeline = sharp(parsed.buffer).rotate();
  const meta = await pipeline.metadata();
  if (meta.width && meta.height) {
    const ratio = meta.width / meta.height;
    if (ratio < 0.8) {
      pipeline = pipeline.resize({ width: meta.width, height: Math.round(meta.width / 0.8), fit: "cover" });
    } else if (ratio > 1.91) {
      pipeline = pipeline.resize({ width: Math.round(meta.height * 1.91), height: meta.height, fit: "cover" });
    }
  }
  const jpeg = await pipeline.jpeg({ quality: 90 }).toBuffer();
  const asset = await prisma.mediaAsset.create({
    data: { kind: "image", mime: "image/jpeg", sizeBytes: jpeg.length, bytes: Uint8Array.from(jpeg) },
    select: { id: true, publicToken: true },
  });
  return { id: asset.id, url: publicMediaUrl(asset.publicToken) };
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
      throw new AppError(`فشل تجهيز الوسائط عند ميتا (${status.status ?? status.status_code})`, 502, "META_CONTAINER_ERROR");
    }
    if (Date.now() > deadline) throw new AppError("انتهت مهلة تجهيز الوسائط عند ميتا", 504, "META_CONTAINER_TIMEOUT");
    await new Promise((r) => setTimeout(r, 4000));
  }
}

/** Rolling 24h API quota (100 posts). Carousel counts as one. */
export async function getPublishingQuota(accountId: string) {
  const account = await prisma.instagramAccount.findUnique({ where: { id: accountId } });
  if (!account) throw new AppError("الحساب غير موجود", 404, "IG_ACCOUNT_NOT_FOUND");
  const json = await graphFetch<{ data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }> }>(
    `${account.igUserId}/content_publishing_limit`,
    { access_token: accountToken(account), fields: "quota_usage,config" }
  );
  const entry = json.data?.[0];
  return { used: entry?.quota_usage ?? 0, total: entry?.config?.quota_total ?? 100 };
}

/**
 * Execute a prepared InstagramPost end-to-end. Never blocks the caller —
 * routes fire this without awaiting (Phase 8) and the UI polls status.
 */
export async function publishPost(postId: string): Promise<void> {
  const post = await prisma.instagramPost.findUnique({
    where: { id: postId },
    include: { account: true, retailItem: { include: { videoAsset: { select: { publicToken: true } } } } },
  });
  if (!post) throw new AppError("المنشور غير موجود", 404, "IG_POST_NOT_FOUND");
  if (post.status === "PUBLISHED") return;
  if (post.account.status !== "connected") {
    await markFailed(postId, "حساب انستغرام غير مربوط أو توكنه منتهي — أعد الربط من الإعدادات");
    return;
  }

  const token = accountToken(post.account);
  const igUserId = post.account.igUserId;
  const tempImageAssets: string[] = [];

  try {
    await prisma.instagramPost.update({
      where: { id: postId },
      data: { status: "PREPARING", errorMessage: null, attemptCount: { increment: 1 } },
    });

    // Retry path 1: media already published in a previous attempt → just finish.
    if (post.igMediaId) {
      await finalizeSuccess(postId, post.igMediaId, token);
      return;
    }

    const quota = await getPublishingQuota(post.accountId).catch(() => null);
    if (quota && quota.used >= quota.total) {
      throw new AppError("وصل الحساب حد ميتا (100 منشور خلال 24 ساعة) — حاول لاحقاً", 429, "META_QUOTA_EXHAUSTED");
    }

    const plan = post.mediaPlan as unknown as MediaPlan;
    const item = post.retailItem;
    if (!item) throw new AppError("المنتج انحذف من الكتلوك", 400, "RETAIL_ITEM_GONE");
    const images = Array.isArray(item.images) ? (item.images as string[]) : [];
    const videoUrl = item.videoAsset ? publicMediaUrl(item.videoAsset.publicToken) : null;
    const coverUrl =
      plan.coverImageIndex !== undefined && images[plan.coverImageIndex]
        ? (await materializeImage(images[plan.coverImageIndex]).then((a) => (tempImageAssets.push(a.id), a.url)))
        : null;

    let creationId = post.igCreationId;

    if (!creationId) {
      if (post.postType === "IMAGE") {
        const media = plan.media[0];
        if (media.kind !== "image") throw new AppError("خطة وسائط غير متوافقة", 400, "MEDIA_PLAN_MISMATCH");
        const img = await materializeImage(images[media.imageIndex]);
        tempImageAssets.push(img.id);
        const c = await graphFetch<{ id: string }>(`${igUserId}/media`, {
          access_token: token,
          media_type: "IMAGE",
          image_url: img.url,
          caption: post.caption,
        }, "POST");
        creationId = c.id;
      } else if (post.postType === "REEL") {
        if (!videoUrl) throw new AppError("ما لكينا فيديو للمنتج", 400, "NO_VIDEO");
        const params: Record<string, string> = {
          access_token: token,
          media_type: "REELS",
          video_url: videoUrl,
          caption: post.caption,
        };
        if (coverUrl) params.cover_url = coverUrl;
        const c = await graphFetch<{ id: string }>(`${igUserId}/media`, params, "POST");
        creationId = c.id;
      } else {
        // CAROUSEL (mixed allowed)
        const childIds: string[] = [];
        for (const m of plan.media) {
          if (m.kind === "image") {
            const img = await materializeImage(images[m.imageIndex]);
            tempImageAssets.push(img.id);
            const c = await graphFetch<{ id: string }>(`${igUserId}/media`, {
              access_token: token,
              image_url: img.url,
              is_carousel_item: "true",
            }, "POST");
            childIds.push(c.id);
          } else {
            if (!videoUrl) throw new AppError("ما لكينا فيديو للمنتج", 400, "NO_VIDEO");
            const c = await graphFetch<{ id: string }>(`${igUserId}/media`, {
              access_token: token,
              media_type: "VIDEO",
              video_url: videoUrl,
              is_carousel_item: "true",
            }, "POST");
            await waitForContainer(c.id, token, 5 * 60 * 1000);
            childIds.push(c.id);
          }
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
      await prisma.instagramPost.update({ where: { id: postId }, data: { igCreationId: creationId, status: "UPLOADING" } });
    } else {
      await prisma.instagramPost.update({ where: { id: postId }, data: { status: "UPLOADING" } });
    }

    if (post.postType === "REEL") await waitForContainer(creationId, token, 10 * 60 * 1000);
    if (post.postType === "CAROUSEL") await waitForContainer(creationId, token, 5 * 60 * 1000);

    const published = await graphFetch<{ id: string }>(`${igUserId}/media_publish`, {
      access_token: token,
      creation_id: creationId,
    }, "POST");

    // Idempotency checkpoint: media id saved immediately after creation.
    await prisma.instagramPost.update({ where: { id: postId }, data: { igMediaId: published.id } });
    await finalizeSuccess(postId, published.id, token);
  } catch (error) {
    const message = error instanceof AppError ? error.message : error instanceof Error ? `خطأ غير متوقع: ${error.message}` : "فشل غير معروف";
    await markFailed(postId, message);
  } finally {
    // Materialized JPEG copies are only needed while Meta pulls them; keep a
    // grace window then delete (Meta fetches immediately on container create).
    if (tempImageAssets.length) {
      setTimeout(() => {
        prisma.mediaAsset.deleteMany({ where: { id: { in: tempImageAssets } } }).catch(() => undefined);
      }, 15 * 60 * 1000).unref?.();
    }
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
  const post = await prisma.instagramPost.update({
    where: { id: postId },
    data: { status: "PUBLISHED", permalink, publishedAt: new Date(), errorMessage: null },
    include: { account: { select: { username: true } } },
  });
  if (post.retailItemId) {
    await prisma.retailCatalogItem.update({
      where: { id: post.retailItemId },
      data: {
        instagramPublishedAt: post.publishedAt,
        instagramPermalink: permalink,
        instagramAccountName: post.account.username,
      },
    }).catch(() => undefined);
  }
}

async function markFailed(postId: string, message: string) {
  await prisma.instagramPost.update({
    where: { id: postId },
    data: { status: "FAILED", errorMessage: message },
  }).catch(() => undefined);
}

// ── Posts (drafts / single publish / retry) ─────────────────────────────────

export type PreparePostInput = {
  retailItemId: string;
  accountId: string;
  caption: string;
  mediaPlan: MediaPlan;
  asDraft: boolean;
  queueId?: string;
  createdById?: string;
};

export async function createPost(input: PreparePostInput) {
  const item = await prisma.retailCatalogItem.findUnique({
    where: { id: input.retailItemId },
    select: { id: true, title: true, product: { select: { name: true } } },
  });
  if (!item) throw new AppError("المنتج غير موجود بالكتلوك", 404, "RETAIL_ITEM_NOT_FOUND");
  await validateMediaPlan(input.retailItemId, input.mediaPlan);
  const postType = resolvePostType(input.mediaPlan);
  let position = 0;
  if (input.queueId) {
    const last = await prisma.instagramPost.findFirst({
      where: { queueId: input.queueId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    position = (last?.position ?? -1) + 1;
  }
  return prisma.instagramPost.create({
    data: {
      retailItemId: input.retailItemId,
      productTitle: item.title || item.product.name,
      accountId: input.accountId,
      queueId: input.queueId ?? null,
      position,
      postType,
      status: input.asDraft ? "DRAFT" : input.queueId ? "QUEUED" : "PREPARING",
      caption: input.caption,
      mediaPlan: input.mediaPlan as unknown as object,
      createdById: input.createdById,
    },
  });
}

export async function retryPost(postId: string) {
  const post = await prisma.instagramPost.findUnique({ where: { id: postId } });
  if (!post) throw new AppError("المنشور غير موجود", 404, "IG_POST_NOT_FOUND");
  if (post.status !== "FAILED") throw new AppError("إعادة المحاولة متاحة فقط للمنشورات الفاشلة", 400, "NOT_FAILED");
  await prisma.instagramPost.update({ where: { id: postId }, data: { status: "PREPARING", errorMessage: null } });
  void publishPost(postId);
}
