/**
 * The request validator and the send controller once kept separate lists of
 * WhatsApp template kinds, and they drifted: `debtReminder`, `inactiveCustomer`
 * and later `countLink` were wired end to end but rejected at validation with
 * "Invalid enum value", so those sends never happened at all.
 *
 * Both sides now read the same map. These tests exist to make a future split
 * fail here rather than in production.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { sendWhatsAppTemplatedSchema } from "../utils/schemas";
import { TEMPLATE_KINDS, TEMPLATE_KIND_SETTING } from "./whatsapp-templates";
import { defaultSettings } from "../services/settings.service";

const body = (templateKind: string) => ({
  body: { phone: "07700000000", message: "نص احتياطي", templateKind, bodyParams: ["a"] },
});

test("every template kind the controller can send is accepted by the validator", () => {
  for (const kind of TEMPLATE_KINDS) {
    const parsed = sendWhatsAppTemplatedSchema.safeParse(body(kind));
    assert.ok(parsed.success, `"${kind}" must pass validation — it is a real send`);
  }
});

test("an unknown kind is still refused", () => {
  assert.equal(sendWhatsAppTemplatedSchema.safeParse(body("madeUp")).success, false);
});

test("every kind maps to a settings key that actually exists", () => {
  for (const kind of TEMPLATE_KINDS) {
    const settingKey = TEMPLATE_KIND_SETTING[kind];
    assert.ok(
      settingKey in defaultSettings,
      `"${kind}" points at settings key "${settingKey}", which no setting defines`,
    );
  }
});

test("the counting link has its own template — it must never ride on the invoice one", () => {
  // The invoice template is shared by four sends and has a fixed 9-parameter
  // body; folding a link into it would break all four on a count mismatch.
  assert.equal(TEMPLATE_KIND_SETTING.countLink, "countLinkTemplateName");
  assert.notEqual(TEMPLATE_KIND_SETTING.countLink, "invoiceTemplateName");
});
