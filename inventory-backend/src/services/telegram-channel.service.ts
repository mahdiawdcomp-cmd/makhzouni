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
import { getSettings, AppSettings } from "./settings.service";
import { totalStock } from "../utils/product-stock";
import { AppError } from "../utils/app-error";

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

let running = false;

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

async function tgCall(botToken: string, method: string, body: FormData | Record<string, unknown>) {
  const url = `${TG_API}/bot${botToken}/${method}`;
  const init: RequestInit =
    body instanceof FormData
      ? { method: "POST", body }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => null)) as
    | { ok: boolean; result?: unknown; description?: string; parameters?: { retry_after?: number } }
    | null;
  if (!json) throw new Error(`Telegram ${method}: HTTP ${res.status} (no JSON)`);
  if (!json.ok) {
    const err = new Error(`Telegram ${method}: ${json.description || `HTTP ${res.status}`}`) as Error & {
      tgDescription?: string;
      retryAfter?: number;
    };
    err.tgDescription = json.description || "";
    err.retryAfter = json.parameters?.retry_after;
    throw err;
  }
  return json.result;
}

/** Loads the product's full image (fallback thumbnail) as a Blob for upload. */
async function loadPhotoBlob(productId: string): Promise<Blob | null> {
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
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("photo", photo, `${product.itemNumber}.jpg`);
  form.append("caption", caption);
  const result = (await tgCall(botToken, "sendPhoto", form)) as { message_id: number };
  await prisma.telegramChannelPost.upsert({
    where: { productId: product.id },
    create: {
      productId: product.id,
      messageId: result.message_id,
      captionHash: sha1(caption),
      imageHash: await imageHashFor(product.id),
    },
    update: {
      messageId: result.message_id,
      captionHash: sha1(caption),
      imageHash: await imageHashFor(product.id),
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
  try {
    if (imageChanged) {
      const photo = await loadPhotoBlob(product.id);
      if (photo) {
        const form = new FormData();
        form.append("chat_id", chatId);
        form.append("message_id", String(post.messageId));
        form.append("media", JSON.stringify({ type: "photo", media: "attach://photo", caption }));
        form.append("photo", photo, `${product.itemNumber}.jpg`);
        await tgCall(botToken, "editMessageMedia", form);
      }
    } else {
      await tgCall(botToken, "editMessageCaption", {
        chat_id: chatId,
        message_id: post.messageId,
        caption,
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

/** One reconcile pass, capped per tick. Called by cron + the sync-now endpoint. */
export async function runTelegramChannelSyncTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const settings = await getSettings();
    const botToken = (settings.telegramChannelBotToken || "").trim();
    const chatId = (settings.telegramChannelChatId || "").trim();
    if (!settings.telegramChannelEnabled || !botToken || !chatId) return;

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

    status.lastRunAt = new Date().toISOString();
    status.lastError = null;
    status.lastRunPublished = published;
    status.lastRunDeleted = deleted;
    status.lastRunEdited = edited;
  } catch (error) {
    status.lastRunAt = new Date().toISOString();
    status.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    running = false;
  }
}

/** Status for the settings tab + the missing-image site banner. */
export async function getTelegramChannelStatus() {
  const settings = await getSettings();
  const configured = !!(
    (settings.telegramChannelBotToken || "").trim() && (settings.telegramChannelChatId || "").trim()
  );
  const { desired, missingImage } = await listDesiredProducts();
  const postedCount = await prisma.telegramChannelPost.count();
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
