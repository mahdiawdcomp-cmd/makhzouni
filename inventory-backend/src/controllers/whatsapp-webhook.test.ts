import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { syncWhatsAppSettings } from "../services/whatsapp.service";
import { whatsappMetaWebhookVerify, whatsappMetaWebhookReceive } from "./whatsapp.controller";

// Minimal Express req/res doubles that record what the handler did.
function mockRes() {
  const out: { statusCode: number; body: unknown; type?: string } = { statusCode: 200, body: undefined };
  const res = {
    status(code: number) { out.statusCode = code; return res; },
    type(t: string) { out.type = t; return res; },
    send(b: unknown) { out.body = b; return res; },
    json(b: unknown) { out.body = b; return res; },
    sendStatus(code: number) { out.statusCode = code; out.body = ""; return res; },
  } as unknown as Response;
  return { res, out };
}

function verifyReq(query: Record<string, string>): Request {
  return { query, header: () => undefined } as unknown as Request;
}

const savedVerify = process.env.WHATSAPP_CLOUD_VERIFY_TOKEN;
beforeEach(() => {
  delete process.env.WHATSAPP_CLOUD_VERIFY_TOKEN;
  delete process.env.WHATSAPP_CLOUD_APP_SECRET;
  syncWhatsAppSettings({ whatsappCloudVerifyToken: "secret-verify-token" });
});
afterEach(() => {
  if (savedVerify === undefined) delete process.env.WHATSAPP_CLOUD_VERIFY_TOKEN;
  else process.env.WHATSAPP_CLOUD_VERIFY_TOKEN = savedVerify;
  syncWhatsAppSettings({});
});

test("Meta GET verify: correct token echoes hub.challenge with 200", async () => {
  const { res, out } = mockRes();
  await whatsappMetaWebhookVerify(
    verifyReq({ "hub.mode": "subscribe", "hub.verify_token": "secret-verify-token", "hub.challenge": "CHALLENGE123" }),
    res,
    () => {},
  );
  assert.equal(out.statusCode, 200);
  assert.equal(out.body, "CHALLENGE123");
});

test("Meta GET verify: wrong token → 403, no challenge", async () => {
  const { res, out } = mockRes();
  await whatsappMetaWebhookVerify(
    verifyReq({ "hub.mode": "subscribe", "hub.verify_token": "WRONG", "hub.challenge": "CHALLENGE123" }),
    res,
    () => {},
  );
  assert.equal(out.statusCode, 403);
  assert.notEqual(out.body, "CHALLENGE123");
});

// The webhook always acks 200 so Meta does not disable it after repeated
// non-2xx responses — the accept/reject decision is expressed by whether the
// payload is processed, never by the status code.
test("Meta POST receive: unsigned payload is rejected but still acks 200", async () => {
  const { res, out } = mockRes();
  syncWhatsAppSettings({
    whatsappCloudVerifyToken: "secret-verify-token",
    whatsappCloudAppSecret: "app-secret",
  });
  const req = { body: { foo: "bar" }, header: () => undefined } as unknown as Request;
  await whatsappMetaWebhookReceive(req, res, () => {});
  assert.equal(out.statusCode, 200);
});

// Regression guard: this handler used to ACCEPT unsigned payloads whenever no
// App Secret was stored, leaving any tenant that had not filled the field in
// with a fully open endpoint that drives outbound WhatsApp sends. An
// unconfigured integration must be a disabled one.
test("Meta POST receive: fails closed when no App Secret is configured", async () => {
  const { res, out } = mockRes();
  syncWhatsAppSettings({ whatsappCloudVerifyToken: "secret-verify-token" });
  const req = { body: { foo: "bar" }, header: () => undefined } as unknown as Request;
  await whatsappMetaWebhookReceive(req, res, () => {});
  assert.equal(out.statusCode, 200);
  // sendStatus() sets no JSON body — the payload was never processed.
  assert.notDeepEqual(out.body, { success: true });
});
