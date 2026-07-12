import assert from "node:assert/strict";
import { before, beforeEach, afterEach, describe, it, mock } from "node:test";
import type { Request, Response, NextFunction } from "express";

// Settings mock — controllable per test, no real DB needed.
let settingsMock: Record<string, unknown> = {};
mock.module("../services/settings.service", {
  exports: {
    getSettings: async () => settingsMock,
    updateSettings: async (patch: Record<string, unknown>) => {
      settingsMock = { ...settingsMock, ...patch };
      return settingsMock;
    },
  },
});

// whatsapp-chat.service is used internally by whatsapp.service.ts (logChatMessage
// on every send) — stub it out so no real DB is touched.
const loggedMessages: Array<Record<string, unknown>> = [];
mock.module("../services/whatsapp-chat.service", {
  exports: {
    logChatMessage: async (input: Record<string, unknown>) => {
      loggedMessages.push(input);
      return { id: "msg-1", ...input };
    },
    applyMessageReaction: async () => null,
    fillConversationContactName: async () => {},
    updateMessageStatus: async () => null,
  },
});

// Invokes an asyncHandler-wrapped controller and resolves once res.json (or
// next(err)) actually fires — asyncHandler's own return value is fire-and-forget,
// so just `await`ing the call would race ahead of any internal await inside it.
function callHandler(
  handler: (req: Request, res: Response, next: NextFunction) => void,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    const res = {
      status(code: number) { statusCode = code; return res; },
      json(b: unknown) { resolve({ status: statusCode, body: b }); return res; },
    } as unknown as Response;
    const req = { body, params: {}, query: {} } as unknown as Request;
    handler(req, res, (err: unknown) => reject(err));
  });
}

type FetchBehavior = (url: string, body: Record<string, unknown>) => { ok: boolean; json: unknown };

let fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
let fetchBehavior: FetchBehavior = () => ({ ok: true, json: { messages: [{ id: "wamid.ok" }] } });
const originalFetch = global.fetch;

let ctrl: typeof import("./whatsapp.controller");
let whatsappSvc: typeof import("../services/whatsapp.service");

describe("whatsapp.controller — template-or-fallback sends", () => {
  before(async () => {
    ctrl = await import("./whatsapp.controller");
    whatsappSvc = await import("../services/whatsapp.service");
  });

  beforeEach(() => {
    loggedMessages.length = 0;
    fetchCalls = [];
    settingsMock = { voucherTemplateName: "", statementTemplateName: "", portalLinkTemplateName: "", storeName: "متجري" };
    whatsappSvc.syncWhatsAppSettings({ whatsappProvider: "cloud", whatsappCloudToken: "test-token", whatsappCloudPhoneNumberId: "1234567890" });
    fetchBehavior = () => ({ ok: true, json: { messages: [{ id: "wamid.ok" }] } });
    global.fetch = (async (url: unknown, init?: RequestInit) => {
      const parsedBody = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      fetchCalls.push({ url: String(url), body: parsedBody });
      const behavior = fetchBehavior(String(url), parsedBody);
      return {
        ok: behavior.ok,
        json: async () => behavior.json,
        text: async () => JSON.stringify(behavior.json),
      } as Response;
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    whatsappSvc.syncWhatsAppSettings({});
  });

  it("no template configured for this kind → sends free text directly, one Cloud call", async () => {
    const { status } = await callHandler(ctrl.sendTemplatedMessage, {
      phone: "9647700000000",
      message: "نص السند الحر",
      templateKind: "voucher",
      bodyParams: ["أحمد"],
    });
    assert.equal(status, 200);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].body.type, "text");
    assert.equal((fetchCalls[0].body.text as { body: string }).body, "نص السند الحر");
  });

  it("template configured + Cloud accepts it → uses the template, never touches free text", async () => {
    settingsMock.voucherTemplateName = "voucher_receipt";
    const { status } = await callHandler(ctrl.sendTemplatedMessage, {
      phone: "9647700000000",
      message: "نص بديل ما لازم يترسل",
      templateKind: "voucher",
      bodyParams: ["أحمد", "1000"],
    });
    assert.equal(status, 200);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].body.type, "template");
    assert.equal((fetchCalls[0].body.template as { name: string }).name, "voucher_receipt");
  });

  it("template configured but Cloud rejects it → automatically falls back to the free text", async () => {
    settingsMock.statementTemplateName = "statement_notice";
    fetchBehavior = (_url, body) =>
      body.type === "template" ? { ok: false, json: { error: { message: "template not approved" } } } : { ok: true, json: { messages: [{ id: "wamid.fallback" }] } };

    const { status } = await callHandler(ctrl.sendTemplatedMessage, {
      phone: "9647700000000",
      message: "الكشف بالنص الحر",
      templateKind: "statement",
      bodyParams: ["أحمد", "2026-07-11"],
    });
    assert.equal(status, 200);
    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[0].body.type, "template");
    assert.equal(fetchCalls[1].body.type, "text");
    assert.equal((fetchCalls[1].body.text as { body: string }).body, "الكشف بالنص الحر");
  });

  it("portal-link templateKind uses portalLinkTemplateName when configured", async () => {
    settingsMock.portalLinkTemplateName = "portal_link_notification";
    const { status } = await callHandler(ctrl.sendTemplatedMessage, {
      phone: "9647700000000",
      message: "رابط بديل ما لازم يترسل",
      templateKind: "portal",
      bodyParams: ["أحمد", "https://mahdi.mazbwoni.com/portal/abc123"],
    });
    assert.equal(status, 200);
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].body.type, "template");
    assert.equal((fetchCalls[0].body.template as { name: string }).name, "portal_link_notification");
  });

  it("unknown templateKind is rejected with 400, no Cloud call made", async () => {
    await assert.rejects(
      () => callHandler(ctrl.sendTemplatedMessage, { phone: "9647700000000", message: "x", templateKind: "bogus", bodyParams: [] }),
      (err: unknown) => (err as { statusCode?: number }).statusCode === 400,
    );
    assert.equal(fetchCalls.length, 0);
  });

  it("missing phone or message is rejected with 400", async () => {
    await assert.rejects(
      () => callHandler(ctrl.sendTemplatedMessage, { message: "x", templateKind: "voucher", bodyParams: [] }),
      (err: unknown) => (err as { statusCode?: number }).statusCode === 400,
    );
  });
});
