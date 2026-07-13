import prisma from "../config/database";
import { AppError } from "../utils/app-error";

// Video assets for «كتلوك المفرد» (one video per product, locked decision).
// Bytes live in Postgres because Railway app disks are ephemeral; Meta and the
// browser fetch them through a tokenized public URL (see public.routes.ts).

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB (locked decision)
export const MAX_VIDEO_SECONDS = 40; // < 40s (locked decision)
export const ALLOWED_VIDEO_MIMES = ["video/mp4", "video/quicktime"];

export function publicMediaUrl(publicToken: string): string {
  const base = (process.env.BACKEND_PUBLIC_URL?.trim() || "https://api.mazbwoni.com").replace(/\/$/, "");
  return `${base}/public/media/${publicToken}`;
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
