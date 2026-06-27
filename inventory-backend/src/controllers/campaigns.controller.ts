import { CampaignStatus } from "@prisma/client";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  importRecipients,
  listCampaigns,
  removeRecipient,
  setCampaignStatus,
  updateCampaign,
} from "../services/campaign.service";

export const getCampaigns = asyncHandler(async (_req, res) => {
  const data = await listCampaigns();
  res.json({ success: true, data });
});

export const getCampaignById = asyncHandler(async (req, res) => {
  const data = await getCampaign(String(req.params.id));
  res.json({ success: true, data });
});

export const postCampaign = asyncHandler(async (req, res) => {
  const data = await createCampaign(req.body);
  res.status(201).json({ success: true, data });
});

export const putCampaign = asyncHandler(async (req, res) => {
  const data = await updateCampaign(String(req.params.id), req.body);
  res.json({ success: true, data });
});

export const removeCampaign = asyncHandler(async (req, res) => {
  const data = await deleteCampaign(String(req.params.id));
  res.json({ success: true, data });
});

export const patchCampaignStatus = asyncHandler(async (req, res) => {
  const status = String(req.body?.status ?? "").toUpperCase();
  if (!(status in CampaignStatus)) {
    throw new AppError("حالة غير صحيحة", 400, "CAMPAIGN_BAD_STATUS");
  }
  const data = await setCampaignStatus(String(req.params.id), status as CampaignStatus);
  res.json({ success: true, data });
});

export const postCampaignRecipients = asyncHandler(async (req, res) => {
  const entries = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
  const data = await importRecipients(String(req.params.id), entries);
  res.status(201).json({ success: true, data });
});

export const deleteCampaignRecipient = asyncHandler(async (req, res) => {
  const data = await removeRecipient(String(req.params.id), String(req.params.recipientId));
  res.json({ success: true, data });
});
