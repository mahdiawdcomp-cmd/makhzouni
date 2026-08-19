import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import qrcode from "qrcode";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
import { logChatMessage } from "./whatsapp-chat.service";
import { recordError } from "./error-log.service";
import { ErrorLogSource } from "@prisma/client";
import type { getInvoiceById } from "./invoice.service";

type WhatsAppState = "INITIALIZING" | "QR" | "READY" | "AUTH_FAILURE" | "DISCONNECTED" | "ERROR";
export type WhatsAppProvider = "web" | "cloud" | "greenapi" | "manual" | "disabled";
export type WhatsAppStatusCode = "ready" | "missing_settings" | "failed" | "disabled" | "manual_only";
// Explicit per-send channel picked by staff in the UI (the third channel,
// "web"/wa.me, never reaches the server — it opens in the employee's browser).
// undefined = legacy behavior: the tenant's default provider decides.
export type WhatsAppSendChannel = "official" | "personal";

let client: Client | null = null;
let state: WhatsAppState = "DISCONNECTED";
let lastQr: string | null = null;
let lastQrDataUrl: string | null = null;
let lastError: string | null = null;
let initialized = false;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const authDataPath = process.env.WHATSAPP_AUTH_PATH?.trim() || ".wwebjs_auth";
const graphVersion = process.env.WHATSAPP_CLOUD_GRAPH_VERSION?.trim() || "v20.0";

// DB-sourced credential overrides
let _dbCloudToken = "";
let _dbCloudPhoneNumberId = "";
let _dbProviderOverride: WhatsAppProvider | null = null;
let _greenApiInstanceId = "";
let _greenApiToken = "";
let _dbGreenBaseUrl = "";
let _dbCloudBusinessAccountId = "";
let _dbCloudVerifyToken = "";
let _dbCloudAppSecret = "";
// Personal channel (Green API as a PARALLEL channel, not the default provider)
let _personalChannelEnabled = false;
let _personalDailyLimit = 100;
let _webChannelEnabled = true;

/** Called by settings service when credentials change, and at server startup */
export function setCloudCredentials(token: string, phoneNumberId: string, providerOverride?: string) {
  _dbCloudToken = token?.trim() ?? "";
  _dbCloudPhoneNumberId = phoneNumberId?.trim() ?? "";
  _dbProviderOverride =
    providerOverride === "cloud" ? "cloud" :
    providerOverride === "greenapi" ? "greenapi" :
    providerOverride === "manual" ? "manual" :
    providerOverride === "disabled" ? "disabled" :
    providerOverride === "web" ? "web" :
    null;
}

export function setGreenApiCredentials(instanceId: string, token: string) {
  _greenApiInstanceId = instanceId?.trim() ?? "";
  _greenApiToken = token?.trim() ?? "";
}

/**
 * Unified DB → runtime sync. Called by settings.service on startup and whenever
 * settings are saved, so a tenant can fully configure WhatsApp from the UI with
 * no env/Railway access. env vars remain the fallback when a DB field is empty.
 */
export function syncWhatsAppSettings(s: {
  whatsappProvider?: string;
  whatsappCloudToken?: string;
  whatsappCloudPhoneNumberId?: string;
  whatsappCloudBusinessAccountId?: string;
  whatsappCloudVerifyToken?: string;
  whatsappCloudAppSecret?: string;
  greenApiInstanceId?: string;
  greenApiToken?: string;
  greenApiBaseUrl?: string;
  personalChannelEnabled?: boolean;
  personalChannelDailyLimit?: number;
  webChannelEnabled?: boolean;
}) {
  setCloudCredentials(s.whatsappCloudToken ?? "", s.whatsappCloudPhoneNumberId ?? "", s.whatsappProvider);
  setGreenApiCredentials(s.greenApiInstanceId ?? "", s.greenApiToken ?? "");
  _dbGreenBaseUrl = s.greenApiBaseUrl?.trim() ?? "";
  _dbCloudBusinessAccountId = s.whatsappCloudBusinessAccountId?.trim() ?? "";
  _dbCloudVerifyToken = s.whatsappCloudVerifyToken?.trim() ?? "";
  _dbCloudAppSecret = s.whatsappCloudAppSecret?.trim() ?? "";
  _personalChannelEnabled = s.personalChannelEnabled === true;
  _personalDailyLimit = typeof s.personalChannelDailyLimit === "number" && s.personalChannelDailyLimit >= 0
    ? s.personalChannelDailyLimit
    : 100;
  _webChannelEnabled = s.webChannelEnabled !== false;
}

/** Random opaque token for the Meta webhook verify handshake. */
export function generateVerifyToken() {
  return `mkz_${crypto.randomBytes(18).toString("hex")}`;
}

/** Cloud webhook secrets, env-first with DB fallback. Never returned to clients raw. */
export function getCloudWebhookConfig() {
  return {
    verifyToken: _dbCloudVerifyToken || process.env.WHATSAPP_CLOUD_VERIFY_TOKEN?.trim(),
    appSecret: _dbCloudAppSecret || process.env.WHATSAPP_CLOUD_APP_SECRET?.trim(),
  };
}

/**
 * Lists which Meta Apps are currently subscribed to receive webhook events for
 * this WABA (Business Account) — changing an App's Callback URL does NOT move
 * this subscription. A number connected through a different tool (e.g.
 * Chatwoot, which subscribes its OWN app to the WABA) will keep sending events
 * to that tool's app even after the URL is changed here, until OUR app is
 * explicitly (re-)subscribed via subscribeAppToWaba().
 */
export async function getWabaSubscribedApps(wabaId: string) {
  const { token } = cloudConfig();
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${wabaId}/subscribed_apps`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new AppError(`Failed to read WABA subscriptions: ${await parseGraphError(response)}`, 502, "WHATSAPP_WABA_SUBSCRIPTIONS_FAILED");
  }
  const data = (await response.json()) as { data?: Array<{ whatsapp_business_api_data?: { id?: string; name?: string; link?: string } }> };
  return data.data ?? [];
}

/** Subscribes THIS app (the one behind our stored access token) to the WABA's webhook events. */
export async function subscribeAppToWaba(wabaId: string) {
  const { token } = cloudConfig();
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${wabaId}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new AppError(`Failed to subscribe app to WABA: ${await parseGraphError(response)}`, 502, "WHATSAPP_WABA_SUBSCRIBE_FAILED");
  }
  return (await response.json()) as { success?: boolean };
}

/**
 * بند ٩ — قراءة تقييم الجودة (GREEN/YELLOW/RED) وحالة الرقم (CONNECTED/
 * FLAGGED/RESTRICTED/RATE_LIMITED/BANNED/...) من Meta مباشرة. استعلام
 * احتياطي يومي يكمّل الـwebhook — لو الاثنان فاتوا حدث، هذا يلتقطه بعد أقصى
 * يوم وحد. يرمي لو Cloud API غير مهيّأ — المستدعي مسؤول عن الالتقاط بصمت.
 */
export async function fetchPhoneNumberQualityStatus() {
  const { token, baseUrl } = cloudConfig();
  const response = await fetch(`${baseUrl}?fields=quality_rating,status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new AppError(`Failed to read phone number quality: ${await parseGraphError(response)}`, 502, "WHATSAPP_QUALITY_CHECK_FAILED");
  }
  return (await response.json()) as { quality_rating?: string; status?: string; id?: string };
}

function hasGreenApiCreds() {
  return Boolean(
    (_greenApiInstanceId || process.env.GREENAPI_INSTANCE_ID?.trim()) &&
    (_greenApiToken || process.env.GREENAPI_TOKEN?.trim()),
  );
}

function hasCloudCreds() {
  return Boolean(
    (_dbCloudToken || process.env.WHATSAPP_CLOUD_TOKEN?.trim()) &&
    (_dbCloudPhoneNumberId || process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID?.trim()),
  );
}

/** Where the active provider was resolved from — for the "you are using…" line. */
export type ProviderSource = "env" | "db" | "default";

/**
 * Resolves the provider actually used for sending AND where it came from.
 * "env" = server env vars (WHATSAPP_PROVIDER or the GREENAPI / WHATSAPP_CLOUD keys),
 * "db" = the tenant's saved UI settings, "default" = unconfigured legacy web.
 */
function providerWithSource(): { provider: WhatsAppProvider; source: ProviderSource } {
  // 1) DB EXPLICIT choice wins — the tenant configured this from the UI, so it
  //    must beat env (a saved "cloud" must never fall back to an env Green
  //    instance). A saved "web" is the legacy auto sentinel and deliberately
  //    falls through to env/auto-detect below (never short-circuits) so tenants
  //    who set up Green/Cloud via env and never picked a provider keep working.
  if (_dbProviderOverride === "cloud") return { provider: "cloud", source: "db" };
  if (_dbProviderOverride === "greenapi") return { provider: "greenapi", source: "db" };
  if (_dbProviderOverride === "manual") return { provider: "manual", source: "db" };
  if (_dbProviderOverride === "disabled") return { provider: "disabled", source: "db" };

  // 2) env override (only when the DB provider is unset / legacy "web").
  const configured = process.env.WHATSAPP_PROVIDER?.trim().toLowerCase();
  if (configured === "greenapi") return { provider: "greenapi", source: "env" };
  if (configured === "cloud") return { provider: "cloud", source: "env" };
  if (configured === "manual") return { provider: "manual", source: "env" };
  if (configured === "disabled") return { provider: "disabled", source: "env" };

  // 3) auto-detect from credentials — distinguish env vs DB so the UI can say
  //    "من إعدادات السيرفر" when it's an env fallback.
  const envGreen = Boolean(process.env.GREENAPI_INSTANCE_ID?.trim() && process.env.GREENAPI_TOKEN?.trim());
  if (envGreen) return { provider: "greenapi", source: "env" };
  if (_greenApiInstanceId && _greenApiToken) return { provider: "greenapi", source: "db" };

  const envCloud = Boolean(process.env.WHATSAPP_CLOUD_TOKEN?.trim() && process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID?.trim());
  if (envCloud) return { provider: "cloud", source: "env" };
  if (_dbCloudToken && _dbCloudPhoneNumberId) return { provider: "cloud", source: "db" };

  // 4) legacy default
  return { provider: "web", source: "default" };
}

function provider(): WhatsAppProvider {
  return providerWithSource().provider;
}

function whatsappEnabled() {
  if (process.env.ENABLE_WHATSAPP === "true") return true;
  // Auto-enable when Cloud API or GreenAPI credentials are configured via Settings
  const hasCloud = Boolean(_dbCloudToken && _dbCloudPhoneNumberId);
  const hasGreen = Boolean(_greenApiInstanceId && _greenApiToken);
  return hasCloud || hasGreen;
}

/**
 * Single gate for all silent/background sends. Throws a clear, code-tagged error
 * for the two "no silent sending" providers before any network work happens.
 */
function assertCanSend(): WhatsAppProvider {
  const prov = provider();
  if (prov === "disabled") {
    throw new AppError("الواتساب معطّل من الإعدادات", 503, "WHATSAPP_DISABLED");
  }
  if (prov === "manual") {
    throw new AppError("واتساب مضبوط على الرابط اليدوي فقط — لا يوجد إرسال تلقائي بالخلفية", 400, "WHATSAPP_MANUAL_ONLY");
  }
  if (!whatsappEnabled()) {
    throw new AppError("WhatsApp is disabled. Set ENABLE_WHATSAPP=true", 503, "WHATSAPP_DISABLED");
  }
  return prov;
}

/**
 * Resolves the provider for an explicit per-send channel choice from the UI.
 * No channel → legacy path (tenant default provider). The personal channel is
 * usable even when the tenant's default provider is Cloud — that's the whole
 * point of parallel channels.
 */
function resolveSendProvider(channel?: WhatsAppSendChannel): WhatsAppProvider {
  if (!channel) return assertCanSend();
  if (channel === "official") {
    if (!hasCloudCreds()) {
      throw new AppError("القناة الرسمية (Meta Cloud API) غير مضبوطة", 503, "OFFICIAL_CHANNEL_NOT_CONFIGURED");
    }
    return "cloud";
  }
  if (!_personalChannelEnabled) {
    throw new AppError("قناة الرقم الشخصي غير مفعّلة من الإعدادات", 400, "PERSONAL_CHANNEL_DISABLED");
  }
  if (!hasGreenApiCreds()) {
    throw new AppError("بيانات Green API غير مضبوطة لقناة الرقم الشخصي", 503, "GREENAPI_NOT_CONFIGURED");
  }
  return "greenapi";
}

// ── Personal channel daily limit ────────────────────────────────────────────
// The personal number was banned once before — the daily cap keeps manual
// sends from ever looking like bulk traffic. Persisted in the Setting table
// (underscore key = internal, skipped by getSettings) so restarts don't reset
// it; mirrored in memory so getWhatsAppStatus stays synchronous.
const PERSONAL_COUNTER_KEY = "_personalChannelCounter";
let _personalCounter: { date: string; count: number } | null = null;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function getPersonalSentToday(): number {
  return _personalCounter?.date === todayKey() ? _personalCounter.count : 0;
}

async function takePersonalSendSlot() {
  const today = todayKey();
  if (!_personalCounter || _personalCounter.date !== today) {
    const row = await prisma.setting.findUnique({ where: { key: PERSONAL_COUNTER_KEY } }).catch(() => null);
    const v = (row?.value ?? null) as { date?: string; count?: number } | null;
    _personalCounter = v?.date === today ? { date: today, count: v.count ?? 0 } : { date: today, count: 0 };
  }
  if (_personalDailyLimit > 0 && _personalCounter.count >= _personalDailyLimit) {
    throw new AppError(
      `وصلت الحد اليومي للإرسال من الرقم الشخصي (${_personalDailyLimit} رسالة) — استخدم القناة الرسمية أو الويب`,
      429,
      "PERSONAL_CHANNEL_DAILY_LIMIT",
    );
  }
  _personalCounter = { date: today, count: _personalCounter.count + 1 };
  const value = _personalCounter;
  await prisma.setting.upsert({
    where: { key: PERSONAL_COUNTER_KEY },
    create: { key: PERSONAL_COUNTER_KEY, value },
    update: { value },
  }).catch(() => {});
}

// ── Green API ────────────────────────────────────────────────────────────────

function greenApiConfig() {
  const instanceId = _greenApiInstanceId || process.env.GREENAPI_INSTANCE_ID?.trim();
  const token = _greenApiToken || process.env.GREENAPI_TOKEN?.trim();
  if (!instanceId || !token) throw new AppError("Green API is not configured", 503, "GREENAPI_NOT_CONFIGURED");
  // Support custom base URL (e.g. https://7107.api.greenapi.com) or fall back to default
  const customBase = _dbGreenBaseUrl || process.env.GREENAPI_BASE_URL?.trim();
  const baseUrl = customBase
    ? `${customBase}/waInstance${instanceId}`
    : `https://api.green-api.com/waInstance${instanceId}`;
  return { instanceId, token, baseUrl };
}

function normalizeGreenPhone(phone: string) {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `964${digits.slice(1)}`;
  if (digits.startsWith("7")) digits = `964${digits}`;
  return `${digits}@c.us`;
}

async function sendGreenApiText(phone: string, message: string): Promise<{ idMessage?: string }> {
  const { baseUrl, token } = greenApiConfig();
  const chatId = normalizeGreenPhone(phone);
  const res = await fetch(`${baseUrl}/sendMessage/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new AppError(`Green API send failed: ${text}`, 502, "GREENAPI_SEND_FAILED");
  }
  const data = (await res.json().catch(() => null)) as { idMessage?: string } | null;
  return { idMessage: data?.idMessage };
}

async function sendGreenApiDocument(phone: string, pdf: Buffer, filename: string, caption: string) {
  const { baseUrl, token } = greenApiConfig();
  const chatId = normalizeGreenPhone(phone);
  const form = new FormData();
  const bytes = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
  form.append("chatId", chatId);
  form.append("caption", caption);
  form.append("fileName", filename);
  form.append("file", new Blob([bytes], { type: "application/pdf" }), filename);
  const res = await fetch(`${baseUrl}/sendFileByUpload/${token}`, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new AppError(`Green API file send failed: ${text}`, 502, "GREENAPI_FILE_FAILED");
  }
}

async function sendGreenApiImage(phone: string, image: Buffer, mime: string, caption: string): Promise<{ idMessage?: string }> {
  const { baseUrl, token } = greenApiConfig();
  const chatId = normalizeGreenPhone(phone);
  const ext = mime.includes("png") ? "png" : "jpg";
  const form = new FormData();
  const bytes = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer;
  form.append("chatId", chatId);
  form.append("caption", caption);
  form.append("fileName", `image.${ext}`);
  form.append("file", new Blob([bytes], { type: mime }), `image.${ext}`);
  const res = await fetch(`${baseUrl}/sendFileByUpload/${token}`, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new AppError(`Green API image send failed: ${text}`, 502, "GREENAPI_IMAGE_FAILED");
  }
  const data = (await res.json().catch(() => null)) as { idMessage?: string } | null;
  return { idMessage: data?.idMessage };
}

// ── Green API instance state (cached) ──────────────────────────────────────────
// getStateInstance tells us if the WhatsApp instance is actually authorized
// (logged in) vs disconnected. Cached for 45s so a health bar polling every
// 30-60s doesn't spend Green API quota or add latency on each hit.
type GreenState = { stateInstance: string | null; ok: boolean; error: string | null; checkedAt: number };
let _greenStateCache: GreenState | null = null;
const GREEN_STATE_TTL_MS = 45_000;

export async function getGreenApiStateCached(): Promise<GreenState> {
  const now = Date.now();
  if (_greenStateCache && now - _greenStateCache.checkedAt < GREEN_STATE_TTL_MS) {
    return _greenStateCache;
  }
  let result: GreenState;
  try {
    const { baseUrl, token } = greenApiConfig();
    const res = await fetch(`${baseUrl}/getStateInstance/${token}`, { method: "GET" });
    if (!res.ok) {
      result = { stateInstance: null, ok: false, error: `HTTP ${res.status}`, checkedAt: now };
    } else {
      const data = (await res.json().catch(() => null)) as { stateInstance?: string } | null;
      const stateInstance = data?.stateInstance ?? null;
      result = { stateInstance, ok: stateInstance === "authorized", error: null, checkedAt: now };
    }
  } catch (err) {
    result = {
      stateInstance: null,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      checkedAt: now,
    };
  }
  _greenStateCache = result;
  return result;
}

async function uploadCloudImage(image: Buffer, mime: string) {
  const { token, baseUrl } = cloudConfig();
  const bytes = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer;
  const ext = mime.includes("png") ? "png" : "jpg";
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([bytes], { type: mime }), `image.${ext}`);
  const response = await fetch(`${baseUrl}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!response.ok) {
    throw new AppError(`WhatsApp Cloud image upload failed: ${await parseGraphError(response)}`, 502, "WHATSAPP_CLOUD_IMAGE_FAILED");
  }
  const data = await response.json() as { id?: string };
  if (!data.id) throw new AppError("WhatsApp Cloud image id missing", 502, "WHATSAPP_CLOUD_IMAGE_ID_MISSING");
  return data.id;
}

// ── Meta Cloud API ───────────────────────────────────────────────────────────

function cloudConfig() {
  const token = _dbCloudToken || process.env.WHATSAPP_CLOUD_TOKEN?.trim();
  const phoneNumberId = _dbCloudPhoneNumberId || process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId) {
    throw new AppError("WhatsApp Cloud API is not configured", 503, "WHATSAPP_CLOUD_NOT_CONFIGURED");
  }
  return {
    token,
    phoneNumberId,
    baseUrl: `https://graph.facebook.com/${graphVersion}/${phoneNumberId}`,
  };
}

// Keep-alive: ping every 2 minutes to detect dead sessions early
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

function resolveChromePath() {
  const configuredPath = process.env.CHROME_PATH?.trim();
  if (configuredPath) {
    if (fs.existsSync(configuredPath)) return configuredPath;
    logger.warn(`WhatsApp disabled: CHROME_PATH does not exist (${configuredPath})`);
    return null;
  }
  return undefined;
}

function clearAuthSession() {
  const target = path.resolve(process.cwd(), authDataPath);
  if (!target.endsWith(path.normalize(authDataPath)) && authDataPath !== ".wwebjs_auth") {
    logger.warn(`[WhatsApp] Refusing to clear unexpected auth path: ${target}`);
    return;
  }
  try {
    fs.rmSync(target, { recursive: true, force: true });
    logger.info(`[WhatsApp] Cleared auth session at ${target}`);
  } catch (err) {
    logger.warn(`[WhatsApp] Failed to clear auth session: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) throw new AppError("Invalid phone number", 422, "INVALID_PHONE");
  return `${digits}@c.us`;
}

function normalizeCloudPhone(phone: string) {
  let digits = phone.replace(/\D/g, "");
  if (!digits) throw new AppError("Invalid phone number", 422, "INVALID_PHONE");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `964${digits.slice(1)}`;
  if (digits.startsWith("7")) digits = `964${digits}`;
  return digits;
}

async function parseGraphError(response: Response) {
  const text = await response.text();
  try {
    const json = JSON.parse(text) as { error?: { message?: string; code?: number } };
    return json.error?.message || text;
  } catch {
    return text;
  }
}

// Media larger than this is never inlined as a base64 data URL (would bloat the
// DB row) — the chat log still gets a readable placeholder, it just can't show
// the content inline. WhatsApp's own per-type caps (images 5MB, audio/video
// 16MB, documents 100MB) are all above what's sane to store as base64 text.
const MAX_INLINE_MEDIA_BYTES = 8 * 1024 * 1024;

/**
 * Downloads inbound Cloud API media (image/document/audio/video/sticker) by its
 * Meta media id and returns it as a base64 data URL for inline storage in the
 * chat log. Meta's media URLs are short-lived and auth-gated, so this must run
 * synchronously while handling the webhook — there's no "fetch it later".
 * Returns null (never throws) if the media is missing, too large, or the
 * download fails — callers fall back to a text-only placeholder so an inbound
 * message is never silently dropped just because the binary couldn't be fetched.
 */
export async function fetchCloudMedia(
  mediaId: string
): Promise<{ dataUrl: string; mimeType: string; sizeBytes: number } | null> {
  try {
    const { token } = cloudConfig();
    const metaRes = await fetch(`https://graph.facebook.com/${graphVersion}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) {
      logger.warn(`[WhatsAppMeta] media metadata fetch failed for ${mediaId}: ${await parseGraphError(metaRes)}`);
      return null;
    }
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!meta.url) return null;
    if (meta.file_size && meta.file_size > MAX_INLINE_MEDIA_BYTES) {
      logger.info(`[WhatsAppMeta] media ${mediaId} too large to inline (${meta.file_size} bytes) — placeholder only`);
      return null;
    }

    const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!fileRes.ok) {
      logger.warn(`[WhatsAppMeta] media download failed for ${mediaId}: ${fileRes.status}`);
      return null;
    }
    const buf = Buffer.from(await fileRes.arrayBuffer());
    if (buf.byteLength > MAX_INLINE_MEDIA_BYTES) return null;

    const mimeType = meta.mime_type || "application/octet-stream";
    return { dataUrl: `data:${mimeType};base64,${buf.toString("base64")}`, mimeType, sizeBytes: buf.byteLength };
  } catch (err) {
    logger.warn(`[WhatsAppMeta] fetchCloudMedia error for ${mediaId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function sendCloudMessage(payload: Record<string, unknown>): Promise<string | undefined> {
  const { token, baseUrl } = cloudConfig();
  const response = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  if (!response.ok) {
    throw new AppError(
      `WhatsApp Cloud send failed: ${await parseGraphError(response)}`,
      502,
      "WHATSAPP_CLOUD_SEND_FAILED",
    );
  }
  const data = (await response.json().catch(() => null)) as { messages?: Array<{ id?: string }> } | null;
  return data?.messages?.[0]?.id;
}

async function uploadCloudMedia(pdf: Buffer, filename: string, mime = "application/pdf") {
  const { token, baseUrl } = cloudConfig();
  const bytes = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([bytes], { type: mime }), filename);

  const response = await fetch(`${baseUrl}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!response.ok) {
    throw new AppError(
      `WhatsApp Cloud media upload failed: ${await parseGraphError(response)}`,
      502,
      "WHATSAPP_CLOUD_MEDIA_FAILED",
    );
  }
  const data = await response.json() as { id?: string };
  if (!data.id) throw new AppError("WhatsApp Cloud media id missing", 502, "WHATSAPP_CLOUD_MEDIA_ID_MISSING");
  return data.id;
}

/** Detect errors that mean the underlying Puppeteer page is dead */
function isFrameDetachedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("detached Frame") ||
    msg.includes("Detached Frame") ||
    msg.includes("Session closed") ||
    msg.includes("Target closed") ||
    msg.includes("Protocol error") ||
    msg.includes("Runtime.callFunctionOn timed out") ||
    msg.includes("Execution context was destroyed") ||
    msg.includes("protocolTimeout") ||
    msg.includes("page has been closed") ||
    msg.includes("Cannot find context with specified id")
  );
}

function startKeepAlive() {
  stopKeepAlive();
  keepAliveTimer = setInterval(async () => {
    if (state !== "READY" || !client) return;
    try {
      // Lightweight check — get WhatsApp Web version
      await client.getWWebVersion();
    } catch (err) {
      if (isFrameDetachedError(err)) {
        logger.warn("[WhatsApp] Keep-alive detected dead session — triggering restart");
        triggerRestart();
      }
    }
  }, 2 * 60_000); // every 2 minutes
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function scheduleReconnect(reason: string) {
  if (reconnectTimer) return;
  if (reconnectAttempts >= MAX_RECONNECT) {
    logger.warn(`[WhatsApp] Max reconnect attempts reached after ${reason}. Scan QR again.`);
    return;
  }
  reconnectAttempts++;
  const delay = Math.min(1500 + reconnectAttempts * 1500, 8000);
  logger.info(`[WhatsApp] Reconnecting in ${delay / 1000}s after ${reason} (attempt ${reconnectAttempts}/${MAX_RECONNECT})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    initializeWhatsApp();
  }, delay);
}

function triggerRestart(reason = "restart") {
  state = "DISCONNECTED";
  initialized = false;
  stopKeepAlive();
  if (client) {
    client.destroy().catch(() => {});
    client = null;
  }
  scheduleReconnect(reason);
}

export function initializeWhatsApp() {
  const prov = provider();

  // HTTP-based / no-session providers don't launch Puppeteer.
  if (prov === "cloud" || prov === "greenapi") {
    state = "READY";
    initialized = true;
    lastError = null;
    logger.info(`[WhatsApp] ${prov === "cloud" ? "Cloud API" : "Green API"} provider ready`);
    return;
  }

  if (prov === "manual" || prov === "disabled") {
    state = "DISCONNECTED";
    initialized = true;
    lastError = null;
    logger.info(`[WhatsApp] provider=${prov} — no background sending`);
    return;
  }

  if (initialized) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  initialized = true;
  state = "INITIALIZING";

  const chromePath = resolveChromePath();
  if (chromePath === null) {
    state = "ERROR";
    lastError = "CHROME_PATH is configured but the file was not found";
    return;
  }

  client = new Client({
    authStrategy: new LocalAuth({ clientId: "inventory-backend", dataPath: authDataPath }),
    puppeteer: {
      headless: true,
      executablePath: chromePath,
      timeout: 120000,
      protocolTimeout: 300000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--disable-accelerated-2d-canvas",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-default-apps",
        "--disable-sync",
        "--disable-translate",
        "--hide-scrollbars",
        "--metrics-recording-only",
        "--mute-audio",
        "--no-default-browser-check",
        "--no-first-run",
        "--disable-renderer-backgrounding",
      ],
    },
  });

  client.on("qr", async (qr) => {
    state = "QR";
    lastQr = qr;
    lastQrDataUrl = await qrcode.toDataURL(qr);
  });

  client.on("ready", () => {
    state = "READY";
    lastError = null;
    reconnectAttempts = 0;
    logger.info("[WhatsApp] Ready ✓");
    startKeepAlive();
  });

  client.on("auth_failure", (message) => {
    state = "AUTH_FAILURE";
    lastError = message;
    stopKeepAlive();
  });

  client.on("disconnected", (reason) => {
    logger.warn(`[WhatsApp] Disconnected: ${reason}`);
    stopKeepAlive();
    state = "DISCONNECTED";
    lastError = reason;
    client = null;
    initialized = false;
    scheduleReconnect(`disconnect: ${reason}`);
  });

  const initPromise = client.initialize();
  initPromise.catch((error: unknown) => {
    state = "ERROR";
    lastError = error instanceof Error ? error.message : String(error);
    initialized = false;
    client = null;
    stopKeepAlive();
    logger.warn(`[WhatsApp] initialize() failed: ${lastError}`);
    scheduleReconnect("initialize failure");
  });
  initPromise.then(() => {}).catch(() => {});
}

export function getWhatsAppStatus() {
  const { provider: currentProvider, source: providerSource } = providerWithSource();
  const cloudConfigured = hasCloudCreds();
  const greenConfigured = hasGreenApiCreds();
  const webhook = getCloudWebhookConfig();
  const isHttpProvider = currentProvider === "cloud" || currentProvider === "greenapi";

  // Coarse, synchronous status. Deep Green API liveness lives in
  // system-health.service via getGreenApiStateCached (async, cached).
  let statusCode: WhatsAppStatusCode;
  if (currentProvider === "disabled") {
    statusCode = "disabled";
  } else if (currentProvider === "manual") {
    statusCode = "manual_only";
  } else if (currentProvider === "greenapi") {
    statusCode = greenConfigured ? "ready" : "missing_settings";
  } else if (currentProvider === "cloud") {
    statusCode = cloudConfigured ? "ready" : "missing_settings";
  } else {
    // web (QR)
    statusCode = state === "READY" ? "ready" : whatsappEnabled() ? "failed" : "missing_settings";
  }

  // The provider the tenant explicitly selected in the UI (null when never set /
  // legacy "web" auto). Distinct from activeProvider, which is what actually sends.
  const selectedProvider: WhatsAppProvider | null = _dbProviderOverride;

  // Required-but-missing credential fields for the ACTIVE provider — so the UI
  // can pinpoint exactly what's incomplete instead of a generic message.
  const missingFields: string[] = [];
  if (currentProvider === "cloud") {
    const hasToken = Boolean(process.env.WHATSAPP_CLOUD_TOKEN?.trim() || _dbCloudToken);
    const hasPhoneId = Boolean(process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID?.trim() || _dbCloudPhoneNumberId);
    if (!hasToken) missingFields.push("Access Token");
    if (!hasPhoneId) missingFields.push("Phone Number ID");
  } else if (currentProvider === "greenapi") {
    const hasInstance = Boolean(process.env.GREENAPI_INSTANCE_ID?.trim() || _greenApiInstanceId);
    const hasToken = Boolean(process.env.GREENAPI_TOKEN?.trim() || _greenApiToken);
    if (!hasInstance) missingFields.push("Instance ID");
    if (!hasToken) missingFields.push("Token");
  }

  return {
    provider: currentProvider,
    activeProvider: currentProvider,
    // Parallel send channels (independent of the default provider above).
    channels: {
      official: { configured: cloudConfigured },
      personal: {
        enabled: _personalChannelEnabled,
        configured: greenConfigured,
        dailyLimit: _personalDailyLimit,
        sentToday: getPersonalSentToday(),
      },
      web: { enabled: _webChannelEnabled },
    },
    selectedProvider,
    providerSource,
    missingFields,
    status: statusCode,
    enabled: whatsappEnabled(),
    cloudConfigured,
    greenConfigured,
    businessAccountId: _dbCloudBusinessAccountId || null,
    verifyTokenSet: Boolean(webhook.verifyToken),
    appSecretSet: Boolean(webhook.appSecret),
    initialized,
    state,
    isReady: statusCode === "ready",
    qr: isHttpProvider ? null : lastQr,
    qrDataUrl: isHttpProvider ? null : lastQrDataUrl,
    error:
      currentProvider === "cloud" && !cloudConfigured
        ? "إعدادات Cloud API ناقصة (Access Token و Phone Number ID)"
        : currentProvider === "greenapi" && !greenConfigured
          ? "إعدادات Green API ناقصة (Instance ID و Token)"
          : currentProvider === "web" && !whatsappEnabled()
            ? "ENABLE_WHATSAPP is not true"
            : lastError,
  };
}

function requireReadyClient() {
  if (!client || state !== "READY") {
    throw new AppError("WhatsApp is not connected yet", 503, "WHATSAPP_NOT_READY");
  }
  return client;
}

export async function restartWhatsApp() {
  const prov = provider();
  // Only the WhatsApp Web (Puppeteer) provider has a real session to restart.
  if (prov !== "web") {
    lastQr = null;
    lastQrDataUrl = null;
    lastError = null;
    initialized = false;
    initializeWhatsApp();
    return;
  }

  stopKeepAlive();
  if (client) {
    try { await client.destroy(); } catch { /* ignore */ }
    client = null;
  }
  state = "DISCONNECTED";
  initialized = false;
  reconnectAttempts = 0;
  lastQr = null;
  lastQrDataUrl = null;
  lastError = null;
  clearAuthSession();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  initializeWhatsApp();
}

/** Send a text message. opts.replyToWaMessageId quotes an earlier message
 * (real WhatsApp reply on Cloud API; other providers just log the quote). */
export async function sendWhatsAppText(
  phone: string,
  message: string,
  opts?: { replyToWaMessageId?: string; channel?: WhatsAppSendChannel },
): Promise<{ to: string; message: string; idMessage?: string }> {
  const prov = resolveSendProvider(opts?.channel);
  if (opts?.channel === "personal") await takePersonalSendSlot();
  const replyToWaMessageId = opts?.replyToWaMessageId ?? null;

  if (prov === "greenapi") {
    const { idMessage } = await sendGreenApiText(phone, message);
    await logChatMessage({ phone, direction: "OUT", text: message, waMessageId: idMessage, replyToWaMessageId }).catch(() => {});
    return { to: phone, message, idMessage };
  }

  if (prov === "cloud") {
    const to = normalizeCloudPhone(phone);
    const idMessage = await sendCloudMessage({
      to,
      type: "text",
      text: { preview_url: false, body: message },
      ...(replyToWaMessageId ? { context: { message_id: replyToWaMessageId } } : {}),
    });
    await logChatMessage({ phone: to, direction: "OUT", text: message, waMessageId: idMessage, replyToWaMessageId }).catch(() => {});
    return { to, message, idMessage };
  }

  const to = normalizePhone(phone);

  try {
    const readyClient = requireReadyClient();
    await readyClient.sendMessage(to, message);
    await logChatMessage({ phone: to, direction: "OUT", text: message }).catch(() => {});
    return { to, message };
  } catch (err) {
    if (isFrameDetachedError(err)) {
      logger.warn(`[WhatsApp] Frame detached while sending to ${to} — triggering restart`);
      triggerRestart("frame detached");
    } else if (state !== "READY" && process.env.ENABLE_WHATSAPP === "true") {
      scheduleReconnect("send while not ready");
    }
    throw err;
  }
}

/**
 * Send a pre-approved Meta template message (Marketing/Utility/Authentication).
 * Cloud API only — a template is meaningless for the other providers, and
 * silently falling back to free text for a cold contact is exactly the
 * unsolicited-messaging pattern that gets WhatsApp numbers banned. Fail loud
 * instead so a campaign can never accidentally cold-message through Green API.
 */
export async function sendWhatsAppTemplate(
  phone: string,
  templateName: string,
  languageCode: string,
  options?: {
    bodyParams?: string[];
    documentHeader?: { mediaId: string; filename: string };
  },
): Promise<{ to: string; idMessage?: string }> {
  const prov = assertCanSend();
  if (prov !== "cloud") {
    throw new AppError(
      "قوالب الرسائل (Templates) مدعومة بس مع Meta Cloud API — المزوّد الحالي لا يدعمها",
      400,
      "WHATSAPP_TEMPLATE_REQUIRES_CLOUD",
    );
  }

  const components: Record<string, unknown>[] = [];
  if (options?.documentHeader) {
    components.push({
      type: "header",
      parameters: [{
        type: "document",
        document: { id: options.documentHeader.mediaId, filename: options.documentHeader.filename },
      }],
    });
  }
  if (options?.bodyParams?.length) {
    components.push({
      type: "body",
      parameters: options.bodyParams.map((text) => ({ type: "text", text })),
    });
  }

  const to = normalizeCloudPhone(phone);
  const idMessage = await sendCloudMessage({
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length ? { components } : {}),
    },
  });

  // Templates have no free-text body we can reconstruct exactly — log a
  // readable summary (name + filled-in body params) so the send still shows
  // up in the chat thread instead of vanishing silently. Skipped when a
  // document header is attached — sendWhatsAppTemplatePdf logs the richer
  // document version itself (same idMessage, so this would otherwise just be
  // ignored as a dedup no-op — better to not race the two at all).
  if (!options?.documentHeader) {
    const summary = [`📋 ${templateName}`, ...(options?.bodyParams ?? [])].join(" — ");
    await logChatMessage({ phone: to, direction: "OUT", text: summary, waMessageId: idMessage }).catch(() => {});
  }

  return { to, idMessage };
}

/**
 * Upload a PDF and send it as the document header of an approved template —
 * the Cloud-API-safe replacement for sendWhatsAppPdf's free-text caption when
 * the recipient hasn't messaged within the last 24h (e.g. a brand-new number
 * with no prior conversation history, where free text is always rejected).
 */
export async function sendWhatsAppTemplatePdf(
  phone: string,
  templateName: string,
  languageCode: string,
  pdf: Buffer,
  filename: string,
  bodyParams?: string[],
): Promise<{ to: string; idMessage?: string }> {
  const mediaId = await uploadCloudMedia(pdf, filename);
  const result = await sendWhatsAppTemplate(phone, templateName, languageCode, {
    bodyParams,
    documentHeader: { mediaId, filename },
  });

  const summary = [`📋 ${templateName}`, ...(bodyParams ?? [])].join(" — ");
  await logChatMessage({
    phone: result.to,
    direction: "OUT",
    text: summary,
    waMessageId: result.idMessage,
    mediaType: "DOCUMENT",
    mediaDataUrl: outboundMediaDataUrl(pdf, "application/pdf"),
    mediaFilename: filename,
    mediaMimeType: "application/pdf",
  }).catch(() => {});

  return result;
}

/**
 * Send a PDF document, trying an approved Meta document-header template first
 * (survives the 24h window) and falling back to a plain PDF caption send when
 * the template isn't configured/approved or the provider isn't Cloud. Same
 * safety contract as the invoice send — never worse than the free-text path.
 */
export async function sendPdfWithTemplateFallback(
  phone: string,
  templateName: string | undefined,
  languageCode: string,
  caption: string,
  pdf: Buffer,
  filename: string,
  bodyParams: string[],
  channel?: WhatsAppSendChannel,
): Promise<{ to: string; idMessage?: string }> {
  // Personal channel = Green API — templates are Cloud-only, go straight to
  // the plain PDF send through the personal number.
  if (channel === "personal") {
    return sendWhatsAppPdf(phone, caption, pdf, filename, { channel });
  }
  const status = getWhatsAppStatus();
  if ((channel !== "official" && status.activeProvider !== "cloud") || !templateName?.trim()) {
    return sendWhatsAppPdf(phone, caption, pdf, filename, { channel });
  }
  try {
    return await sendWhatsAppTemplatePdf(phone, templateName, languageCode, pdf, filename, bodyParams);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn(`[WhatsApp] PDF template "${templateName}" failed, falling back to free text: ${detail}`);
    await recordError({
      source: ErrorLogSource.WHATSAPP,
      code: "WHATSAPP_TEMPLATE_FAILED",
      message: `فشل قالب "${templateName}" — ${detail}`,
      context: { templateName, kind: "pdf" },
    }).catch(() => {});
    return sendWhatsAppPdf(phone, caption, pdf, filename, { channel });
  }
}

/**
 * Send a plain text message, trying an approved Meta text template first
 * (survives the 24h window) and falling back to free text when the template
 * isn't configured/approved or the provider isn't Cloud. Text-only sibling of
 * sendPdfWithTemplateFallback — shared by every non-PDF notification send
 * outside whatsapp.controller.ts (OTP, catalog access, order status, product
 * arrival, debt/inactive reminders) so none of them duplicate the try/catch.
 */
// Shared by every send that reuses the single approved invoice template
// (regular invoice, customer-safe image invoice, order-approved, and
// order-prepared notifications) — a Meta template has one fixed body shape,
// so all four call sites must supply params in this exact order.
// The approved Meta template has exactly 9 variables — currency is baked
// into the template text (د.ع), NOT a variable, so it is NOT sent here.
// Sending a 10th param triggers Meta error #132000 (param count mismatch),
// which silently falls back to free text and then vanishes outside the 24h
// window. Keep this at 9 params matching the template:
// {{1}} customerName, {{2}} invoiceNumber, {{3}} date, {{4}} totalAmount,
// {{5}} paidAmount, {{6}} remainingAmount, {{7}} previousBalance,
// {{8}} finalBalance, {{9}} storeName.
/** Thousands-separated, English digits — matches the free-text message the
 *  clients build, so the SAME invoice reads identically on both send paths.
 *  Raw String(1250000) used to reach the customer as "1250000". */
function money(value: unknown): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "0";
}

/** Balance with a direction word, mirroring balanceForCustomer() on the
 *  clients: the stored sign is an internal convention and a bare "-500,000"
 *  means nothing to the person reading the message. */
export function balanceForCustomer(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "0";
  const amount = Math.abs(n).toLocaleString("en-US");
  return n > 0 ? `عليك ${amount}` : `لك ${amount}`;
}

export function invoiceTemplateBodyParams(invoice: Awaited<ReturnType<typeof getInvoiceById>>, storeName: string): string[] {
  return [
    invoice.customer.name,
    invoice.invoiceNumber,
    // Fixed ISO-style date. toLocaleDateString() with no locale follows the
    // SERVER's locale, so the same invoice showed a different date format here
    // than in the free-text message the client builds.
    new Date(invoice.date).toISOString().slice(0, 10),
    money(invoice.totalAmount),
    money(invoice.paidAmount),
    money(invoice.remainingAmount),
    balanceForCustomer(invoice.previousBalance),
    balanceForCustomer(invoice.finalBalance),
    storeName,
  ];
}

export async function sendTextWithTemplateFallback(
  phone: string,
  templateName: string | undefined,
  languageCode: string,
  message: string,
  bodyParams: string[] = [],
  channel?: WhatsAppSendChannel,
): Promise<{ to: string; idMessage?: string }> {
  if (channel === "personal") {
    return sendWhatsAppText(phone, message, { channel });
  }
  const status = getWhatsAppStatus();
  if ((channel !== "official" && status.activeProvider !== "cloud") || !templateName?.trim()) {
    return sendWhatsAppText(phone, message, { channel });
  }
  try {
    return await sendWhatsAppTemplate(phone, templateName, languageCode, { bodyParams });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn(`[WhatsApp] text template "${templateName}" failed, falling back to free text: ${detail}`);
    await recordError({
      source: ErrorLogSource.WHATSAPP,
      code: "WHATSAPP_TEMPLATE_FAILED",
      message: `فشل قالب "${templateName}" — ${detail}`,
      context: { templateName, kind: "text" },
    }).catch(() => {});
    return sendWhatsAppText(phone, message, { channel });
  }
}


/** Inline base64 data URL for outbound media, capped the same as inbound downloads — null if too large to store. */
function outboundMediaDataUrl(buf: Buffer, mimeType: string): string | null {
  if (buf.byteLength > MAX_INLINE_MEDIA_BYTES) return null;
  return `data:${mimeType};base64,${buf.toString("base64")}`;
}

/** Send any document (PDF/Excel/Word/…) with a caption. Mime drives both the
 * Cloud upload type and the inline chat-log preview. */
export async function sendWhatsAppDocument(
  phone: string,
  message: string,
  doc: Buffer,
  filename: string,
  mime = "application/pdf",
  opts?: { channel?: WhatsAppSendChannel },
): Promise<{ to: string; filename: string; idMessage?: string }> {
  const prov = resolveSendProvider(opts?.channel);
  if (opts?.channel === "personal") await takePersonalSendSlot();
  const logDoc = (to: string, idMessage?: string) =>
    logChatMessage({
      phone: to,
      direction: "OUT",
      text: message,
      waMessageId: idMessage,
      mediaType: "DOCUMENT",
      mediaDataUrl: outboundMediaDataUrl(doc, mime),
      mediaFilename: filename,
      mediaMimeType: mime,
    }).catch(() => {});

  if (prov === "greenapi") {
    await sendGreenApiDocument(phone, doc, filename, message);
    await logDoc(phone);
    return { to: phone, filename };
  }

  if (prov === "cloud") {
    const to = normalizeCloudPhone(phone);
    const mediaId = await uploadCloudMedia(doc, filename, mime);
    const idMessage = await sendCloudMessage({
      to,
      type: "document",
      document: {
        id: mediaId,
        filename,
        caption: message,
      },
    });
    await logDoc(to, idMessage);
    return { to, filename, idMessage };
  }

  const to = normalizePhone(phone);

  try {
    const readyClient = requireReadyClient();
    const media = new MessageMedia(mime, doc.toString("base64"), filename);
    await readyClient.sendMessage(to, media, { caption: message });
    await logDoc(to);
    return { to, filename };
  } catch (err) {
    if (isFrameDetachedError(err)) {
      logger.warn(`[WhatsApp] Frame detached while sending document to ${to} — triggering restart`);
      triggerRestart("frame detached");
    } else if (state !== "READY" && process.env.ENABLE_WHATSAPP === "true") {
      scheduleReconnect("send document while not ready");
    }
    throw err;
  }
}

export async function sendWhatsAppPdf(
  phone: string,
  message: string,
  pdf: Buffer,
  filename: string,
  opts?: { channel?: WhatsAppSendChannel },
): Promise<{ to: string; filename: string }> {
  return sendWhatsAppDocument(phone, message, pdf, filename, "application/pdf", opts);
}

/** Send a voice note (Cloud API only — the chat screen is Cloud-based).
 * Meta accepts aac/m4a/mp3/ogg-opus; the recorder picks a supported mime. */
export async function sendWhatsAppAudio(
  phone: string,
  audio: Buffer,
  mime: string,
): Promise<{ to: string; idMessage?: string }> {
  const prov = assertCanSend();
  if (prov !== "cloud") {
    throw new AppError("الرسائل الصوتية مدعومة فقط مع Meta Cloud API", 400, "WHATSAPP_AUDIO_CLOUD_ONLY");
  }
  const to = normalizeCloudPhone(phone);
  const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("mpeg") ? "mp3" : "aac";
  const mediaId = await uploadCloudMedia(audio, `voice.${ext}`, mime);
  const idMessage = await sendCloudMessage({ to, type: "audio", audio: { id: mediaId } });
  await logChatMessage({
    phone: to,
    direction: "OUT",
    text: "",
    waMessageId: idMessage,
    mediaType: "AUDIO",
    mediaDataUrl: outboundMediaDataUrl(audio, mime),
    mediaMimeType: mime,
  }).catch(() => {});
  return { to, idMessage };
}

/** React to a message with an emoji (empty string removes the reaction). */
export async function sendWhatsAppReaction(phone: string, waMessageId: string, emoji: string): Promise<void> {
  const prov = assertCanSend();
  if (prov !== "cloud") {
    throw new AppError("التفاعلات مدعومة فقط مع Meta Cloud API", 400, "WHATSAPP_REACTION_CLOUD_ONLY");
  }
  const to = normalizeCloudPhone(phone);
  await sendCloudMessage({ to, type: "reaction", reaction: { message_id: waMessageId, emoji } });
}

export async function sendWhatsAppImage(
  phone: string,
  message: string,
  image: Buffer,
  mime = "image/jpeg",
  opts?: { channel?: WhatsAppSendChannel },
): Promise<{ to: string; idMessage?: string }> {
  const prov = resolveSendProvider(opts?.channel);
  if (opts?.channel === "personal") await takePersonalSendSlot();
  const logImage = (to: string, idMessage?: string) =>
    logChatMessage({
      phone: to,
      direction: "OUT",
      text: message,
      waMessageId: idMessage,
      mediaType: "IMAGE",
      mediaDataUrl: outboundMediaDataUrl(image, mime),
      mediaMimeType: mime,
    }).catch(() => {});

  if (prov === "greenapi") {
    const { idMessage } = await sendGreenApiImage(phone, image, mime, message);
    await logImage(phone, idMessage);
    return { to: phone, idMessage };
  }

  if (prov === "cloud") {
    const to = normalizeCloudPhone(phone);
    const mediaId = await uploadCloudImage(image, mime);
    const idMessage = await sendCloudMessage({
      to,
      type: "image",
      image: { id: mediaId, caption: message },
    });
    await logImage(to, idMessage);
    return { to, idMessage };
  }

  const to = normalizePhone(phone);
  try {
    const readyClient = requireReadyClient();
    const media = new MessageMedia(mime, image.toString("base64"), "image.jpg");
    await readyClient.sendMessage(to, media, { caption: message });
    await logImage(to);
    return { to };
  } catch (err) {
    if (isFrameDetachedError(err)) {
      triggerRestart("frame detached");
    } else if (state !== "READY" && process.env.ENABLE_WHATSAPP === "true") {
      scheduleReconnect("send image while not ready");
    }
    throw err;
  }
}
