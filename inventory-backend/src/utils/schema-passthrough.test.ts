import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createInvoiceSchema,
  updateSettingsSchema,
} from "./schemas";

/* ══════════════════════════════════════════════════════════════════════
   Fields that must survive validation.

   validate() REPLACES req.body with the parsed result, so a field the schema
   does not name is stripped before the service ever sees it — silently, with
   a 200 back and nothing done. It has now cost this project twice: 29 catalog
   settings that appeared to save and did not, and a loyalty redemption that
   took a customer's points and applied no discount.

   These assert the whole round trip, not the schema's shape, so a field
   removed by a careless edit fails here instead of in production.
══════════════════════════════════════════════════════════════════════ */

const invoiceBody = {
  customerId: "11111111-1111-4111-8111-111111111111",
  discount: 0,
  tax: 0,
  paidAmount: 0,
  items: [{
    productId: "22222222-2222-4222-8222-222222222222",
    unit: "PIECE",
    quantity: 1,
    unitPrice: 1000,
  }],
};

describe("createInvoiceSchema keeps what the service needs", () => {
  test("redeemPoints survives — without it the redemption silently does nothing", () => {
    const parsed = createInvoiceSchema.parse({ body: { ...invoiceBody, redeemPoints: 2000 } });
    assert.equal(parsed.body.redeemPoints, 2000);
  });

  test("omitting it is still valid — an ordinary invoice spends nothing", () => {
    const parsed = createInvoiceSchema.parse({ body: invoiceBody });
    assert.equal(parsed.body.redeemPoints, undefined);
  });

  test("a negative or fractional redemption is refused, not rounded away", () => {
    assert.throws(() => createInvoiceSchema.parse({ body: { ...invoiceBody, redeemPoints: -5 } }));
    assert.throws(() => createInvoiceSchema.parse({ body: { ...invoiceBody, redeemPoints: 1.5 } }));
  });

  test("the fields an invoice cannot be built without all survive", () => {
    const parsed = createInvoiceSchema.parse({
      body: { ...invoiceBody, discount: 500, couponCode: "EID", notes: "ملاحظة" },
    });
    assert.equal(parsed.body.discount, 500);
    assert.equal(parsed.body.couponCode, "EID");
    assert.equal(parsed.body.notes, "ملاحظة");
    assert.equal(parsed.body.items.length, 1);
  });
});

describe("updateSettingsSchema keeps every setting a screen can send", () => {
  // Each of these is a switch a merchant can flip. One missing from the schema
  // is a switch that flips on screen, reports success, and changes nothing.
  const settings: Record<string, unknown> = {
    loyaltyPointValue: 5,
    loyaltyExpiryDays: 365,
    catalogHideNoImage: true,
    catalogNewArrivalDays: 20,
    catalogQuickTags: ["القرطاسية"],
    catalogGuestPricesVisible: true,
    catalogPricesVisibleByDefault: true,
    catalogFullCartonOnly: false,
    catalogSections: [{ key: "offers", enabled: false }],
  };

  for (const [key, value] of Object.entries(settings)) {
    test(`${key} reaches the service`, () => {
      const parsed = updateSettingsSchema.parse({ body: { [key]: value } });
      assert.deepEqual(
        (parsed.body as Record<string, unknown>)[key], value,
        `${key} was stripped by validate() — the save would report success and do nothing`,
      );
    });
  }

  test("an unknown field is dropped, which is why the ones above must be named", () => {
    const parsed = updateSettingsSchema.parse({ body: { catalogHideNoImage: true, notARealSetting: 1 } });
    assert.equal("notARealSetting" in (parsed.body as object), false);
  });
});
