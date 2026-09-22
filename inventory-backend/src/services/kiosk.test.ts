import { test, mock, before } from "node:test";
import assert from "node:assert/strict";

/**
 * «الكشك» — the screen standing in the shop.
 *
 * What these guard: the link is the only credential the screen has, so a
 * wrong or stale one must open nothing; the shop's own screen must keep
 * working when anonymous browsing is off; and the kiosk must never become a
 * second way of pricing or of skipping the approval a catalog order goes
 * through.
 */

let settings: Record<string, unknown> = {};
let savedSettings: Record<string, unknown> | null = null;
let guestOrderInput: any = null;

mock.module("./settings.service", {
  exports: {
    getSettings: async () => settings,
    updateSettings: async (input: Record<string, unknown>) => {
      savedSettings = input;
      settings = { ...settings, ...input };
      return settings;
    },
  },
});

mock.module("./catalog.service", {
  exports: {
    listVisitorCatalogProducts: async (opts: unknown) => ({ opts }),
    submitGuestCatalogOrder: async (input: unknown) => {
      guestOrderInput = input;
      return { approvalId: "kiosk-order" };
    },
  },
});

mock.module("../config/database", {
  exports: {
    default: {
      product: {
        findFirst: async () => ({ imageUrl: "data:image/png;base64,AAA" }),
        findMany: async ({ where }: any) => where.id.in.map((id: string) => ({ id, thumbnailUrl: `thumb-${id}` })),
      },
    },
  },
});

let kiosk: typeof import("./kiosk.service");
before(async () => {
  kiosk = await import("./kiosk.service");
});

const TOKEN = "kiosk-token-0123456789";

function enabled(extra: Record<string, unknown> = {}) {
  settings = { kioskEnabled: true, kioskToken: TOKEN, storeName: "المحل", ...extra };
}

test("a kiosk that is switched off opens nothing, whatever link is held", async () => {
  enabled({ kioskEnabled: false });
  await assert.rejects(kiosk.requireKiosk(TOKEN), /الكشك/);
  await assert.rejects(kiosk.listKioskProducts(TOKEN));
  await assert.rejects(kiosk.submitKioskOrder(TOKEN, { customerName: "زبون", phone: "07701234567", items: [] } as never));
});

test("a wrong link is refused, and a length difference never throws", async () => {
  enabled();
  // timingSafeEqual throws on unequal lengths — a raw crash here would be a
  // 500 instead of «الرابط غير صحيح», and a length oracle besides.
  await assert.rejects(kiosk.requireKiosk("short"), /الكشك/);
  await assert.rejects(kiosk.requireKiosk(TOKEN + "x"), /الكشك/);
  await assert.rejects(kiosk.requireKiosk(""), /الكشك/);
});

test("an empty stored token never makes an empty link valid", async () => {
  // The state every shop starts in: kiosk switched on, no token generated yet.
  enabled({ kioskToken: "" });
  await assert.rejects(kiosk.requireKiosk(""), /الكشك/);
});

test("the grid always carries prices and follows the shop's kiosk price mode", async () => {
  enabled({ kioskPriceMode: "CARTON" });
  assert.deepEqual(await kiosk.listKioskProducts(TOKEN), {
    opts: { pricesUnlocked: true, priceMode: "CARTON" },
  });
  enabled();
  assert.deepEqual(await kiosk.listKioskProducts(TOKEN), {
    opts: { pricesUnlocked: true, priceMode: "WHOLESALE" },
  });
});

test("an order goes through the catalog pipeline, priced by the shop not the screen", async () => {
  enabled({ kioskPriceMode: "CARTON" });
  const result = await kiosk.submitKioskOrder(TOKEN, {
    customerName: "زبون",
    phone: "07701234567",
    // A price sent by the screen must not survive into the order.
    items: [{ productId: "p1", unit: "PIECE", quantity: 2, unitPrice: 999 }],
  } as never);
  assert.deepEqual(result, { approvalId: "kiosk-order" });
  assert.equal(guestOrderInput.kiosk, true, "the kiosk flag is what lets the shop's own screen bypass the browsing switch");
  assert.equal(guestOrderInput.priceMode, "CARTON", "the price mode comes from settings, never from the request");
  assert.equal(guestOrderInput.items[0].unitPrice, 999, "the screen's number is passed on untouched — the catalog service recomputes every price server-side");
});

test("rotating hands out a new link and switches the screen on", async () => {
  enabled({ kioskEnabled: false });
  const token = await kiosk.rotateKioskToken();
  assert.ok(token.length >= 24);
  assert.equal(savedSettings?.kioskEnabled, true);
  assert.equal(savedSettings?.kioskToken, token);
  // The old link is dead the moment the new one exists.
  await assert.rejects(kiosk.requireKiosk(TOKEN), /الكشك/);
  assert.ok(await kiosk.requireKiosk(token));
});

test("thumbnails and images are behind the same link check", async () => {
  enabled({ kioskEnabled: false });
  await assert.rejects(kiosk.kioskThumbnails(TOKEN, ["p1"]));
  await assert.rejects(kiosk.kioskProductImage(TOKEN, "p1"));
  enabled();
  assert.deepEqual(await kiosk.kioskThumbnails(TOKEN, ["p1", "p1", "p2"]), { p1: "thumb-p1", p2: "thumb-p2" });
  assert.equal(await kiosk.kioskProductImage(TOKEN, "p1"), "data:image/png;base64,AAA");
  assert.deepEqual(await kiosk.kioskThumbnails(TOKEN, []), {});
});
