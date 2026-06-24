import sharp from "sharp";

// Max dimension (px) of the generated thumbnail. 200×200 keeps list payloads
// tiny (~6–12 KB JPEG each) while still looking sharp in the product table.
const THUMB_SIZE = 200;
const THUMB_QUALITY = 70;

/**
 * Turn a base64 data-URL (or null) into a small JPEG thumbnail data-URL.
 * Returns null when there's no image or when the input can't be decoded —
 * the caller should fall back to the full image in that case.
 */
export async function makeThumbnail(imageUrl: string | null | undefined): Promise<string | null> {
  if (!imageUrl) return null;
  // Only data-URLs are stored inline; external http(s) URLs are passed through.
  const match = /^data:(image\/[\w.+-]+);base64,(.+)$/i.exec(imageUrl.trim());
  if (!match) return null;

  try {
    const buffer = Buffer.from(match[2], "base64");
    const out = await sharp(buffer)
      .rotate() // respect EXIF orientation
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    // Corrupt / unsupported image — let the caller keep the original.
    return null;
  }
}
