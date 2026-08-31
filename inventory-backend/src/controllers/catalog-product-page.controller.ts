import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  addProductCatalogImage,
  deleteCatalogReview,
  deleteProductCatalogImage,
  getGuestGalleryImage,
  getGuestProductDetail,
  getMyProductReview,
  getProductCatalogContent,
  getPublicGalleryImage,
  getPublicProductDetail,
  getCatalogThumbnails,
  listCatalogReviews,
  setCatalogReviewStatus,
  submitProductReview,
  updateProductCatalogContent,
} from "../services/catalog-product-page.service";

/* ── Public: product page ────────────────────────────────────────── */

export const getProductDetailCtrl = asyncHandler(async (req, res) => {
  const productId = String(req.params.id);
  const token = String(req.query.access ?? "");
  // No token → guest mode. The service refuses when guest browsing is off, so
  // a missing token can never widen access beyond what the shop allows.
  const data = token
    ? await getPublicProductDetail(token, productId)
    : await getGuestProductDetail(productId, String(req.query.visitor ?? ""));
  res.json({ success: true, data });
});

export const getGalleryImageCtrl = asyncHandler(async (req, res) => {
  const productId = String(req.params.id);
  const imageId = String(req.params.imageId);
  const token = String(req.query.access ?? "");
  const imageUrl = token
    ? await getPublicGalleryImage(token, productId, imageId)
    : await getGuestGalleryImage(productId, imageId, String(req.query.visitor ?? ""));
  res.json({ success: true, data: { imageUrl } });
});

export const getThumbnailsCtrl = asyncHandler(async (req, res) => {
  const token = String(req.query.access ?? "");
  const { ids } = req.body as { ids: string[] };
  const data = await getCatalogThumbnails(token, ids ?? [], String(req.query.visitor ?? ""));
  res.json({ success: true, data });
});

export const submitProductReviewCtrl = asyncHandler(async (req, res) => {
  const token = String(req.query.access ?? "");
  if (!token) {
    throw new AppError("التقييم متاح لزبائن الجملة فقط", 403, "REVIEW_REQUIRES_ACCESS");
  }
  const { rating, comment } = req.body as { rating: number; comment?: string };
  const review = await submitProductReview(token, String(req.params.id), { rating, comment });
  res.status(201).json({
    success: true,
    message: "تم إرسال تقييمك — سيظهر بعد مراجعة الإدارة",
    data: review,
  });
});

export const getMyProductReviewCtrl = asyncHandler(async (req, res) => {
  const token = String(req.query.access ?? "");
  if (!token) {
    res.json({ success: true, data: null });
    return;
  }
  const review = await getMyProductReview(token, String(req.params.id));
  res.json({ success: true, data: review });
});

/* ── Admin: storefront content ───────────────────────────────────── */

export const getProductContentCtrl = asyncHandler(async (req, res) => {
  const data = await getProductCatalogContent(String(req.params.id));
  res.json({ success: true, data });
});

export const updateProductContentCtrl = asyncHandler(async (req, res) => {
  const { description, specs, offerEndsAt } = req.body as {
    description?: string; specs?: unknown; offerEndsAt?: string;
  };
  const data = await updateProductCatalogContent(String(req.params.id), { description, specs, offerEndsAt });
  res.json({ success: true, data });
});

export const addProductImageCtrl = asyncHandler(async (req, res) => {
  const { url, thumbnailUrl } = req.body as { url: string; thumbnailUrl?: string };
  const data = await addProductCatalogImage(String(req.params.id), { url, thumbnailUrl });
  res.status(201).json({ success: true, data });
});

export const deleteProductImageCtrl = asyncHandler(async (req, res) => {
  await deleteProductCatalogImage(String(req.params.id), String(req.params.imageId));
  res.json({ success: true, message: "تم حذف الصورة" });
});

/* ── Admin: review moderation ────────────────────────────────────── */

export const listReviewsCtrl = asyncHandler(async (req, res) => {
  const raw = String(req.query.status ?? "");
  const status =
    raw === "PENDING" || raw === "APPROVED" || raw === "REJECTED" ? raw : undefined;
  const data = await listCatalogReviews(status);
  res.json({ success: true, data });
});

export const setReviewStatusCtrl = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication required", 401, "AUTH_REQUIRED");
  const { status } = req.body as { status: "APPROVED" | "REJECTED" };
  if (status !== "APPROVED" && status !== "REJECTED") {
    throw new AppError("Invalid review status", 400, "INVALID_REVIEW_STATUS");
  }
  const data = await setCatalogReviewStatus(String(req.params.id), status, req.user.id);
  res.json({ success: true, data });
});

export const deleteReviewCtrl = asyncHandler(async (req, res) => {
  await deleteCatalogReview(String(req.params.id));
  res.json({ success: true, message: "تم حذف التقييم" });
});

/** The two storefront rows as one list, instead of one product form at a time. */
export const merchandisedProductsCtrl = asyncHandler(async (_req, res) => {
  const { listMerchandisedProducts } = await import("../services/catalog-product-page.service");
  res.json({ success: true, data: await listMerchandisedProducts() });
});

export const setMerchandisingCtrl = asyncHandler(async (req, res) => {
  const { setProductMerchandising } = await import("../services/catalog-product-page.service");
  const body = (req.body ?? {}) as {
    isOffer?: boolean; isNewArrival?: boolean; oldPrice?: number | null; offerEndsAt?: string | null;
  };
  const data = await setProductMerchandising(String(req.params.id), body, req.user!.id);
  res.json({ success: true, data });
});
