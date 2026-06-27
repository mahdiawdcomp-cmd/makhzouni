import { ProspectStatus } from "@prisma/client";
import { asyncHandler } from "../utils/async-handler";
import {
  clearConvertedProspects,
  convertProspect,
  deleteProspect,
  importProspects,
  importProspectsFromImages,
  listProspects,
} from "../services/prospect.service";

export const getProspects = asyncHandler(async (req, res) => {
  const statusRaw = String(req.query.status ?? "").toUpperCase();
  const status = statusRaw in ProspectStatus ? (statusRaw as ProspectStatus) : undefined;
  const search = req.query.search ? String(req.query.search) : undefined;
  const data = await listProspects({ status, search });
  res.json({ success: true, data });
});

export const postProspects = asyncHandler(async (req, res) => {
  const entries = Array.isArray(req.body?.prospects) ? req.body.prospects : [];
  const data = await importProspects(entries, "paste");
  res.status(201).json({ success: true, data });
});

export const postProspectsFromImages = asyncHandler(async (req, res) => {
  const images = Array.isArray(req.body?.images) ? req.body.images : [];
  const data = await importProspectsFromImages(images);
  res.status(201).json({ success: true, data });
});

export const postConvertProspect = asyncHandler(async (req, res) => {
  const data = await convertProspect(String(req.params.id), {
    name: String(req.body?.name ?? ""),
    address: req.body?.address ? String(req.body.address) : undefined,
  });
  res.json({ success: true, data });
});

export const removeProspect = asyncHandler(async (req, res) => {
  const data = await deleteProspect(String(req.params.id));
  res.json({ success: true, data });
});

export const clearConverted = asyncHandler(async (_req, res) => {
  const data = await clearConvertedProspects();
  res.json({ success: true, data });
});
