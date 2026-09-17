import { AppError } from "../utils/app-error";
import { asyncHandler } from "../utils/async-handler";
import {
  acknowledgeAuction,
  cancelAuction,
  createAuction,
  getAuctionImage,
  getPublicAuction,
  listAuctions,
  listUnacknowledgedResults,
  placeBid,
  type AuctionStatus,
  type CreateAuctionInput,
  type PlaceBidInput,
} from "../services/auction.service";

export const listAuctionsHandler = asyncHandler(async (req, res) => {
  const status = (req.validatedQuery as { status?: AuctionStatus } | undefined)?.status;
  res.json({ success: true, data: await listAuctions({ status }) });
});

export const auctionResultsHandler = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listUnacknowledgedResults() });
});

export const createAuctionHandler = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  const data = await createAuction(req.body as CreateAuctionInput, req.user.id);
  res.status(201).json({ success: true, data });
});

export const cancelAuctionHandler = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await cancelAuction(String(req.params.id)) });
});

export const acknowledgeAuctionHandler = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await acknowledgeAuction(String(req.params.id)) });
});

export const publicAuctionHandler = asyncHandler(async (req, res) => {
  const phone = typeof req.query.phone === "string" ? req.query.phone : undefined;
  res.json({ success: true, data: await getPublicAuction(String(req.params.token), phone) });
});

export const publicBidHandler = asyncHandler(async (req, res) => {
  const data = await placeBid(String(req.params.token), req.body as PlaceBidInput);
  res.json({ success: true, data });
});

export const publicAuctionImageHandler = asyncHandler(async (req, res) => {
  const image = await getAuctionImage(String(req.params.token));
  if (!image) throw new AppError("لا توجد صورة", 404, "AUCTION_IMAGE_NOT_FOUND");
  if (image.kind === "redirect") {
    res.redirect(302, image.url);
    return;
  }
  // The product photo can be replaced, so cache for a while, not forever.
  res.setHeader("Cache-Control", "public, max-age=600");
  res.setHeader("Content-Type", image.contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  // helmet defaults to same-origin, which blocks this <img> outright: the shop
  // page (mahdi.mazbwoni.com) and the API (api.mazbwoni.com) are different
  // origins. The photo is public by design, so allow it here only.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.send(image.body);
});
