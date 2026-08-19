import { asyncHandler } from "../utils/async-handler";
import {
  listOptOuts,
  optOutOfMarketing,
  resumeMarketing,
} from "../services/marketing-opt-out.service";

export const listOptOutsCtrl = asyncHandler(async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const data = await listOptOuts(search);
  res.json({ success: true, data });
});

/** Stop marketing to a number by hand (e.g. the customer asked by phone). */
export const addOptOutCtrl = asyncHandler(async (req, res) => {
  const { phone, reason } = req.body as { phone: string; reason?: string };
  const data = await optOutOfMarketing(phone, { reason, source: "ADMIN" });
  res.status(201).json({ success: true, message: "تم إيقاف الرسائل الإعلانية عن هذا الرقم", data });
});

export const resumeMarketingCtrl = asyncHandler(async (req, res) => {
  const { phone } = req.body as { phone: string };
  const data = await resumeMarketing(phone);
  res.json({ success: true, message: "تم استئناف الرسائل الإعلانية", data });
});
