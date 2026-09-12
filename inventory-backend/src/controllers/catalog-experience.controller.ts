import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import { catalogFunnelReport, catalogPurchaseHistory, isSessionId, recordFunnelStage } from "../services/catalog-experience.service";

export const postCatalogFunnel = asyncHandler(async (req, res) => {
  const stages = ["OPEN", "VIEW", "ADD", "CHECKOUT"];
  const stage = stages.indexOf(req.body?.stage);
  if (!isSessionId(req.body?.sessionId) || stage < 0) throw new AppError("Invalid catalog event", 400, "INVALID_EVENT");
  await recordFunnelStage(req.body.sessionId, stage);
  res.status(204).end();
});
export const getCatalogFunnel = asyncHandler(async (req, res) => {
  const days = Number(req.query.days ?? 30);
  if (![7, 30, 90].includes(days)) throw new AppError("Invalid period", 400, "INVALID_PERIOD");
  res.json({ success: true, data: await catalogFunnelReport(days) });
});
export const getCatalogPurchaseHistory = asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ success: true, data: await catalogPurchaseHistory(String(req.query.access ?? ""), String(req.query.visitor ?? "")) });
});
