import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCaption } from "./telegram-channel.service";
import { defaultSettings } from "./settings.service";

const product = {
  id: "p1",
  itemNumber: "A-100",
  name: "صمغ ياباني",
  salePrice: 1500,
  pcsPerCarton: 24,
  thumbnailUrl: null,
};

describe("telegram-channel buildCaption", () => {
  it("includes name, item number, piece price, carton price and catalog link", () => {
    const caption = buildCaption(product, {
      ...defaultSettings,
      currency: "IQD",
      catalogPublicUrl: "https://mahdi.mazbwoni.com/catalog",
    });
    assert.match(caption, /صمغ ياباني/);
    assert.match(caption, /A-100/);
    assert.match(caption, /1,500 د\.ع/); // piece = salePrice
    assert.match(caption, /24 قطعة/);
    assert.match(caption, /36,000 د\.ع/); // carton = salePrice * pcsPerCarton
    assert.match(caption, /https:\/\/mahdi\.mazbwoni\.com\/catalog/);
  });

  it("omits the catalog link block when no public URL is configured", () => {
    const caption = buildCaption(product, { ...defaultSettings, catalogPublicUrl: "" });
    assert.doesNotMatch(caption, /اطلب من الكتلوك/);
  });

  it("never exceeds Telegram's 1024-char photo caption cap", () => {
    const caption = buildCaption(
      { ...product, name: "م".repeat(2000) },
      { ...defaultSettings },
    );
    assert.ok(caption.length <= 1024);
  });
});
