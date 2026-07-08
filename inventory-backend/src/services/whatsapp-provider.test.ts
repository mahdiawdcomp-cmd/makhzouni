import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  syncWhatsAppSettings,
  getWhatsAppStatus,
  sendWhatsAppText,
  generateVerifyToken,
  getCloudWebhookConfig,
} from "./whatsapp.service";

// These tests exercise the pure provider-resolution + status logic. They never
// hit the network: greenapi/cloud sends would call fetch, so the send-guard
// tests only assert the *blocking* providers (manual/disabled) which throw
// before any fetch.

const ENV_KEYS = [
  "WHATSAPP_PROVIDER",
  "ENABLE_WHATSAPP",
  "GREENAPI_INSTANCE_ID",
  "GREENAPI_TOKEN",
  "GREENAPI_BASE_URL",
  "WHATSAPP_CLOUD_TOKEN",
  "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
  "WHATSAPP_CLOUD_VERIFY_TOKEN",
  "WHATSAPP_CLOUD_APP_SECRET",
];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  // Reset all DB-sourced overrides to empty between tests.
  syncWhatsAppSettings({});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  syncWhatsAppSettings({});
});

test("empty tenant (no env, no DB) → web provider, not ready, missing_settings", () => {
  const s = getWhatsAppStatus();
  assert.equal(s.provider, "web");
  assert.equal(s.status, "missing_settings");
  assert.equal(s.isReady, false);
});

test("DB provider=manual → manual_only status", () => {
  syncWhatsAppSettings({ whatsappProvider: "manual" });
  const s = getWhatsAppStatus();
  assert.equal(s.provider, "manual");
  assert.equal(s.status, "manual_only");
});

test("DB provider=disabled → disabled status", () => {
  syncWhatsAppSettings({ whatsappProvider: "disabled" });
  const s = getWhatsAppStatus();
  assert.equal(s.provider, "disabled");
  assert.equal(s.status, "disabled");
});

test("manual blocks silent sending with WHATSAPP_MANUAL_ONLY", async () => {
  syncWhatsAppSettings({ whatsappProvider: "manual" });
  await assert.rejects(
    () => sendWhatsAppText("9647700000000", "hi"),
    (err: unknown) => (err as { code?: string })?.code === "WHATSAPP_MANUAL_ONLY",
  );
});

test("disabled blocks silent sending with WHATSAPP_DISABLED", async () => {
  syncWhatsAppSettings({ whatsappProvider: "disabled" });
  await assert.rejects(
    () => sendWhatsAppText("9647700000000", "hi"),
    (err: unknown) => (err as { code?: string })?.code === "WHATSAPP_DISABLED",
  );
});

test("DB greenapi credentials → greenapi provider, ready", () => {
  syncWhatsAppSettings({
    whatsappProvider: "greenapi",
    greenApiInstanceId: "1101",
    greenApiToken: "tok",
  });
  const s = getWhatsAppStatus();
  assert.equal(s.provider, "greenapi");
  assert.equal(s.status, "ready");
  assert.equal(s.greenConfigured, true);
});

test("DB greenapi selected but no credentials → missing_settings", () => {
  syncWhatsAppSettings({ whatsappProvider: "greenapi" });
  const s = getWhatsAppStatus();
  assert.equal(s.provider, "greenapi");
  assert.equal(s.status, "missing_settings");
  assert.match(String(s.error), /Green API/);
});

test("DB cloud credentials → cloud provider, ready", () => {
  syncWhatsAppSettings({
    whatsappProvider: "cloud",
    whatsappCloudToken: "EAAtoken",
    whatsappCloudPhoneNumberId: "123456",
  });
  const s = getWhatsAppStatus();
  assert.equal(s.provider, "cloud");
  assert.equal(s.status, "ready");
  assert.equal(s.cloudConfigured, true);
});

test("DB cloud selected but no credentials → missing_settings with clear error", () => {
  syncWhatsAppSettings({ whatsappProvider: "cloud" });
  const s = getWhatsAppStatus();
  assert.equal(s.status, "missing_settings");
  assert.match(String(s.error), /Cloud API/);
});

test("env fallback: GREENAPI_* set, DB empty → greenapi auto-detected", () => {
  process.env.GREENAPI_INSTANCE_ID = "2202";
  process.env.GREENAPI_TOKEN = "envtok";
  syncWhatsAppSettings({}); // DB empty → default legacy "web" sentinel
  const s = getWhatsAppStatus();
  assert.equal(s.provider, "greenapi");
  assert.equal(s.status, "ready");
});

test("DB explicit cloud beats env greenapi credentials", () => {
  process.env.GREENAPI_INSTANCE_ID = "2202";
  process.env.GREENAPI_TOKEN = "envtok";
  syncWhatsAppSettings({
    whatsappProvider: "cloud",
    whatsappCloudToken: "EAAtoken",
    whatsappCloudPhoneNumberId: "123456",
  });
  assert.equal(getWhatsAppStatus().provider, "cloud");
});

test("DB explicit provider WINS over env WHATSAPP_PROVIDER (saved cloud must not fall back to env Green)", () => {
  process.env.WHATSAPP_PROVIDER = "greenapi";
  process.env.GREENAPI_INSTANCE_ID = "2202";
  process.env.GREENAPI_TOKEN = "envtok";
  syncWhatsAppSettings({
    whatsappProvider: "cloud",
    whatsappCloudToken: "EAAtoken",
    whatsappCloudPhoneNumberId: "123456",
  });
  const s = getWhatsAppStatus();
  assert.equal(s.activeProvider, "cloud");
  assert.equal(s.providerSource, "db");
});

test("DB cloud + valid creds + Green env present → activeProvider is cloud, ready", () => {
  process.env.GREENAPI_INSTANCE_ID = "2202"; // deleted/dead env Green instance
  process.env.GREENAPI_TOKEN = "envtok";
  syncWhatsAppSettings({
    whatsappProvider: "cloud",
    whatsappCloudToken: "EAAtoken",
    whatsappCloudPhoneNumberId: "123456",
  });
  const s = getWhatsAppStatus();
  assert.equal(s.activeProvider, "cloud");
  assert.equal(s.status, "ready");
  assert.deepEqual(s.missingFields, []);
});

test("DB cloud missing token (Green env present) → cloud missing_settings, NOT green fallback", () => {
  process.env.GREENAPI_INSTANCE_ID = "2202";
  process.env.GREENAPI_TOKEN = "envtok";
  syncWhatsAppSettings({ whatsappProvider: "cloud", whatsappCloudPhoneNumberId: "123456" });
  const s = getWhatsAppStatus();
  assert.equal(s.activeProvider, "cloud");
  assert.equal(s.status, "missing_settings");
  assert.deepEqual(s.missingFields, ["Access Token"]);
});

test("test send uses the active (DB cloud) provider, not env Green", async () => {
  // env Green is 'deleted'; DB explicit cloud with no creds → send must fail as
  // CLOUD not configured (proving it routed to cloud, not the env Green path).
  // ENABLE_WHATSAPP lets it past the enabled gate so it reaches the cloud branch.
  process.env.ENABLE_WHATSAPP = "true";
  process.env.GREENAPI_INSTANCE_ID = "2202";
  process.env.GREENAPI_TOKEN = "envtok";
  syncWhatsAppSettings({ whatsappProvider: "cloud" });
  await assert.rejects(
    () => sendWhatsAppText("9647700000000", "hi"),
    (err: unknown) => (err as { code?: string })?.code === "WHATSAPP_CLOUD_NOT_CONFIGURED",
  );
});

test("selectedProvider reflects the saved DB choice", () => {
  syncWhatsAppSettings({ whatsappProvider: "cloud", whatsappCloudToken: "t", whatsappCloudPhoneNumberId: "p" });
  assert.equal(getWhatsAppStatus().selectedProvider, "cloud");
});

test("legacy: DB provider=web with env greenapi creds still auto-detects greenapi", () => {
  // Reproduces existing production tenants who saved "web" long ago but rely on
  // env Green API. Must NOT break: "web" falls through to auto-detect.
  process.env.GREENAPI_INSTANCE_ID = "2202";
  process.env.GREENAPI_TOKEN = "envtok";
  syncWhatsAppSettings({ whatsappProvider: "web" });
  assert.equal(getWhatsAppStatus().provider, "greenapi");
});

test("verify token: env value overrides DB, generated tokens are unique", () => {
  syncWhatsAppSettings({ whatsappCloudVerifyToken: "db-token" });
  assert.equal(getCloudWebhookConfig().verifyToken, "db-token");
  process.env.WHATSAPP_CLOUD_VERIFY_TOKEN = "env-token";
  assert.equal(getCloudWebhookConfig().verifyToken, "env-token");

  const a = generateVerifyToken();
  const b = generateVerifyToken();
  assert.notEqual(a, b);
  assert.match(a, /^mkz_[0-9a-f]{36}$/);
});

test("providerSource: DB explicit choice → db", () => {
  syncWhatsAppSettings({ whatsappProvider: "greenapi", greenApiInstanceId: "1", greenApiToken: "t" });
  const s = getWhatsAppStatus();
  assert.equal(s.activeProvider, "greenapi");
  assert.equal(s.providerSource, "db");
});

test("providerSource: env WHATSAPP_PROVIDER → env", () => {
  process.env.WHATSAPP_PROVIDER = "greenapi";
  process.env.GREENAPI_INSTANCE_ID = "1";
  process.env.GREENAPI_TOKEN = "t";
  syncWhatsAppSettings({});
  const s = getWhatsAppStatus();
  assert.equal(s.activeProvider, "greenapi");
  assert.equal(s.providerSource, "env");
});

test("providerSource: env credential auto-detect (DB empty) → env", () => {
  process.env.GREENAPI_INSTANCE_ID = "1";
  process.env.GREENAPI_TOKEN = "t";
  syncWhatsAppSettings({ whatsappProvider: "web" }); // legacy default, falls through
  const s = getWhatsAppStatus();
  assert.equal(s.activeProvider, "greenapi");
  assert.equal(s.providerSource, "env");
});

test("providerSource: nothing configured → web/default", () => {
  syncWhatsAppSettings({});
  const s = getWhatsAppStatus();
  assert.equal(s.activeProvider, "web");
  assert.equal(s.providerSource, "default");
});

test("appSecretSet / verifyTokenSet flags reflect config", () => {
  syncWhatsAppSettings({
    whatsappProvider: "cloud",
    whatsappCloudToken: "t",
    whatsappCloudPhoneNumberId: "p",
    whatsappCloudVerifyToken: "vt",
    whatsappCloudAppSecret: "sec",
  });
  const s = getWhatsAppStatus();
  assert.equal(s.verifyTokenSet, true);
  assert.equal(s.appSecretSet, true);
});
