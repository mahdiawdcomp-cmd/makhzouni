import sharp from "sharp";
import prisma from "../config/database";
import { isGuestCatalogEnabled } from "../services/catalog.service";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";

async function assertPublicCatalog() {
  if (!await isGuestCatalogEnabled()) throw new AppError("Catalog is private", 404, "CATALOG_PRIVATE");
}
function productId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new AppError("Product not found", 404, "NOT_FOUND");
  return value;
}

export const getCatalogSeoProduct = asyncHandler(async (req, res) => {
  await assertPublicCatalog();
  const product = await prisma.product.findFirst({
    where: { id: productId(String(req.params.id)), deletedAt: null },
    // A public allowlist: NEVER include price, stock, supplier, costs or identity.
    select: { id: true, name: true, itemNumber: true, category: true, catalogDescription: true, updatedAt: true },
  });
  if (!product) throw new AppError("Product not found", 404, "NOT_FOUND");
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, data: { id: product.id, name: product.name, itemNumber: product.itemNumber, description: product.catalogDescription?.trim() || `${product.name}${product.category ? ` — ${product.category}` : ""}. شاهد تفاصيل المادة وخيارات الشراء في كتلوك المحل.`, updatedAt: product.updatedAt } });
});

export const getCatalogSeoIndex = asyncHandler(async (req, res) => {
  await assertPublicCatalog();
  const page = Number(req.query.page ?? 0);
  if (!Number.isInteger(page) || page < 0 || page > 100000) throw new AppError("Invalid sitemap page", 400, "INVALID_PAGE");
  const [rows, count] = await Promise.all([
    prisma.product.findMany({ where: { deletedAt: null }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" }, take: 1000, skip: page * 1000 }),
    prisma.product.count({ where: { deletedAt: null } }),
  ]);
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, data: { products: rows, pages: Math.ceil(count / 1000) } });
});

export const getCatalogSeoImage = asyncHandler(async (req, res) => {
  await assertPublicCatalog();
  const product = await prisma.product.findFirst({ where: { id: productId(String(req.params.id)), deletedAt: null }, select: { mediumUrl: true, thumbnailUrl: true, imageUrl: true } });
  if (!product) throw new AppError("Product not found", 404, "NOT_FOUND");
  const raw = product.mediumUrl || product.imageUrl || product.thumbnailUrl || "";
  // Only uploaded raster data. No remote fetches (SSRF), SVG scripts or credentials.
  const match = /^data:image\/(?:png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(raw);
  const bytes = match && match[1].length <= 20_000_000 ? Buffer.from(match[1], "base64") : null;
  const source = bytes ? sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize(1200, 630, { fit: "contain", background: "#ffffff" }) : sharp({ create: { width: 1200, height: 630, channels: 3, background: "#e2e8f0" } });
  const image = await source.jpeg({ quality: 82 }).toBuffer();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(image);
});
