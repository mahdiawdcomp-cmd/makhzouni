import { UserRole } from "@prisma/client";
import { asyncHandler } from "../utils/async-handler";
import { getSettings, updateSettings } from "../services/settings.service";
import { runWeeklyBackup, runDailySummaryJob } from "../services/notification-jobs.service";
import { generateFullBackup, generateChangesSince, sendBackupToTelegram } from "../services/backup.service";
import { recordBackupEvent } from "../services/backup-status.service";
import {
  wipeOperationalData,
  mergeWarehouses,
  WIPE_CONFIRM_PHRASE,
} from "../services/danger.service";
import { AppError } from "../utils/app-error";

// GET /settings is readable by every authenticated user because the Sidebar and
// most pages need storeName / currency / logo / feature flags. It must therefore
// never hand out credentials: with the Meta Cloud token a cashier can send
// WhatsApp as the business from outside the app entirely, and with the app
// secret they can forge the inbound webhook.
//
// Matching by name (not by an explicit allowlist) is deliberate — a new
// credential field added later is masked automatically instead of silently
// leaking until someone remembers to update a list.
const SECRET_KEY_PATTERN = /token|secret|password|apikey|api_key|credential/i;

function redactSecretsForNonAdmin(settings: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    safe[key] = SECRET_KEY_PATTERN.test(key) && typeof value === "string" ? "" : value;
  }
  return safe;
}

export const getAllSettings = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const isAdmin = req.user?.role === UserRole.ADMIN;

  res.json({
    success: true,
    data: isAdmin
      ? settings
      : redactSecretsForNonAdmin(settings as unknown as Record<string, unknown>),
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
  const t0 = Date.now();
  try {
    const counts = await runWeeklyBackup();
    void recordBackupEvent({ kind: "manual", ok: true, durationMs: Date.now() - t0 });
    res.json({ success: true, message: "تم إنشاء النسخة الاحتياطية بنجاح", data: counts });
  } catch (err) {
    void recordBackupEvent({ kind: "manual", ok: false, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
});

export const triggerDailySummary = asyncHandler(async (_req, res) => {
  const result = await runDailySummaryJob(true);
  res.json({ success: true, message: "تم إرسال الملخص اليومي", data: result });
});

/** GET /api/settings/backup/download — streams full DB export as JSON file.
 *  Access is gated by allowBackupAccess (settings.routes.ts): a matching
 *  ?secret=BACKUP_SECRET OR an authenticated admin session.
 */
export const downloadBackup = asyncHandler(async (req, res) => {
  // lean=1 strips base64 images from audit-log snapshots (export only).
  // Default (no flag) preserves the exact previous behaviour.
  const lean = String(req.query.lean ?? "") === "1";
  const t0 = Date.now();
  let backup;
  try {
    backup = await generateFullBackup(lean);
  } catch (err) {
    void recordBackupEvent({ kind: "download", ok: false, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  const json = JSON.stringify(backup, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `makhzouni-backup-${date}.json`;
  const sizeBytes = Buffer.byteLength(json, "utf-8");
  const sizeKb = (sizeBytes / 1024).toFixed(0);

  console.log(
    `[backup] full export — lean=${lean} size=${sizeKb}KB auditLogs=${backup.meta.auditLogsExported}/${backup.meta.auditLogsTotal} base64Stripped=${lean}`,
  );
  void recordBackupEvent({ kind: "download", ok: true, sizeBytes, durationMs: Date.now() - t0 });

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", sizeBytes);
  res.send(json);
});

/** GET /api/settings/backup/changes?since=ISO — streams ONLY records changed
 *  after `since` as a JSON file. For the experimental incremental backup system.
 *  Same auth as downloadBackup (allowBackupAccess in settings.routes.ts).
 */
export const downloadChanges = asyncHandler(async (req, res) => {
  const sinceRaw = String(req.query.since ?? "");
  const since = new Date(sinceRaw);
  if (!sinceRaw || Number.isNaN(since.getTime())) {
    res.status(400).json({ success: false, message: "Query param 'since' must be a valid ISO date" });
    return;
  }

  const lean = String(req.query.lean ?? "") === "1";
  const t0 = Date.now();
  let changes;
  try {
    changes = await generateChangesSince(since, lean);
  } catch (err) {
    void recordBackupEvent({ kind: "changes", ok: false, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  const json = JSON.stringify(changes, null, 2);
  void recordBackupEvent({ kind: "changes", ok: true, sizeBytes: Buffer.byteLength(json, "utf-8"), durationMs: Date.now() - t0 });
  const date = new Date().toISOString().slice(0, 10);
  const filename = `makhzouni-changes-${date}.json`;

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

  const t0 = Date.now();
  let json: string;
  let backup;
  const date = new Date().toISOString().slice(0, 10);
  const filename = `makhzouni-backup-${date}.json`;
  try {
    backup = await generateFullBackup();
    json = JSON.stringify(backup, null, 2);
    await sendBackupToTelegram(telegramBotToken, telegramChatId, json, filename);
  } catch (err) {
    void recordBackupEvent({ kind: "telegram", ok: false, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  void recordBackupEvent({ kind: "telegram", ok: true, sizeBytes: Buffer.byteLength(json, "utf-8"), durationMs: Date.now() - t0 });

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

