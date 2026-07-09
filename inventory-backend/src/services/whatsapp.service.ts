import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import qrcode from "qrcode";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";

type WhatsAppState = "INITIALIZING" | "QR" | "READY" | "AUTH_FAILURE" | "DISCONNECTED" | "ERROR";
export type WhatsAppProvider = "web" | "cloud" | "greenapi" | "manual" | "disabled";
export type WhatsAppStatusCode = "ready" | "missing_settings" | "failed" | "disabled" | "manual_only";

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
}) {
  setCloudCredentials(s.whatsappCloudToken ?? "", s.whatsappCloudPhoneNumberId ?? "", s.whatsappProvider);
  setGreenApiCredentials(s.greenApiInstanceId ?? "", s.greenApiToken ?? "");
  _dbGreenBaseUrl = s.greenApiBaseUrl?.trim() ?? "";
  _dbCloudBusinessAccountId = s.whatsappCloudBusinessAccountId?.trim() ?? "";
  _dbCloudVerifyToken = s.whatsappCloudVerifyToken?.trim() ?? "";
  _dbCloudAppSecret = s.whatsappCloudAppSecret?.trim() ?? "";
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

async function uploadCloudMedia(pdf: Buffer, filename: string) {
  const { token, baseUrl } = cloudConfig();
  const bytes = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append("file", new Blob([bytes], { type: "application/pdf" }), filename);

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

/** Send a text message. */
export async function sendWhatsAppText(phone: string, message: string): Promise<{ to: string; message: string; idMessage?: string }> {
  const prov = assertCanSend();

  if (prov === "greenapi") {
    const { idMessage } = await sendGreenApiText(phone, message);
    return { to: phone, message, idMessage };
  }

  if (prov === "cloud") {
    const to = normalizeCloudPhone(phone);
    const idMessage = await sendCloudMessage({
      to,
      type: "text",
      text: { preview_url: false, body: message },
    });
    return { to, message, idMessage };
  }

  const to = normalizePhone(phone);

  try {
    const readyClient = requireReadyClient();
    await readyClient.sendMessage(to, message);
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
  return sendWhatsAppTemplate(phone, templateName, languageCode, {
    bodyParams,
    documentHeader: { mediaId, filename },
  });
}

export async function sendWhatsAppPdf(
  phone: string,
  message: string,
  pdf: Buffer,
  filename: string,
): Promise<{ to: string; filename: string }> {
  const prov = assertCanSend();

  if (prov === "greenapi") {
    await sendGreenApiDocument(phone, pdf, filename, message);
    return { to: phone, filename };
  }

  if (prov === "cloud") {
    const to = normalizeCloudPhone(phone);
    const mediaId = await uploadCloudMedia(pdf, filename);
    await sendCloudMessage({
      to,
      type: "document",
      document: {
        id: mediaId,
        filename,
        caption: message,
      },
    });
    return { to, filename };
  }

  const to = normalizePhone(phone);

  try {
    const readyClient = requireReadyClient();
    const media = new MessageMedia("application/pdf", pdf.toString("base64"), filename);
    await readyClient.sendMessage(to, media, { caption: message });
    return { to, filename };
  } catch (err) {
    if (isFrameDetachedError(err)) {
      logger.warn(`[WhatsApp] Frame detached while sending PDF to ${to} — triggering restart`);
      triggerRestart("frame detached");
    } else if (state !== "READY" && process.env.ENABLE_WHATSAPP === "true") {
      scheduleReconnect("send PDF while not ready");
    }
    throw err;
  }
}

export async function sendWhatsAppImage(
  phone: string,
  message: string,
  image: Buffer,
  mime = "image/jpeg",
): Promise<{ to: string; idMessage?: string }> {
  const prov = assertCanSend();

  if (prov === "greenapi") {
    const { idMessage } = await sendGreenApiImage(phone, image, mime, message);
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
    return { to, idMessage };
  }

  const to = normalizePhone(phone);
  try {
    const readyClient = requireReadyClient();
    const media = new MessageMedia(mime, image.toString("base64"), "image.jpg");
    await readyClient.sendMessage(to, media, { caption: message });
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
