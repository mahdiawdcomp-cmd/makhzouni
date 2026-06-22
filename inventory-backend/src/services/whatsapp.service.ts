import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import qrcode from "qrcode";
import fs from "node:fs";
import path from "node:path";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";

type WhatsAppState = "INITIALIZING" | "QR" | "READY" | "AUTH_FAILURE" | "DISCONNECTED" | "ERROR";
type WhatsAppProvider = "web" | "cloud" | "greenapi";

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

/** Called by settings service when credentials change, and at server startup */
export function setCloudCredentials(token: string, phoneNumberId: string, providerOverride?: string) {
  _dbCloudToken = token?.trim() ?? "";
  _dbCloudPhoneNumberId = phoneNumberId?.trim() ?? "";
  _dbProviderOverride =
    providerOverride === "cloud" ? "cloud" :
    providerOverride === "greenapi" ? "greenapi" :
    providerOverride === "web" ? "web" :
    null;
}

export function setGreenApiCredentials(instanceId: string, token: string) {
  _greenApiInstanceId = instanceId?.trim() ?? "";
  _greenApiToken = token?.trim() ?? "";
}

function provider(): WhatsAppProvider {
  // env override takes priority
  const configured = process.env.WHATSAPP_PROVIDER?.trim().toLowerCase();
  if (configured === "greenapi") return "greenapi";
  if (configured === "cloud") return "cloud";

  // DB override
  if (_dbProviderOverride === "greenapi") return "greenapi";
  if (_dbProviderOverride === "cloud") return "cloud";

  // auto-detect from credentials
  const hasGreenApi = Boolean(
    (process.env.GREENAPI_INSTANCE_ID?.trim() || _greenApiInstanceId) &&
    (process.env.GREENAPI_TOKEN?.trim() || _greenApiToken),
  );
  if (hasGreenApi) return "greenapi";

  const hasCloud = Boolean(
    (process.env.WHATSAPP_CLOUD_TOKEN?.trim() || _dbCloudToken) &&
    (process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID?.trim() || _dbCloudPhoneNumberId),
  );
  if (hasCloud) return "cloud";

  return "web";
}

function whatsappEnabled() {
  if (process.env.ENABLE_WHATSAPP === "true") return true;
  // Auto-enable when Cloud API or GreenAPI credentials are configured via Settings
  const hasCloud = Boolean(_dbCloudToken && _dbCloudPhoneNumberId);
  const hasGreen = Boolean(_greenApiInstanceId && _greenApiToken);
  return hasCloud || hasGreen;
}

// ── Green API ────────────────────────────────────────────────────────────────

function greenApiConfig() {
  const instanceId = process.env.GREENAPI_INSTANCE_ID?.trim() || _greenApiInstanceId;
  const token = process.env.GREENAPI_TOKEN?.trim() || _greenApiToken;
  if (!instanceId || !token) throw new AppError("Green API is not configured", 503, "GREENAPI_NOT_CONFIGURED");
  return { instanceId, token, baseUrl: `https://api.green-api.com/waInstance${instanceId}` };
}

function normalizeGreenPhone(phone: string) {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `964${digits.slice(1)}`;
  if (digits.startsWith("7")) digits = `964${digits}`;
  return `${digits}@c.us`;
}

async function sendGreenApiText(phone: string, message: string) {
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

async function sendGreenApiImage(phone: string, image: Buffer, mime: string, caption: string) {
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
  const token = process.env.WHATSAPP_CLOUD_TOKEN?.trim() || _dbCloudToken;
  const phoneNumberId = process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID?.trim() || _dbCloudPhoneNumberId;
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

async function sendCloudMessage(payload: Record<string, unknown>) {
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
  if (provider() === "cloud") {
    state = "READY";
    initialized = true;
    lastError = null;
    logger.info("[WhatsApp] Cloud API provider ready");
    return;
  }

  if (provider() === "greenapi") {
    state = "READY";
    initialized = true;
    lastError = null;
    logger.info("[WhatsApp] Green API provider ready");
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
  const currentProvider = provider();
  const cloudConfigured = Boolean(
    (process.env.WHATSAPP_CLOUD_TOKEN?.trim() || _dbCloudToken) &&
    (process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID?.trim() || _dbCloudPhoneNumberId),
  );
  return {
    provider: currentProvider,
    enabled: whatsappEnabled(),
    cloudConfigured,
    initialized,
    state,
    isReady: whatsappEnabled() && (currentProvider === "cloud" ? cloudConfigured : state === "READY"),
    qr: currentProvider === "cloud" ? null : lastQr,
    qrDataUrl: currentProvider === "cloud" ? null : lastQrDataUrl,
    error: !whatsappEnabled()
      ? "ENABLE_WHATSAPP is not true"
      : currentProvider === "cloud" && !cloudConfigured
        ? "WhatsApp Cloud token or phone number id is missing"
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
  if (provider() === "cloud") {
    state = "READY";
    initialized = true;
    lastQr = null;
    lastQrDataUrl = null;
    lastError = null;
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
export async function sendWhatsAppText(phone: string, message: string): Promise<{ to: string; message: string }> {
  if (!whatsappEnabled()) {
    throw new AppError("WhatsApp is disabled. Set ENABLE_WHATSAPP=true", 503, "WHATSAPP_DISABLED");
  }

  const prov = provider();

  if (prov === "greenapi") {
    await sendGreenApiText(phone, message);
    return { to: phone, message };
  }

  if (prov === "cloud") {
    const to = normalizeCloudPhone(phone);
    await sendCloudMessage({
      to,
      type: "text",
      text: { preview_url: false, body: message },
    });
    return { to, message };
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

export async function sendWhatsAppPdf(
  phone: string,
  message: string,
  pdf: Buffer,
  filename: string,
): Promise<{ to: string; filename: string }> {
  if (!whatsappEnabled()) {
    throw new AppError("WhatsApp is disabled. Set ENABLE_WHATSAPP=true", 503, "WHATSAPP_DISABLED");
  }

  const prov = provider();

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
): Promise<{ to: string }> {
  if (!whatsappEnabled()) {
    throw new AppError("WhatsApp is disabled. Set ENABLE_WHATSAPP=true", 503, "WHATSAPP_DISABLED");
  }

  const prov = provider();

  if (prov === "greenapi") {
    await sendGreenApiImage(phone, image, mime, message);
    return { to: phone };
  }

  if (prov === "cloud") {
    const to = normalizeCloudPhone(phone);
    const mediaId = await uploadCloudImage(image, mime);
    await sendCloudMessage({
      to,
      type: "image",
      image: { id: mediaId, caption: message },
    });
    return { to };
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
