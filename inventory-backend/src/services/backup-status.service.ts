import { ErrorLogSource } from "@prisma/client";
import prisma from "../config/database";
import { logger } from "../utils/logger";
import { recordError } from "./error-log.service";

// Tracks the outcome of every backup served/produced by THIS server
// (download, incremental changes, telegram, manual). Read-only observer:
// it never alters the backup flow itself. Persisted as a Setting row so it
// survives restarts; keys starting with "_" are internal and filtered out of
// the public settings payload.

const STATUS_KEY = "_backupStatus";

export type BackupKind = "download" | "changes" | "telegram" | "manual";

export type BackupStatus = {
  lastAttemptAt: string | null;
  lastKind: BackupKind | null;
  lastOk: boolean | null;
  lastError: string | null;
  lastSuccessAt: string | null;
  lastSuccessKind: BackupKind | null;
  lastSuccessSizeBytes: number | null;
  lastSuccessDurationMs: number | null;
};

const EMPTY: BackupStatus = {
  lastAttemptAt: null,
  lastKind: null,
  lastOk: null,
  lastError: null,
  lastSuccessAt: null,
  lastSuccessKind: null,
  lastSuccessSizeBytes: null,
  lastSuccessDurationMs: null,
};

let _memory: BackupStatus | null = null;

export async function getBackupStatus(): Promise<BackupStatus> {
  if (_memory) return _memory;
  try {
    const row = await prisma.setting.findUnique({ where: { key: STATUS_KEY } });
    _memory = row ? { ...EMPTY, ...(row.value as Partial<BackupStatus>) } : { ...EMPTY };
  } catch {
    _memory = { ...EMPTY };
  }
  return _memory;
}

export type BackupEvent = {
  kind: BackupKind;
  ok: boolean;
  sizeBytes?: number;
  durationMs?: number;
  error?: string;
};

/** Never throws — recording status must not break the backup itself. */
export async function recordBackupEvent(evt: BackupEvent): Promise<void> {
  try {
    const prev = await getBackupStatus();
    const now = new Date().toISOString();
    const next: BackupStatus = {
      lastAttemptAt: now,
      lastKind: evt.kind,
      lastOk: evt.ok,
      lastError: evt.ok ? null : (evt.error ?? "unknown error").slice(0, 500),
      lastSuccessAt: evt.ok ? now : prev.lastSuccessAt,
      lastSuccessKind: evt.ok ? evt.kind : prev.lastSuccessKind,
      lastSuccessSizeBytes: evt.ok ? (evt.sizeBytes ?? null) : prev.lastSuccessSizeBytes,
      lastSuccessDurationMs: evt.ok ? (evt.durationMs ?? null) : prev.lastSuccessDurationMs,
    };
    _memory = next;

    await prisma.setting.upsert({
      where: { key: STATUS_KEY },
      create: { key: STATUS_KEY, value: next },
      update: { value: next },
    });

    if (!evt.ok) {
      await recordError({
        source: ErrorLogSource.BACKUP,
        code: `BACKUP_${evt.kind.toUpperCase()}_FAILED`,
        message: evt.error ?? "backup failed",
        context: { kind: evt.kind },
      });
    }
  } catch (err) {
    logger.warn(`[BackupStatus] failed to record: ${err instanceof Error ? err.message : String(err)}`);
  }
}
