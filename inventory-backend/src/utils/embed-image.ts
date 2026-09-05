// ── Turn an image reference into something a rasteriser can actually draw ────
// Invoice images (the shop logo, product photos) are rendered offline by
// sharp/librsvg, which cannot follow an http(s) URL. Anything that is already a
// data: URI passes through; a remote URL is fetched once and inlined.
//
// Historically the renderers just dropped every non-data URL, which is why the
// "invoice with pictures" arrived at the customer as a grid of grey
// placeholders on any shop that stores its images as URLs.

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 4 * 1024 * 1024;

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);

// Only outward-facing hosts. The image URLs come from shop settings and product
// records, so this is a guard against a mistyped/hostile value pulling on
// something inside the deployment network, not a user-facing feature.
function isPublicHttpUrl(raw: string): URL | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return null;
  if (/^(127\.|10\.|169\.254\.|192\.168\.|0\.)/.test(host)) return null;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
  if (host === "::1" || host === "[::1]") return null;
  return url;
}

/**
 * Resolve an image reference to a data: URI, or null when it cannot be embedded.
 * Never throws — a missing picture must not fail a whole invoice.
 */
export async function embedImage(source: string | null | undefined): Promise<string | null> {
  if (!source) return null;
  const value = String(source).trim();
  if (!value) return null;
  if (/^data:image\//i.test(value)) return value;

  const url = isPublicHttpUrl(value);
  if (!url) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) return null;

    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (contentType && !ALLOWED_TYPES.has(contentType)) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_BYTES) return null;

    const mime = ALLOWED_TYPES.has(contentType) ? contentType : "image/png";
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}
