import { asyncHandler } from "../utils/async-handler";
import { getSettings, updateSettings } from "../services/settings.service";
import { runWeeklyBackup, runDailySummaryJob } from "../services/notification-jobs.service";
import { generateFullBackup, sendBackupToTelegram } from "../services/backup.service";
import {
  wipeOperationalData,
  mergeWarehouses,
  WIPE_CONFIRM_PHRASE,
} from "../services/danger.service";
import { AppError } from "../utils/app-error";

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
  const result = await runDailySummaryJob(true);
  res.json({ success: true, message: "تم إرسال الملخص اليومي", data: result });
});

/** GET /api/settings/backup/download — streams full DB export as JSON file */
export const downloadBackup = asyncHandler(async (_req, res) => {
  const backup = await generateFullBackup();
  const json = JSON.stringify(backup, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `makhzouni-backup-${date}.json`;

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", Buffer.byteLength(json, "utf-8"));
  res.send(json);
});

/** POST /api/settings/backup/telegram — generates backup and sends it to Telegram */
export const sendTelegramBackup = asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  const { telegramBotToken, telegramChatId } = settings;

  if (!telegramBotToken || !telegramChatId) {
    throw new AppError("Telegram bot token and chat ID are required. Configure them in Settings → النسخ الاحتياطي.", 400, "TELEGRAM_NOT_CONFIGURED");
  }

  const backup = await generateFullBackup();
  const json = JSON.stringify(backup, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `makhzouni-backup-${date}.json`;

  await sendBackupToTelegram(telegramBotToken, telegramChatId, json, filename);

  res.json({
    success: true,
    message: `✓ تم إرسال النسخة الاحتياطية إلى تيليغرام (${filename})`,
    data: backup.counts,
  });
});

/**
 * POST /api/settings/danger/wipe-operational
 * Permanently deletes all operational data (products, invoices, vouchers, …),
 * keeping customers, user logins, settings and warehouses. Requires the exact
 * confirmation phrase in the body.
 */
export const wipeOperational = asyncHandler(async (req, res) => {
  const { confirm } = req.body ?? {};
  const result = await wipeOperationalData(String(confirm ?? ""));
  res.json({
    success: true,
    message: "✓ تم مسح البيانات التشغيلية. الزبائن وحسابات الدخول والإعدادات والمخازن محفوظة.",
    data: result,
  });
});

/**
 * POST /api/settings/danger/merge-warehouses
 * Collapses warehouses down to one renamed main branch + explicitly-kept branches.
 */
export const mergeWarehousesHandler = asyncHandler(async (req, res) => {
  const { mainBranchId, mainName, keepBranchIds } = req.body ?? {};

  if (!mainBranchId || !mainName) {
    throw new AppError("المخزن الرئيسي واسمه مطلوبان", 400, "MERGE_INVALID_INPUT");
  }

  const result = await mergeWarehouses({
    mainBranchId: String(mainBranchId),
    mainName: String(mainName),
    keepBranchIds: Array.isArray(keepBranchIds) ? keepBranchIds.map(String) : [],
  });

  res.json({
    success: true,
    message: `✓ تم تنظيم المخازن. المخزن الرئيسي: «${result.mainBranch.name}».`,
    data: result,
  });
});

/** GET /api/settings/danger/info — exposes the confirmation phrase for the UI. */
export const getDangerInfo = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { wipeConfirmPhrase: WIPE_CONFIRM_PHRASE } });
});

