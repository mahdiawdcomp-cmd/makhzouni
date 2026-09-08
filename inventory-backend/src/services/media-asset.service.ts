import sharp from "sharp";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { backendPublicUrl } from "../utils/public-urls";

// Video assets for «كتلوك المفرد» (one video per product, locked decision).
// Bytes live in Postgres because Railway app disks are ephemeral; Meta and the
// browser fetch them through a tokenized public URL (see public.routes.ts).

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB (locked decision)
export const MAX_VIDEO_SECONDS = 40; // < 40s (locked decision)
export const ALLOWED_VIDEO_MIMES = ["video/mp4", "video/quicktime"];

export function publicMediaUrl(publicToken: string): string {
  const base = backendPublicUrl();
  // All routers are mounted under /api in server.ts — this MUST match or the
  // URL 404s at the generic catch-all and Meta's media fetch fails silently.
  return `${base}/api/public/media/${publicToken}`;
}

export async function saveVideoAsset(input: {
  buffer: Buffer;
  mime: string;
  duration?: number;
  width?: number;
  height?: number;
}) {
  if (!ALLOWED_VIDEO_MIMES.includes(input.mime)) {
    throw new AppError("صيغة الفيديو غير مدعومة — المسموح MP4 أو MOV", 400, "VIDEO_FORMAT_UNSUPPORTED");
  }
  if (input.buffer.length > MAX_VIDEO_BYTES) {
    throw new AppError("حجم الفيديو يتجاوز الحد الأقصى 100 ميغابايت", 400, "VIDEO_TOO_LARGE");
  }
  if (input.duration !== undefined && input.duration > MAX_VIDEO_SECONDS) {
    throw new AppError("مدة الفيديو يجب أن تكون أقل من 40 ثانية", 400, "VIDEO_TOO_LONG");
  }
  return prisma.mediaAsset.create({
    data: {
      kind: "video",
      mime: input.mime,
      sizeBytes: input.buffer.length,
      duration: input.duration,
      width: input.width,
      height: input.height,
      bytes: Uint8Array.from(input.buffer),
    },
    select: { id: true, mime: true, sizeBytes: true, duration: true, publicToken: true },
  });
}

/** Attach an uploaded video to a retail catalog item (replaces + deletes any previous one). */
export async function setRetailItemVideo(retailItemId: string, assetId: string | null) {
  const item = await prisma.retailCatalogItem.findUnique({
    where: { id: retailItemId },
    select: { id: true, videoAssetId: true },
  });
  if (!item) throw new AppError("المنتج غير موجود بالكتلوك", 404, "RETAIL_ITEM_NOT_FOUND");
  const oldAssetId = item.videoAssetId;
  await prisma.retailCatalogItem.update({ where: { id: retailItemId }, data: { videoAssetId: assetId } });
  if (oldAssetId && oldAssetId !== assetId) {
    await prisma.mediaAsset.delete({ where: { id: oldAssetId } }).catch(() => undefined);
  }
}

export async function getMediaAssetMetaByItem(retailItemId: string) {
  const item = await prisma.retailCatalogItem.findUnique({
    where: { id: retailItemId },
    select: { videoAsset: { select: { id: true, mime: true, sizeBytes: true, duration: true, publicToken: true } } },
  });
  return item?.videoAsset ?? null;
}

/** Public fetch by token — used by the /public/media route (Meta + browser playback). */
export async function getMediaAssetByToken(publicToken: string) {
  return prisma.mediaAsset.findUnique({ where: { publicToken } });
}

// ── Generic permanent image storage ──────────────────────────────────────────
// Used by «إنستغرام الجملة» so ad images (uploaded, or picked from a product's
// own gallery) live at a stable, unguessable public-token URL instead of a
// Data URL — the same publicMediaUrl()/media_assets store already used above
// for video, just permanent (no scheduled deletion) since these are the
// source of truth for a post's media plan, not an ephemeral publish-time copy.

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12MB — generous for a phone photo
const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];
// Instagram's own bounds: 4:5 (0.8) to 1.91:1 landscape.
const IG_MIN_RATIO = 0.8;
const IG_MAX_RATIO = 1.91;

/**
 * Re-encode an arbitrary image buffer to JPEG (center-cropped into Instagram's
 * aspect bounds only when out of range) and store it as a permanent MediaAsset.
 */
export async function saveImageAsset(input: { buffer: Buffer; mime: string }): Promise<{ id: string; url: string }> {
  if (!ALLOWED_IMAGE_MIMES.includes(input.mime)) {
    throw new AppError("صيغة الصورة غير مدعومة — المسموح JPG أو PNG أو WEBP", 400, "IMAGE_FORMAT_UNSUPPORTED");
  }
  if (input.buffer.length > MAX_IMAGE_BYTES) {
    throw new AppError("حجم الصورة يتجاوز الحد الأقصى 12 ميغابايت", 400, "IMAGE_TOO_LARGE");
  }
  let pipeline = sharp(input.buffer).rotate();
  const meta = await pipeline.metadata().catch(() => {
    throw new AppError("تعذر قراءة الصورة", 400, "IMAGE_UNREADABLE");
  });
  if (meta.width && meta.height) {
    const ratio = meta.width / meta.height;
    if (ratio < IG_MIN_RATIO) {
      pipeline = pipeline.resize({ width: meta.width, height: Math.round(meta.width / IG_MIN_RATIO), fit: "cover" });
    } else if (ratio > IG_MAX_RATIO) {
      pipeline = pipeline.resize({ width: Math.round(meta.height * IG_MAX_RATIO), height: meta.height, fit: "cover" });
    }
  }
  const jpeg = await pipeline.jpeg({ quality: 90 }).toBuffer();
  const asset = await prisma.mediaAsset.create({
    data: { kind: "image", mime: "image/jpeg", sizeBytes: jpeg.length, bytes: Uint8Array.from(jpeg) },
    select: { id: true, publicToken: true },
  });
  return { id: asset.id, url: publicMediaUrl(asset.publicToken) };
}

/** Same conversion, for a source already held as a `data:` URL (e.g. a product's own gallery image). */
export async function saveDataUrlAsImageAsset(dataUrl: string): Promise<{ id: string; url: string }> {
  const match = /^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new AppError("صيغة صورة غير صالحة", 400, "IMAGE_INVALID");
  return saveImageAsset({ mime: match[1], buffer: Buffer.from(match[2], "base64") });
}

/** Permanently delete a MediaAsset (used when an image is removed from a wholesale post). */
export async function deleteMediaAsset(id: string) {
  await prisma.mediaAsset.delete({ where: { id } }).catch(() => undefined);
}
