import { ErrorLogSource } from "@prisma/client";
import { asyncHandler } from "../utils/async-handler";
import { listErrorLogs, resolveErrorLog } from "../services/error-log.service";
import {
  analyzeErrorLog,
  analyzeHealthComponent,
  isAiEnabled,
  isHealthComponent,
} from "../services/error-analysis.service";
import { AppError } from "../utils/app-error";

export const getErrorLogs = asyncHandler(async (req, res) => {
  const sourceRaw = typeof req.query.source === "string" ? req.query.source.toUpperCase() : undefined;
  const source = sourceRaw && sourceRaw in ErrorLogSource ? (sourceRaw as ErrorLogSource) : undefined;
  const includeResolved = req.query.includeResolved === "true";
  const data = await listErrorLogs({ source, includeResolved });
  res.json({ success: true, data, aiEnabled: isAiEnabled() });
});

export const patchResolveErrorLog = asyncHandler(async (req, res) => {
  const data = await resolveErrorLog(String(req.params.id));
  res.json({ success: true, data });
});

export const postAnalyzeErrorLog = asyncHandler(async (req, res) => {
  const data = await analyzeErrorLog(String(req.params.id));
  res.json({ success: true, data });
});

export const postAnalyzeHealth = asyncHandler(async (req, res) => {
  const component = String(req.body?.component ?? "");
  if (!isHealthComponent(component)) {
    throw new AppError("مكوّن غير معروف", 400, "UNKNOWN_HEALTH_COMPONENT");
  }
  const data = await analyzeHealthComponent(component);
  res.json({ success: true, data });
});
