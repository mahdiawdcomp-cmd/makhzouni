import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { totalStock } from "../utils/product-stock";
import { getCatalogAccess, isGuestCatalogEnabled } from "./catalog.service";

/* ══════════════════════════════════════════════════════════════════════
   PRODUCT PAGE — storefront content, gallery and reviews for the
   wholesale catalog. Split out of catalog.service.ts, which is already
   ~1400 lines of ordering/access logic this has nothing to do with.
══════════════════════════════════════════════════════════════════════ */

type SpecRow = { label: string; value: string };

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

async function assertGuestCatalogEnabled() {
  if (!(await isGuestCatalogEnabled())) {
    throw new AppError("الدخول المفتوح للكتالوج غير مفعّل", 403, "GUEST_CATALOG_DISABLED");
  }
}

/** catalogSpecs is free-form Json; keep only well-shaped, non-empty rows. */
export function parseSpecs(value: unknown): SpecRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map((row) => ({
      label: String(row.label ?? "").trim().slice(0, 60),
      value: String(row.value ?? "").trim().slice(0, 200),
    }))
    .filter((row) => row.label && row.value)
    .slice(0, 30);
}

async function reviewSummary(productId: string) {
  const approved = await prisma.catalogProductReview.findMany({
    where: { productId, status: "APPROVED" },
    orderBy: { reviewedAt: "desc" },
    take: 30,
    select: {
      id: true,
      rating: true,
      comment: true,
      createdAt: true,
      customer: { select: { name: true } },
    },
  });
  const count = approved.length;
  const average = count ? approved.reduce((sum, r) => sum + r.rating, 0) / count : null;
  return {
    average: average === null ? null : Math.round(average * 10) / 10,
    count,
    // Only the display name reaches the storefront — never the phone.
    items: approved.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      authorName: r.customer?.name ?? "زبون",
    })),
  };
}

/**
 * Product page payload. `allowPrices` mirrors the caller's own access level,
 * so a guest gets the same page with prices withheld rather than a different
 * one. Gallery entries carry thumbnails only — full images load on tap, the
 * same way the product grid already works.
 */
async function buildProductDetail(
  productId: string,
  opts: { allowPrices: boolean; showStock: boolean },
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    omit: { imageUrl: true },
    include: {
      warehouseStocks: { select: { quantityPieces: true } },
      catalogImages: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, thumbnailUrl: true, sortOrder: true },
      },
    },
  });
  if (!product) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");

  const reviews = await reviewSummary(product.id);

  // "Related" = same category, still orderable, excluding this product.
  // Deliberately simple: a shop owner can explain why a product showed up.
  const relatedRaw = await prisma.product.findMany({
    where: {
      deletedAt: null,
      id: { not: product.id },
      ...(product.category ? { category: product.category } : {}),
    },
    omit: { imageUrl: true },
    include: { warehouseStocks: { select: { quantityPieces: true } } },
    take: 24,
  });
  const related = relatedRaw
    .map((p) => ({
      id: p.id,
      name: p.name,
      itemNumber: p.itemNumber,
      thumbnailUrl: p.thumbnailUrl,
      salePrice: opts.allowPrices ? toNumber(p.salePrice) : null,
      pcsPerCarton: p.pcsPerCarton,
      currentStock: totalStock(p),
    }))
    .filter((p) => p.pcsPerCarton >= 1 && p.currentStock >= p.pcsPerCarton)
    .slice(0, 8);

  return {
    id: product.id,
    itemNumber: product.itemNumber,
    name: product.name,
    thumbnailUrl: product.thumbnailUrl,
    category: product.category,
    categoryTags: product.categoryTags,
    typeTags: product.typeTags,
    isNewArrival: product.isNewArrival,
    isOffer: product.isOffer,
    oldPrice: opts.allowPrices && product.oldPrice !== null ? toNumber(product.oldPrice) : null,
    offerEndsAt: product.offerEndsAt,
    salePrice: opts.allowPrices ? toNumber(product.salePrice) : null,
    pcsPerCarton: product.pcsPerCarton,
    boxPieces: product.boxPieces,
    hiddenUnits: product.hiddenUnits,
    currentStock: totalStock(product),
    showStock: opts.showStock,
    description: product.catalogDescription ?? "",
    specs: parseSpecs(product.catalogSpecs),
    gallery: product.catalogImages.map((img) => ({ id: img.id, thumbnailUrl: img.thumbnailUrl })),
    reviews,
    related,
    createdAt: product.createdAt,
  };
}

export async function getPublicProductDetail(token: string, productId: string) {
  const access = await getCatalogAccess(token);
  return buildProductDetail(productId, {
    allowPrices: access.allowPrices,
    showStock: access.showStock,
  });
}

export async function getGuestProductDetail(productId: string) {
  await assertGuestCatalogEnabled();
  // Guests never see prices — same rule as the guest product list.
  return buildProductDetail(productId, { allowPrices: false, showStock: true });
}

/** Full-resolution gallery image, fetched when the shopper taps a thumbnail. */
export async function getPublicGalleryImage(token: string, productId: string, imageId: string) {
  await getCatalogAccess(token);
  const image = await prisma.productCatalogImage.findFirst({
    where: { id: imageId, productId },
    select: { url: true },
  });
  return image?.url ?? null;
}

export async function getGuestGalleryImage(productId: string, imageId: string) {
  await assertGuestCatalogEnabled();
  const image = await prisma.productCatalogImage.findFirst({
    where: { id: imageId, productId },
    select: { url: true },
  });
  return image?.url ?? null;
}

/**
 * Submit or revise a review. Wholesale customers only: the catalog token
 * identifies the customer, so there is no name or phone for a caller to
 * spoof. A revision drops back to PENDING — approved text must never change
 * after the fact without another look.
 */
export async function submitProductReview(
  token: string,
  productId: string,
  input: { rating: number; comment?: string },
) {
  const access = await getCatalogAccess(token);
  const rating = Math.round(Number(input.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw new AppError("التقييم يجب أن يكون بين 1 و 5", 400, "REVIEW_RATING_INVALID");
  }
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true },
  });
  if (!product) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");

  const comment = input.comment?.trim().slice(0, 1000) || null;
  return prisma.catalogProductReview.upsert({
    where: { productId_customerId: { productId, customerId: access.customer.id } },
    update: { rating, comment, status: "PENDING", reviewedAt: null, reviewedBy: null },
    create: { productId, customerId: access.customer.id, rating, comment },
    select: { id: true, status: true },
  });
}

/** The caller's own review, so the form can show what they already sent. */
export async function getMyProductReview(token: string, productId: string) {
  const access = await getCatalogAccess(token);
  return prisma.catalogProductReview.findUnique({
    where: { productId_customerId: { productId, customerId: access.customer.id } },
    select: { id: true, rating: true, comment: true, status: true, createdAt: true },
  });
}

/* ── Admin: storefront content ───────────────────────────────────── */

export async function getProductCatalogContent(productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: {
      id: true,
      name: true,
      itemNumber: true,
      thumbnailUrl: true,
      catalogDescription: true,
      catalogSpecs: true,
      isOffer: true,
      offerEndsAt: true,
      catalogImages: {
        orderBy: { sortOrder: "asc" },
        select: { id: true, thumbnailUrl: true, sortOrder: true },
      },
    },
  });
  if (!product) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
  return {
    id: product.id,
    name: product.name,
    itemNumber: product.itemNumber,
    thumbnailUrl: product.thumbnailUrl,
    description: product.catalogDescription ?? "",
    specs: parseSpecs(product.catalogSpecs),
    gallery: product.catalogImages,
    isOffer: product.isOffer,
    offerEndsAt: product.offerEndsAt,
  };
}

export async function updateProductCatalogContent(
  productId: string,
  input: { description?: string; specs?: unknown; offerEndsAt?: string | null },
) {
  const data: {
    catalogDescription?: string | null;
    catalogSpecs?: SpecRow[];
    offerEndsAt?: Date | null;
  } = {};
  if (input.description !== undefined) data.catalogDescription = input.description.trim() || null;
  if (input.specs !== undefined) data.catalogSpecs = parseSpecs(input.specs);
  if (input.offerEndsAt !== undefined) {
    // "" clears the deadline; an unparseable value is ignored rather than
    // silently wiping a date the shop already set.
    const parsed = input.offerEndsAt ? new Date(input.offerEndsAt) : null;
    if (parsed === null || !Number.isNaN(parsed.getTime())) data.offerEndsAt = parsed;
  }
  await prisma.product.update({ where: { id: productId }, data });
  return getProductCatalogContent(productId);
}

// Bounded so one product cannot bloat the table (and every backup) unchecked —
// these rows hold full data-URI images.
const MAX_GALLERY_IMAGES = 8;

export async function addProductCatalogImage(
  productId: string,
  input: { url: string; thumbnailUrl?: string | null },
) {
  if (!input.url?.trim()) throw new AppError("الصورة مطلوبة", 400, "IMAGE_REQUIRED");
  const count = await prisma.productCatalogImage.count({ where: { productId } });
  if (count >= MAX_GALLERY_IMAGES) {
    throw new AppError(`الحد الأقصى ${MAX_GALLERY_IMAGES} صور للمنتج`, 400, "GALLERY_LIMIT");
  }
  return prisma.productCatalogImage.create({
    data: {
      productId,
      url: input.url,
      thumbnailUrl: input.thumbnailUrl ?? null,
      sortOrder: count,
    },
    select: { id: true, thumbnailUrl: true, sortOrder: true },
  });
}

export async function deleteProductCatalogImage(productId: string, imageId: string) {
  await prisma.productCatalogImage.deleteMany({ where: { id: imageId, productId } });
  // Close the gap so sortOrder stays 0..n-1 and "add" keeps appending cleanly.
  const rest = await prisma.productCatalogImage.findMany({
    where: { productId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  await prisma.$transaction(
    rest.map((img, i) =>
      prisma.productCatalogImage.update({ where: { id: img.id }, data: { sortOrder: i } }),
    ),
  );
  return { ok: true };
}

/* ── Admin: review moderation ────────────────────────────────────── */

export async function listCatalogReviews(status?: "PENDING" | "APPROVED" | "REJECTED") {
  return prisma.catalogProductReview.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      rating: true,
      comment: true,
      status: true,
      createdAt: true,
      reviewedAt: true,
      product: { select: { id: true, name: true, itemNumber: true, thumbnailUrl: true } },
      customer: { select: { id: true, name: true, phone: true } },
    },
  });
}

export async function setCatalogReviewStatus(
  id: string,
  status: "APPROVED" | "REJECTED",
  userId: string,
) {
  return prisma.catalogProductReview.update({
    where: { id },
    data: { status, reviewedAt: new Date(), reviewedBy: userId },
    select: { id: true, status: true },
  });
}

export async function deleteCatalogReview(id: string) {
  await prisma.catalogProductReview.delete({ where: { id } });
  return { ok: true };
}

export async function countPendingCatalogReviews() {
  return prisma.catalogProductReview.count({ where: { status: "PENDING" } });
}
