import { ErrorLogSource } from "@prisma/client";
import prisma from "../config/database";
import { logger } from "../utils/logger";
import { recordError } from "./error-log.service";

// Tracks the outcome of every backup served/produced by THIS server
// (download, incremental changes, telegram, manual). Read-only observer:
// it never alters the backup flow itself. Persisted as a Setting row so it
// survives restarts; keys starting with "_" are internal and filtered out of
// the public settings payload.
//
// Tracked PER KIND (not one shared blob): a healthy daily "changes" run must
// never mask a broken "download" run — they are different backup guarantees
// (changes = incremental delta, download = the full restorable export).

const STATUS_KEY = "_backupStatus";

export type BackupKind = "download" | "changes" | "telegram" | "manual";
const ALL_KINDS: BackupKind[] = ["download", "changes", "telegram", "manual"];

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

type PerKindStatus = Record<BackupKind, BackupStatus>;

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

function emptyAll(): PerKindStatus {
  return {
    download: { ...EMPTY },
    changes: { ...EMPTY },
    telegram: { ...EMPTY },
    manual: { ...EMPTY },
  };
}

let _memory: PerKindStatus | null = null;

async function loadAll(): Promise<PerKindStatus> {
  if (_memory) return _memory;
  try {
    const row = await prisma.setting.findUnique({ where: { key: STATUS_KEY } });
    const stored = row?.value as (Partial<PerKindStatus> & Partial<BackupStatus>) | undefined;
    if (stored && "lastKind" in stored) {
      // Legacy shape from before per-kind tracking: a single flat BackupStatus.
      // Seed it into whichever kind it belonged to so history isn't lost.
      const legacy = stored as BackupStatus;
      const all = emptyAll();
      if (legacy.lastKind) all[legacy.lastKind] = { ...EMPTY, ...legacy };
      _memory = all;
    } else {
      const partial = (stored as Partial<PerKindStatus>) ?? {};
      _memory = {
        download: { ...EMPTY, ...partial.download },
        changes: { ...EMPTY, ...partial.changes },
        telegram: { ...EMPTY, ...partial.telegram },
        manual: { ...EMPTY, ...partial.manual },
      };
    }
  } catch {
    _memory = emptyAll();
  }
  return _memory;
}

/** Status for one specific kind — use this when a specific backup guarantee matters
 *  (e.g. "download" is the daily full/restorable export with its own SLA). */
export async function getBackupStatusForKind(kind: BackupKind): Promise<BackupStatus> {
  const all = await loadAll();
  return all[kind];
}

/** Aggregate across all kinds — most recent attempt/success of ANY kind. Kept for
 *  callers that just want "was anything backed up recently" without distinguishing kind. */
export async function getBackupStatus(): Promise<BackupStatus> {
  const all = await loadAll();
  const statuses = ALL_KINDS.map((k) => all[k]);
  const newest = (pick: (s: BackupStatus) => string | null) =>
    statuses.reduce<BackupStatus | null>((best, s) => {
      const t = pick(s);
      if (!t) return best;
      if (!best || (pick(best) ?? "") < t) return s;
      return best;
    }, null);

  const latestAttempt = newest((s) => s.lastAttemptAt);
  const latestSuccess = newest((s) => s.lastSuccessAt);

  return {
    lastAttemptAt: latestAttempt?.lastAttemptAt ?? null,
    lastKind: latestAttempt?.lastKind ?? null,
    lastOk: latestAttempt?.lastOk ?? null,
    lastError: latestAttempt?.lastError ?? null,
    lastSuccessAt: latestSuccess?.lastSuccessAt ?? null,
    lastSuccessKind: latestSuccess?.lastSuccessKind ?? null,
    lastSuccessSizeBytes: latestSuccess?.lastSuccessSizeBytes ?? null,
    lastSuccessDurationMs: latestSuccess?.lastSuccessDurationMs ?? null,
  };
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
    const all = await loadAll();
    const prev = all[evt.kind];
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
    all[evt.kind] = next;
    _memory = all;

    await prisma.setting.upsert({
      where: { key: STATUS_KEY },
      create: { key: STATUS_KEY, value: all },
      update: { value: all },
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
