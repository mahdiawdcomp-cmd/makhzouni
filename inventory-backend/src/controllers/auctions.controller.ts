import { AppError } from "../utils/app-error";
import { asyncHandler } from "../utils/async-handler";
import {
  acknowledgeAuction,
  cancelAuction,
  createAuction,
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
