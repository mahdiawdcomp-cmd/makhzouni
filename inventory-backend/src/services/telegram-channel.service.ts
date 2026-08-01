// «قناة تيليگرام» — keeps a public Telegram channel in sync with the wholesale
// catalog. Every available product (stock > 0, has an image) gets one channel
// post (photo + name + item number + piece/carton price + catalog link); when
// it sells out / gets deleted the post is removed, and price/name changes edit
// the same message silently. Restock after zero = a fresh post at the bottom
// (the old row is gone by then), so followers get notified naturally.
//
// Runs as a reconcile worker (cron tick every minute, see
// notification-jobs.service) rather than instant stock hooks: simpler, immune
// to Telegram rate limits, and a few minutes of delay was explicitly accepted.
// Uses its OWN bot credentials (telegramChannelBotToken/telegramChannelChatId)
// — never the backup bot's telegramBotToken/telegramChatId.
import crypto from "crypto";
import prisma from "../config/database";
import { getSettings, updateSettings, AppSettings } from "./settings.service";
import { totalStock } from "../utils/product-stock";
import { AppError } from "../utils/app-error";
import { backendPublicUrl } from "../utils/public-urls";

const TG_API = "https://api.telegram.org";
// Telegram allows ~20 msgs/min per group/channel; stay well under it and
// leave headroom for the rest of the app. Initial sync of a large catalog
// simply spreads across successive ticks.
const MAX_OPS_PER_TICK = 12;
const DELAY_BETWEEN_OPS_MS = 3_000;

type SyncStatus = {
  lastRunAt: string | null;
  lastError: string | null;
  lastRunPublished: number;
  lastRunDeleted: number;
  lastRunEdited: number;
};

const status: SyncStatus = {
  lastRunAt: null,
  lastError: null,
  lastRunPublished: 0,
  lastRunDeleted: 0,
  lastRunEdited: 0,
};

// Last-run info for the two daily freshness jobs — surfaced in the settings
// status card so the shop owner can confirm they're actually running without
// opening Telegram to check.
const rotationStatus = { lastRunAt: null as string | null, lastRunCount: 0, lastError: null as string | null };
const featuredStatus = { lastRunAt: null as string | null, lastError: null as string | null };

// Shared serialization lock for ALL channel writes (sync tick, daily
// rotation, featured pin, manual republish). Without it the daily jobs —
// which run for minutes — overlap the per-minute sync tick and both call
// deleteMessage/sendPhoto for the SAME product, producing a duplicate
// channel post whose row is then orphaned (never tracked, never cleaned up).
// Everything below runs strictly one-at-a-time through withChannelLock.
let channelLock: Promise<void> = Promise.resolve();
let channelBusy = false;

function withChannelLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = channelLock.then(async () => {
    channelBusy = true;
    try {
      return await fn();
    } finally {
      channelBusy = false;
    }
  });
  // Swallow errors on the chain itself so one failed op doesn't poison the
  // lock for the next caller (the original result still rejects to ITS caller).
  channelLock = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha1(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function currencyLabel(currency: string) {
  return currency === "IQD" ? "د.ع" : currency;
}

function formatPrice(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

type CatalogProduct = {
  id: string;
  itemNumber: string;
  name: string;
  salePrice: unknown;
  pcsPerCarton: number;
  thumbnailUrl: string | null;
};

// salePrice is the PIECE price across the app; carton = salePrice * pcsPerCarton
// (same convention as catalog.service salePriceFor).
export function buildCaption(product: CatalogProduct, settings: AppSettings): string {
  const cur = currencyLabel(settings.currency || "IQD");
  const piece = Number(product.salePrice) || 0;
  const pcs = Math.max(1, product.pcsPerCarton);
  const carton = piece * pcs;
  const lines = [
    `🛍️ ${product.name}`,
    `🔢 رقم المادة: ${product.itemNumber}`,
    `💰 سعر القطعة: ${formatPrice(piece)} ${cur}`,
    `📦 سعر الكارتون (${pcs} قطعة): ${formatPrice(carton)} ${cur}`,
  ];
  const catalogUrl = (settings.catalogPublicUrl || "").trim();
  if (catalogUrl) {
    lines.push("", `🛒 اطلب من الكتلوك:`, catalogUrl);
  }
  // Telegram photo captions are capped at 1024 chars.
  return lines.join("\n").slice(0, 1024);
}

function parseDataUrl(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

// Telegram answers a rate-limit hit with ok:false + parameters.retry_after
// (seconds). We honor it with a bounded wait+retry instead of failing the op
// outright — a burst (e.g. an initial catalog sync or a big rotation) would
// otherwise drop posts on the floor. Capped so a hostile/huge retry_after
// can't hang a worker indefinitely.
const MAX_TG_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 30_000;

export async function tgCall(botToken: string, method: string, body: FormData | Record<string, unknown>) {
  const url = `${TG_API}/bot${botToken}/${method}`;
  const init: RequestInit =
    body instanceof FormData
      ? { method: "POST", body }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };

  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, init);
    const json = (await res.json().catch(() => null)) as
      | { ok: boolean; result?: unknown; description?: string; parameters?: { retry_after?: number } }
      | null;
    if (!json) throw new Error(`Telegram ${method}: HTTP ${res.status} (no JSON)`);
    if (json.ok) return json.result;

    const retryAfter = json.parameters?.retry_after;
    if (retryAfter && retryAfter > 0 && attempt < MAX_TG_RETRIES) {
      await sleep(Math.min(retryAfter * 1000, MAX_RETRY_WAIT_MS));
      continue;
    }

    const err = new Error(`Telegram ${method}: ${json.description || `HTTP ${res.status}`}`) as Error & {
      tgDescription?: string;
      retryAfter?: number;
    };
    err.tgDescription = json.description || "";
    err.retryAfter = retryAfter;
    throw err;
  }
}

// Bot username cache (for the «اطلب» deep-link button). Refreshed when the
// token changes.
let cachedBotUsername: { token: string; username: string } | null = null;

export async function getBotUsername(botToken: string): Promise<string> {
  if (cachedBotUsername?.token === botToken) return cachedBotUsername.username;
  const me = (await tgCall(botToken, "getMe", {})) as { username?: string };
  const username = me.username || "";
  cachedBotUsername = { token: botToken, username };
  return username;
}

/** Inline «🛒 اطلب» button — deep link into the bot with the product id. */
function orderButtonMarkup(botUsername: string, productId: string) {
  if (!botUsername) return undefined;
  return {
    inline_keyboard: [
      [{ text: "🛒 اطلب هذي المادة", url: `https://t.me/${botUsername}?start=p_${productId}` }],
    ],
  };
}

/** Loads the product's full image (fallback thumbnail) as a Blob for upload. */
export async function loadPhotoBlob(productId: string): Promise<Blob | null> {
  const row = await prisma.product.findUnique({
    where: { id: productId },
    select: { imageUrl: true, thumbnailUrl: true },
  });
  const dataUrl = row?.imageUrl || row?.thumbnailUrl;
  if (!dataUrl) return null;
  // Remote URL (rare legacy case) — Telegram can fetch it itself.
  if (/^https?:\/\//.test(dataUrl)) return null;
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  return new Blob([new Uint8Array(parsed.buffer)], { type: parsed.mime });
}

async function imageHashFor(productId: string): Promise<string> {
  const row = await prisma.product.findUnique({
    where: { id: productId },
    select: { imageUrl: true, thumbnailUrl: true },
  });
  const dataUrl = row?.imageUrl || row?.thumbnailUrl;
  return dataUrl ? sha1(dataUrl) : "";
}

async function publishProduct(
  botToken: string,
  chatId: string,
  product: CatalogProduct,
  settings: AppSettings,
): Promise<void> {
  const caption = buildCaption(product, settings);
  const photo = await loadPhotoBlob(product.id);
  if (!photo) return; // image vanished between the query and now — next tick recounts it
  const botUsername = await getBotUsername(botToken).catch(() => "");
  const markup = orderButtonMarkup(botUsername, product.id);
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("photo", photo, `${product.itemNumber}.jpg`);
  form.append("caption", caption);
  if (markup) form.append("reply_markup", JSON.stringify(markup));
  const result = (await tgCall(botToken, "sendPhoto", form)) as { message_id: number };
  await prisma.telegramChannelPost.upsert({
    where: { productId: product.id },
    create: {
      productId: product.id,
      messageId: result.message_id,
      captionHash: sha1(caption),
      imageHash: await imageHashFor(product.id),
      buttonAdded: !!markup,
    },
    update: {
      messageId: result.message_id,
      captionHash: sha1(caption),
      imageHash: await imageHashFor(product.id),
      buttonAdded: !!markup,
    },
  });
}

function isGoneError(err: unknown): boolean {
  const desc = ((err as { tgDescription?: string })?.tgDescription || String(err)).toLowerCase();
  return (
    desc.includes("message to delete not found") ||
    desc.includes("message to edit not found") ||
    desc.includes("message can't be deleted") ||
    desc.includes("message_id_invalid")
  );
}

function isNotModifiedError(err: unknown): boolean {
  const desc = ((err as { tgDescription?: string })?.tgDescription || String(err)).toLowerCase();
  return desc.includes("message is not modified");
}

async function deletePost(botToken: string, chatId: string, post: { id: string; messageId: number }) {
  try {
    await tgCall(botToken, "deleteMessage", { chat_id: chatId, message_id: post.messageId });
  } catch (err) {
    if (!isGoneError(err)) throw err;
  }
  await prisma.telegramChannelPost.delete({ where: { id: post.id } }).catch(() => undefined);
}

async function editPost(
  botToken: string,
  chatId: string,
  post: { id: string; messageId: number; captionHash: string; imageHash: string },
  product: CatalogProduct,
  settings: AppSettings,
): Promise<"edited" | "republished" | "skipped"> {
  const caption = buildCaption(product, settings);
  const newCaptionHash = sha1(caption);
  const newImageHash = await imageHashFor(product.id);
  const captionChanged = newCaptionHash !== post.captionHash;
  const imageChanged = newImageHash !== post.imageHash && newImageHash !== "";
  if (!captionChanged && !imageChanged) return "skipped";
  const botUsername = await getBotUsername(botToken).catch(() => "");
  const markup = orderButtonMarkup(botUsername, product.id);
  try {
    if (imageChanged) {
      const photo = await loadPhotoBlob(product.id);
      if (photo) {
        const form = new FormData();
        form.append("chat_id", chatId);
        form.append("message_id", String(post.messageId));
        form.append("media", JSON.stringify({ type: "photo", media: "attach://photo", caption }));
        form.append("photo", photo, `${product.itemNumber}.jpg`);
        // edits drop the inline keyboard unless re-sent explicitly
        if (markup) form.append("reply_markup", JSON.stringify(markup));
        await tgCall(botToken, "editMessageMedia", form);
      }
    } else {
      await tgCall(botToken, "editMessageCaption", {
        chat_id: chatId,
        message_id: post.messageId,
        caption,
        ...(markup ? { reply_markup: markup } : {}),
      });
    }
  } catch (err) {
    if (isNotModifiedError(err)) {
      // fall through to hash update below
    } else if (isGoneError(err)) {
      // The channel message was manually deleted — drop the row so the next
      // tick republishes the product fresh.
      await prisma.telegramChannelPost.delete({ where: { id: post.id } }).catch(() => undefined);
      return "republished";
    } else {
      throw err;
    }
  }
  await prisma.telegramChannelPost.update({
    where: { id: post.id },
    data: { captionHash: newCaptionHash, imageHash: newImageHash || post.imageHash },
  });
  return "edited";
}

/**
 * Available = not soft-deleted AND stock > 0 (any amount — decided 2026-07-20,
 * NOT full-carton-only) AND has an image. Products missing an image are
 * intentionally skipped and surfaced via missingImageCount (site banner).
 */
async function listDesiredProducts(): Promise<{ desired: CatalogProduct[]; missingImage: number }> {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      itemNumber: true,
      name: true,
      salePrice: true,
      pcsPerCarton: true,
      thumbnailUrl: true,
      openingBalancePcs: true,
      cartonsAvailable: true,
      warehouseStocks: { select: { quantityPieces: true } },
    },
  });
  const inStock = products.filter((p) => totalStock(p) > 0);
  // thumbnailUrl presence is the cheap image signal (every image upload writes
  // both fields); products with a full image but no thumbnail still publish —
  // the heavier imageUrl check only runs for that small remainder.
  const withThumb = inStock.filter((p) => !!p.thumbnailUrl);
  const withoutThumb = inStock.filter((p) => !p.thumbnailUrl);
  let extra: typeof withoutThumb = [];
  if (withoutThumb.length > 0) {
    const withFullImage = await prisma.product.findMany({
      where: { id: { in: withoutThumb.map((p) => p.id) }, imageUrl: { not: null } },
      select: { id: true },
    });
    const ok = new Set(withFullImage.map((p) => p.id));
    extra = withoutThumb.filter((p) => ok.has(p.id));
  }
  const desired = [...withThumb, ...extra];
  return { desired, missingImage: inStock.length - desired.length };
}

/* ── Webhook registration (Phase 2 bot) ─────────────────────────────────── */

const WEBHOOK_SECRET_KEY = "telegramChannelWebhookSecret";
let webhookConfirmedFor = ""; // token confirmed this process

export async function getTelegramWebhookSecret(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: WEBHOOK_SECRET_KEY } });
  if (row && typeof row.value === "string" && row.value) return row.value;
  const secret = crypto.randomBytes(24).toString("hex");
  await prisma.setting.upsert({
    where: { key: WEBHOOK_SECRET_KEY },
    create: { key: WEBHOOK_SECRET_KEY, value: secret },
    update: { value: secret },
  });
  return secret;
}

/**
 * Registers the bot webhook once per process (idempotent on Telegram's side).
 * The bot conversation (telegram-bot.service) receives updates on this URL.
 */
async function ensureWebhook(botToken: string) {
  if (webhookConfirmedFor === botToken) return;
  const base = backendPublicUrl();
  const url = `${base}/api/public/telegram/webhook`;
  const secret = await getTelegramWebhookSecret();
  await tgCall(botToken, "setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
  });
  webhookConfirmedFor = botToken;
}


// ── Permanent-failure backoff ────────────────────────────────────────────────
// The sync tick runs EVERY MINUTE. Telegram has a class of errors that will
// never resolve on their own — the bot was removed from the channel, lost its
// posting right, or the chat id is wrong. Observed in production:
// "Bad Request: CHAT_RESTRICTED", once a minute, indefinitely.
//
// Retrying those 1,440 times a day accomplishes nothing, hammers Telegram's
// API with calls that are guaranteed to fail, and buries any real transient
// error under the noise. Back off for an hour instead, and tell the owner in
// plain language what THEY have to fix, since no code change can.
const PERMANENT_TG_ERRORS = [
  "CHAT_RESTRICTED",
  "CHAT_NOT_FOUND",
  "CHAT_WRITE_FORBIDDEN",
  "bot was kicked",
  "bot is not a member",
  "not enough rights",
  "have no rights to send",
  "USER_IS_BLOCKED",
];

const PERMANENT_BACKOFF_MS = 60 * 60 * 1000;
let channelPausedUntil = 0;

function isPermanentTelegramError(error: unknown): boolean {
  const description = String(
    (error as { tgDescription?: string })?.tgDescription ??
      (error instanceof Error ? error.message : error ?? "")
  ).toLowerCase();
  return PERMANENT_TG_ERRORS.some((needle) => description.includes(needle.toLowerCase()));
}

/** Exported for the settings status card and for tests. */
export function channelSyncPausedUntil(): string | null {
  return channelPausedUntil > Date.now() ? new Date(channelPausedUntil).toISOString() : null;
}

async function pauseChannelSync(error: unknown) {
  channelPausedUntil = Date.now() + PERMANENT_BACKOFF_MS;
  const description = String((error as { tgDescription?: string })?.tgDescription ?? "");
  const { notifyAdmin, buildDedupeKey } = await import("./app-notification.service");
  const { NotificationType, NotificationCategory, NotificationSeverity } = await import(
    "../constants/notifications"
  );
  await notifyAdmin({
    type: NotificationType.SYSTEM_ERROR,
    category: NotificationCategory.SYSTEM,
    severity: NotificationSeverity.IMPORTANT,
    title: "قناة تيليگرام متوقفة",
    message:
      "البوت لا يستطيع النشر في القناة. أضفه مشرفاً في القناة مع صلاحية نشر الرسائل، أو صحّح معرّف القناة في الإعدادات. " +
      (description ? `(${description})` : ""),
    entityType: "TELEGRAM_CHANNEL",
    entityId: "sync",
    actionUrl: "/settings",
    dedupeKey: buildDedupeKey(NotificationType.SYSTEM_ERROR, "telegram-channel-restricted"),
  }).catch(() => {});
  console.warn(
    `[TelegramChannel] permanent error (${description}) - sync paused for 60 minutes`
  );
}

/** One reconcile pass, capped per tick. Called by cron + the sync-now endpoint. */
export async function runTelegramChannelSyncTick(): Promise<void> {
  // Skip if any channel op (another tick OR a daily job) is already running —
  // next minute's tick retries. Prevents queueing ticks behind a long job.
  if (channelBusy) return;
  // Backing off from a permanent permission error - nothing to retry until the
  // owner fixes the channel. channelSyncPausedUntil() surfaces this.
  if (Date.now() < channelPausedUntil) return;
  await withChannelLock(async () => {
    const settings = await getSettings();
    const botToken = (settings.telegramChannelBotToken || "").trim();
    const chatId = (settings.telegramChannelChatId || "").trim();
    if (!settings.telegramChannelEnabled || !botToken || !chatId) return;

    try {

    // Bot webhook (Phase 2) — non-fatal if it fails, channel sync continues.
    await ensureWebhook(botToken).catch((err) =>
      console.error("[TelegramChannel] setWebhook failed:", err),
    );

    const { desired } = await listDesiredProducts();
    const desiredById = new Map(desired.map((p) => [p.id, p]));
    const posts = await prisma.telegramChannelPost.findMany();
    const postByProduct = new Map(posts.map((p) => [p.productId, p]));

    const toDelete = posts.filter((p) => !desiredById.has(p.productId));
    const toPublish = desired.filter((p) => !postByProduct.has(p.id));
    const toCheck = desired.filter((p) => postByProduct.has(p.id));

    let ops = 0;
    let published = 0;
    let deleted = 0;
    let edited = 0;

    const spend = async () => {
      ops += 1;
      if (ops < MAX_OPS_PER_TICK) await sleep(DELAY_BETWEEN_OPS_MS);
    };

    // Deletes first — a sold-out product lingering in a public channel is the
    // worst state (customers order it and it's gone).
    for (const post of toDelete) {
      if (ops >= MAX_OPS_PER_TICK) break;
      await deletePost(botToken, chatId, post);
      deleted += 1;
      await spend();
    }
    for (const product of toPublish) {
      if (ops >= MAX_OPS_PER_TICK) break;
      await publishProduct(botToken, chatId, product, settings);
      published += 1;
      await spend();
    }
    for (const product of toCheck) {
      if (ops >= MAX_OPS_PER_TICK) break;
      const post = postByProduct.get(product.id)!;
      const outcome = await editPost(botToken, chatId, post, product, settings);
      if (outcome !== "skipped") {
        edited += 1;
        await spend();
      }
    }

    // Backfill the «اطلب» button on posts published before Phase 2.
    const botUsername = await getBotUsername(botToken).catch(() => "");
    if (botUsername) {
      const missingButton = posts.filter(
        (p) => !p.buttonAdded && desiredById.has(p.productId),
      );
      for (const post of missingButton) {
        if (ops >= MAX_OPS_PER_TICK) break;
        try {
          await tgCall(botToken, "editMessageReplyMarkup", {
            chat_id: chatId,
            message_id: post.messageId,
            reply_markup: orderButtonMarkup(botUsername, post.productId),
          });
        } catch (err) {
          if (!isGoneError(err) && !isNotModifiedError(err)) throw err;
        }
        await prisma.telegramChannelPost
          .update({ where: { id: post.id }, data: { buttonAdded: true } })
          .catch(() => undefined);
        await spend();
      }
    }

      status.lastRunAt = new Date().toISOString();
      status.lastError = null;
      status.lastRunPublished = published;
      status.lastRunDeleted = deleted;
      status.lastRunEdited = edited;
    } catch (error) {
      status.lastRunAt = new Date().toISOString();
      status.lastError = error instanceof Error ? error.message : String(error);
      // A permission/limit error will not fix itself on the next minute's tick.
      // Pause and tell the owner what to do instead of failing 1,440 times a day.
      if (isPermanentTelegramError(error)) await pauseChannelSync(error);
      throw error;
    }
  });
}

/** Status for the settings tab + the missing-image site banner. */
export async function getTelegramChannelStatus() {
  const settings = await getSettings();
  const configured = !!(
    (settings.telegramChannelBotToken || "").trim() && (settings.telegramChannelChatId || "").trim()
  );
  const { desired, missingImage } = await listDesiredProducts();
  const postedCount = await prisma.telegramChannelPost.count();
  const featuredProduct = settings.telegramFeaturedProductId
    ? await prisma.product
        .findFirst({ where: { id: settings.telegramFeaturedProductId, deletedAt: null }, select: { name: true } })
        .catch(() => null)
    : null;
  return {
    enabled: !!settings.telegramChannelEnabled,
    configured,
    availableCount: desired.length,
    postedCount,
    pendingCount: Math.max(0, desired.length - postedCount),
    missingImageCount: missingImage,
    lastRunAt: status.lastRunAt,
    lastError: status.lastError,
    lastRunPublished: status.lastRunPublished,
    lastRunDeleted: status.lastRunDeleted,
    lastRunEdited: status.lastRunEdited,
    // Daily freshness jobs (rotation + featured pin)
    rotationDailyCount: Math.max(1, Math.min(50, settings.telegramRotationDailyCount ?? 12)),
    rotationLastRunAt: rotationStatus.lastRunAt,
    rotationLastRunCount: rotationStatus.lastRunCount,
    rotationLastError: rotationStatus.lastError,
    featuredLastRunAt: featuredStatus.lastRunAt,
    featuredLastError: featuredStatus.lastError,
    featuredProductName: featuredProduct?.name ?? null,
  };
}

/** Sends a test message to the channel and deletes it right away. */
export async function testTelegramChannel(): Promise<{ botName: string }> {
  const settings = await getSettings();
  const botToken = (settings.telegramChannelBotToken || "").trim();
  const chatId = (settings.telegramChannelChatId || "").trim();
  if (!botToken || !chatId) {
    throw new AppError("توكن البوت ومعرّف القناة مطلوبان — احفظ الإعدادات أولاً", 400, "TELEGRAM_CHANNEL_NOT_CONFIGURED");
  }
  try {
    const me = (await tgCall(botToken, "getMe", {})) as { username?: string; first_name?: string };
    const sent = (await tgCall(botToken, "sendMessage", {
      chat_id: chatId,
      text: "✅ اختبار الربط — بوت القناة شغال",
    })) as { message_id: number };
    await tgCall(botToken, "deleteMessage", { chat_id: chatId, message_id: sent.message_id }).catch(
      () => undefined,
    );
    return { botName: me.username || me.first_name || "bot" };
  } catch (error) {
    // Surface Telegram's own description as a 400 (not a generic 500) so the
    // settings page shows the real reason (wrong token, chat not found, bot
    // not admin…).
    const desc = (error as { tgDescription?: string })?.tgDescription || (error as Error).message;
    throw new AppError(`فشل اختبار تيليگرام: ${desc}`, 400, "TELEGRAM_CHANNEL_TEST_FAILED");
  }
}

/* ── Freshness: manual republish + daily rotation + featured pin ────────── */
// A product's post only ever moves (delete+republish → lands at the newest
// position) on the restock-after-zero cycle above. Products that stay
// continuously in stock never resurface and sink under newer posts. These
// three entry points give admins a manual "bump" and two daily automatic
// ones so the whole catalog cycles back to "new" over time.

async function republishOne(
  botToken: string,
  chatId: string,
  product: CatalogProduct,
  settings: AppSettings,
  existingPost?: { id: string; messageId: number },
): Promise<void> {
  if (existingPost) {
    await deletePost(botToken, chatId, existingPost);
    // Deleting a message auto-unpins it on Telegram's side. If this post was
    // the current "featured" pin, drop the stale tracking so the next featured
    // run doesn't try to unpin a ghost message and the channel isn't left
    // believing something is featured when it isn't.
    if (settings.telegramFeaturedLastMessageId && settings.telegramFeaturedLastMessageId === existingPost.messageId) {
      await updateSettings({ telegramFeaturedLastMessageId: 0, telegramFeaturedProductId: "" }).catch(() => undefined);
    }
  }
  await publishProduct(botToken, chatId, product, settings);
}

/** Admin-triggered: republish one product right now (promotions, slow movers). */
export async function republishProductInChannel(productId: string): Promise<{ ok: boolean; reason?: string }> {
  const settings = await getSettings();
  const botToken = (settings.telegramChannelBotToken || "").trim();
  const chatId = (settings.telegramChannelChatId || "").trim();
  if (!settings.telegramChannelEnabled || !botToken || !chatId) {
    return { ok: false, reason: "القناة غير مفعّلة أو غير مهيأة" };
  }
  const { desired } = await listDesiredProducts();
  const product = desired.find((p) => p.id === productId);
  if (!product) {
    return { ok: false, reason: "المادة غير قابلة للنشر حالياً (نفدت أو بلا صورة)" };
  }
  await withChannelLock(async () => {
    // Re-read the existing post INSIDE the lock — two rapid clicks (or an
    // overlapping sync tick) must not each delete a now-stale row and leave a
    // duplicate live post orphaned in the channel.
    const existingPost = await prisma.telegramChannelPost.findUnique({ where: { productId } });
    await republishOne(botToken, chatId, product, settings, existingPost ?? undefined);
  });
  return { ok: true };
}

/** Daily cron: republish the N oldest channel posts so long-standing
 * in-stock products cycle back to "new" without admin attention. */
export async function runDailyChannelRotationJob(): Promise<void> {
  const settings = await getSettings();
  const botToken = (settings.telegramChannelBotToken || "").trim();
  const chatId = (settings.telegramChannelChatId || "").trim();
  if (!settings.telegramChannelEnabled || !botToken || !chatId) return;

  await withChannelLock(async () => {
    const count = Math.max(1, Math.min(50, settings.telegramRotationDailyCount ?? 12));
    const { desired } = await listDesiredProducts();
    const desiredById = new Map(desired.map((p) => [p.id, p]));

    const oldest = await prisma.telegramChannelPost.findMany({
      orderBy: { publishedAt: "asc" },
      take: count,
    });

    let republished = 0;
    let lastError: string | null = null;
    for (const post of oldest) {
      const product = desiredById.get(post.productId);
      if (!product) continue; // no longer desired — the per-minute sync tick already handles removing it
      try {
        await republishOne(botToken, chatId, product, settings, post);
        republished += 1;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error("[TelegramChannel] rotation republish failed:", error);
      }
      await sleep(DELAY_BETWEEN_OPS_MS);
    }
    rotationStatus.lastRunAt = new Date().toISOString();
    rotationStatus.lastRunCount = republished;
    rotationStatus.lastError = lastError;
  });
}

/** Daily cron: pin a randomly-featured in-stock product, unpinning
 * yesterday's — independent of the daily-digest pin (Telegram channels
 * support multiple pinned messages, no conflict). */
export async function runFeaturedProductRotationJob(): Promise<void> {
  const settings = await getSettings();
  const botToken = (settings.telegramChannelBotToken || "").trim();
  const chatId = (settings.telegramChannelChatId || "").trim();
  if (!settings.telegramChannelEnabled || !botToken || !chatId) return;

  await withChannelLock(async () => {
    const { desired } = await listDesiredProducts();
    if (!desired.length) return;

    const candidates =
      desired.length > 1 ? desired.filter((p) => p.id !== settings.telegramFeaturedProductId) : desired;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];

    const post = await prisma.telegramChannelPost.findUnique({ where: { productId: pick.id } });
    if (!post) return; // hasn't been published yet — next day's run tries again

    if (settings.telegramFeaturedLastMessageId) {
      await tgCall(botToken, "unpinChatMessage", {
        chat_id: chatId,
        message_id: settings.telegramFeaturedLastMessageId,
      }).catch(() => undefined);
    }

    // Only record the new featured pin if it ACTUALLY landed — otherwise the DB
    // claims a message is pinned that isn't, tomorrow's unpin hits a ghost, and
    // "exclude yesterday's pick" keeps excluding a never-featured product.
    let pinned = false;
    try {
      await tgCall(botToken, "pinChatMessage", { chat_id: chatId, message_id: post.messageId });
      pinned = true;
    } catch (error) {
      console.error("[TelegramChannel] featured pin failed:", error);
    }
    if (pinned) {
      await updateSettings({
        telegramFeaturedProductId: pick.id,
        telegramFeaturedLastMessageId: post.messageId,
        telegramFeaturedLastDate: new Date().toISOString().slice(0, 10),
      });
    }
    featuredStatus.lastRunAt = new Date().toISOString();
    featuredStatus.lastError = pinned ? null : "فشل تثبيت المنتج المميز";
  });
}
