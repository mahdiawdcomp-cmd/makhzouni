import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import qrcode from "qrcode";
import fs from "node:fs";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";

type WhatsAppState = "INITIALIZING" | "QR" | "READY" | "AUTH_FAILURE" | "DISCONNECTED" | "ERROR";

let client: Client | null = null;
let state: WhatsAppState = "DISCONNECTED";
let lastQr: string | null = null;
let lastQrDataUrl: string | null = null;
let lastError: string | null = null;
let initialized = false;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;

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

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) throw new AppError("Invalid phone number", 422, "INVALID_PHONE");
  return `${digits}@c.us`;
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

function triggerRestart() {
  state = "DISCONNECTED";
  initialized = false;
  stopKeepAlive();
  if (client) {
    client.destroy().catch(() => {});
    client = null;
  }
  if (reconnectAttempts < MAX_RECONNECT) {
    reconnectAttempts++;
    const delay = reconnectAttempts * 10_000;
    logger.info(`[WhatsApp] Restarting in ${delay / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT})`);
    setTimeout(() => initializeWhatsApp(), delay);
  } else {
    logger.warn("[WhatsApp] Max reconnect attempts reached. Scan QR again.");
  }
}

export function initializeWhatsApp() {
  if (initialized) return;
  initialized = true;
  state = "INITIALIZING";

  const chromePath = resolveChromePath();
  if (chromePath === null) {
    state = "ERROR";
    lastError = "CHROME_PATH is configured but the file was not found";
    return;
  }

  client = new Client({
    authStrategy: new LocalAuth({ clientId: "inventory-backend" }),
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
        "--no-zygote",
        "--single-process",
        "--disable-extensions",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
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
    if (reconnectAttempts < MAX_RECONNECT) {
      reconnectAttempts++;
      const delay = reconnectAttempts * 10_000;
      logger.info(`[WhatsApp] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT})`);
      setTimeout(() => initializeWhatsApp(), delay);
    } else {
      logger.warn("[WhatsApp] Max reconnect attempts reached. Scan QR again.");
    }
  });

  const initPromise = client.initialize();
  initPromise.catch((error: unknown) => {
    state = "ERROR";
    lastError = error instanceof Error ? error.message : String(error);
    logger.warn(`[WhatsApp] initialize() failed: ${lastError}`);
  });
  initPromise.then(() => {}).catch(() => {});
}

export function getWhatsAppStatus() {
  return {
    initialized,
    state,
    isReady: state === "READY",
    qr: lastQr,
    qrDataUrl: lastQrDataUrl,
    error: lastError,
  };
}

function requireReadyClient() {
  if (!client || state !== "READY") {
    throw new AppError("WhatsApp is not connected yet", 503, "WHATSAPP_NOT_READY");
  }
  return client;
}

export async function restartWhatsApp() {
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
  initializeWhatsApp();
}

/** Send a text message. Auto-restarts WhatsApp if the page frame is dead. */
export async function sendWhatsAppText(phone: string, message: string): Promise<{ to: string; message: string }> {
  const readyClient = requireReadyClient();
  const to = normalizePhone(phone);

  try {
    await readyClient.sendMessage(to, message);
    return { to, message };
  } catch (err) {
    if (isFrameDetachedError(err)) {
      logger.warn(`[WhatsApp] Frame detached while sending to ${to} — triggering restart`);
      triggerRestart();
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
  const readyClient = requireReadyClient();
  const to = normalizePhone(phone);

  try {
    const media = new MessageMedia("application/pdf", pdf.toString("base64"), filename);
    await readyClient.sendMessage(to, media, { caption: message });
    return { to, filename };
  } catch (err) {
    if (isFrameDetachedError(err)) {
      logger.warn(`[WhatsApp] Frame detached while sending PDF to ${to} — triggering restart`);
      triggerRestart();
    }
    throw err;
  }
}
