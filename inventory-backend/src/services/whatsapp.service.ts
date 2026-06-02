import { Client, LocalAuth, MessageMedia } from "whatsapp-web.js";
import qrcode from "qrcode";
import fs from "node:fs";
import { AppError } from "../utils/app-error";

type WhatsAppState = "INITIALIZING" | "QR" | "READY" | "AUTH_FAILURE" | "DISCONNECTED" | "ERROR";

let client: Client | null = null;
let state: WhatsAppState = "DISCONNECTED";
let lastQr: string | null = null;
let lastQrDataUrl: string | null = null;
let lastError: string | null = null;
let initialized = false;

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");

  if (!digits) {
    throw new AppError("Invalid phone number", 422, "INVALID_PHONE");
  }

  return `${digits}@c.us`;
}

export function initializeWhatsApp() {
  if (initialized) return;
  initialized = true;
  state = "INITIALIZING";

  const chromePath =
    "C:\\Users\\IRAQ CELL\\.cache\\puppeteer\\chrome\\win64-146.0.7680.31\\chrome-win64\\chrome.exe";

  client = new Client({
    authStrategy: new LocalAuth({
      clientId: "inventory-backend",
    }),
    puppeteer: {
      headless: true,
      executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
      timeout: 120000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
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
  });

  client.on("auth_failure", (message) => {
    state = "AUTH_FAILURE";
    lastError = message;
  });

  client.on("disconnected", (reason) => {
    state = "DISCONNECTED";
    lastError = reason;
  });

  client.initialize().catch((error: unknown) => {
    state = "ERROR";
    lastError = error instanceof Error ? error.message : String(error);
  });
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

export async function sendWhatsAppText(phone: string, message: string) {
  const readyClient = requireReadyClient();
  const to = normalizePhone(phone);
  await readyClient.sendMessage(to, message);

  return {
    to,
    message,
  };
}

export async function sendWhatsAppPdf(
  phone: string,
  message: string,
  pdf: Buffer,
  filename: string
) {
  const readyClient = requireReadyClient();
  const to = normalizePhone(phone);
  const media = new MessageMedia(
    "application/pdf",
    pdf.toString("base64"),
    filename
  );
  await readyClient.sendMessage(to, media, { caption: message });

  return {
    to,
    filename,
  };
}
