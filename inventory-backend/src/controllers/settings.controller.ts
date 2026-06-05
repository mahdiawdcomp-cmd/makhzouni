import { asyncHandler } from "../utils/async-handler";
import { getSettings, updateSettings } from "../services/settings.service";
import { runWeeklyBackup, runDailySummaryJob } from "../services/notification-jobs.service";

export const getAllSettings = asyncHandler(async (_req, res) => {
  const settings = await getSettings();

  res.json({
    success: true,
    data: settings,
  });
});

export const updateAppSettings = asyncHandler(async (req, res) => {
  const settings = await updateSettings(req.body);

  res.json({
    success: true,
    message: "Settings updated successfully",
    data: settings,
  });
});

export const triggerManualBackup = asyncHandler(async (_req, res) => {
  const counts = await runWeeklyBackup();
  res.json({ success: true, message: "تم إنشاء النسخة الاحتياطية بنجاح", data: counts });
});

export const triggerDailySummary = asyncHandler(async (_req, res) => {
  const result = await runDailySummaryJob();
  res.json({ success: true, message: "تم إرسال الملخص اليومي", data: result });
});
