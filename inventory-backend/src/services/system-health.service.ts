import prisma from "../config/database";
import { CampaignRecipientStatus, CampaignStatus } from "@prisma/client";
import { getWhatsAppStatus, getGreenApiStateCached } from "./whatsapp.service";
import { getLastCampaignTickAt } from "./campaign-heartbeat";
import { getBackupStatus } from "./backup-status.service";

// System Health Bar backing data. Cached so the bar (polled every 30-60s by
// every logged-in client) never hammers the DB or Green API. All queries here
// must stay LIGHT — counts/aggregates only, no full scans.

export type HealthLevel = "ok" | "warn" | "down" | "unknown";

export type SystemHealth = {
  checkedAt: string;
  db: { level: HealthLevel; latencyMs: number | null };
  whatsapp: { level: HealthLevel; provider: string; state: string | null; detail: string | null };
  campaigns: { level: HealthLevel; running: number; failed24h: number };
  cron: { level: HealthLevel; lastCampaignTickAt: string | null; ageSec: number | null };
  backup: {
    level: HealthLevel;
    tracked: boolean;
    detail: string;
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastOk: boolean | null;
    lastError: string | null;
    sizeBytes: number | null;
  };
};

let _cache: { at: number; data: SystemHealth } | null = null;
const CACHE_TTL_MS = 20_000;

export async function getSystemHealth(): Promise<SystemHealth> {
  const now = Date.now();
  if (_cache && now - _cache.at < CACHE_TTL_MS) return _cache.data;

  // ── DB ──────────────────────────────────────────────────────────────────
  let db: SystemHealth["db"] = { level: "unknown", latencyMs: null };
  try {
    const t0 = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - t0;
    db = { level: latencyMs > 1500 ? "warn" : "ok", latencyMs };
  } catch {
    db = { level: "down", latencyMs: null };
  }

  // ── WhatsApp / Green API ─────────────────────────────────────────────────
  let whatsapp: SystemHealth["whatsapp"] = { level: "unknown", provider: "web", state: null, detail: null };
  try {
    const wa = getWhatsAppStatus();
    if (!wa.enabled) {
      whatsapp = { level: "warn", provider: wa.provider, state: null, detail: "الواتساب غير مفعّل" };
    } else if (wa.provider === "greenapi") {
      const green = await getGreenApiStateCached();
      whatsapp = {
        level: green.ok ? "ok" : "down",
        provider: "greenapi",
        state: green.stateInstance,
        detail: green.ok ? null : green.error || `الحالة: ${green.stateInstance ?? "غير معروفة"}`,
      };
    } else if (wa.provider === "cloud") {
      whatsapp = {
        level: wa.cloudConfigured ? "ok" : "down",
        provider: "cloud",
        state: wa.cloudConfigured ? "configured" : null,
        detail: wa.cloudConfigured ? null : "إعدادات Cloud API ناقصة",
      };
    } else {
      whatsapp = {
        level: wa.isReady ? "ok" : "warn",
        provider: "web",
        state: wa.state,
        detail: wa.isReady ? null : "غير متصل — امسح رمز QR",
      };
    }
  } catch {
    whatsapp = { level: "unknown", provider: "web", state: null, detail: null };
  }

  // ── Campaigns ─────────────────────────────────────────────────────────────
  let campaigns: SystemHealth["campaigns"] = { level: "unknown", running: 0, failed24h: 0 };
  try {
    const since = new Date(now - 24 * 60 * 60 * 1000);
    const [running, failed24h] = await Promise.all([
      prisma.campaign.count({ where: { status: CampaignStatus.RUNNING } }),
      prisma.campaignRecipient.count({
        where: { status: CampaignRecipientStatus.FAILED, retryLastAttemptAt: { gte: since } },
      }),
    ]);
    campaigns = {
      level: failed24h > 20 ? "warn" : "ok",
      running,
      failed24h,
    };
  } catch {
    campaigns = { level: "unknown", running: 0, failed24h: 0 };
  }

  // ── Cron ────────────────────────────────────────────────────────────────
  // The per-minute campaign tick is our heartbeat. If it hasn't run in >5 min
  // the scheduler is likely dead. (In-memory — resets on restart, shows unknown.)
  const lastTick = getLastCampaignTickAt();
  let cron: SystemHealth["cron"];
  if (!lastTick) {
    cron = { level: "unknown", lastCampaignTickAt: null, ageSec: null };
  } else {
    const ageSec = Math.round((now - lastTick) / 1000);
    cron = {
      level: ageSec > 300 ? "warn" : "ok",
      lastCampaignTickAt: new Date(lastTick).toISOString(),
      ageSec,
    };
  }

  // ── Backup ────────────────────────────────────────────────────────────────
  // The shop-PC scripts download their backups THROUGH this server
  // (/settings/backup/download + /changes), so every attempt is recorded by
  // backup-status.service. Healthy = a successful backup in the last 26h
  // (daily task runs at 03:00 Asia/Baghdad + slack).
  let backup: SystemHealth["backup"] = {
    level: "unknown",
    tracked: false,
    detail: "لم يُسجَّل أي نسخ احتياطي بعد",
    lastSuccessAt: null,
    lastAttemptAt: null,
    lastOk: null,
    lastError: null,
    sizeBytes: null,
  };
  try {
    const st = await getBackupStatus();
    if (st.lastAttemptAt) {
      const successAgeH = st.lastSuccessAt
        ? (now - new Date(st.lastSuccessAt).getTime()) / 3_600_000
        : Infinity;
      const sizeMb = st.lastSuccessSizeBytes != null
        ? `${(st.lastSuccessSizeBytes / 1024 / 1024).toFixed(1)}MB`
        : null;
      const lastSuccessLabel = st.lastSuccessAt
        ? `آخر نسخة ناجحة ${new Date(st.lastSuccessAt).toLocaleString("ar-IQ", { timeZone: "Asia/Baghdad" })}${sizeMb ? ` (${sizeMb})` : ""}`
        : "لا توجد نسخة ناجحة";

      let level: HealthLevel;
      let detail: string;
      if (st.lastOk === false) {
        level = "down";
        detail = `فشلت آخر محاولة: ${st.lastError ?? "خطأ غير معروف"} — ${lastSuccessLabel}`;
      } else if (successAgeH > 26) {
        level = "warn";
        detail = `${lastSuccessLabel} — مضى أكثر من ${Math.floor(successAgeH)} ساعة`;
      } else {
        level = "ok";
        detail = lastSuccessLabel;
      }
      backup = {
        level,
        tracked: true,
        detail,
        lastSuccessAt: st.lastSuccessAt,
        lastAttemptAt: st.lastAttemptAt,
        lastOk: st.lastOk,
        lastError: st.lastError,
        sizeBytes: st.lastSuccessSizeBytes,
      };
    }
  } catch {
    // keep the "unknown" default
  }

  const data: SystemHealth = {
    checkedAt: new Date(now).toISOString(),
    db,
    whatsapp,
    campaigns,
    cron,
    backup,
  };
  _cache = { at: now, data };
  return data;
}
