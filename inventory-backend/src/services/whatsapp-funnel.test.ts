/**
 * Guards the WhatsApp funnel logic that costs money or reputation when it
 * silently regresses. Everything here is deliberately pure — no database, no
 * network — so it runs on every `npm test` without setup.
 *
 * What each block protects:
 *   - stop words   → a broken match means advertising keeps reaching someone
 *                    who asked it to stop, which is how a number gets reported
 *                    and banned.
 *   - governorate  → a wrong match mis-files a customer's region, so they are
 *                    quoted the wrong delivery terms.
 *   - delivery     → the single sentence a shopper is shown about shipping.
 *   - follow-ups   → wrong eligibility means duplicate or premature chasing.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_FREE_SHIPPING_THRESHOLD,
  DEFAULT_NORTH_GOVERNORATES,
  IRAQI_GOVERNORATES,
  buildDeliveryLine,
  isNorthGovernorate,
} from "../utils/deliveryRegion";
import { matchBusinessType, matchGovernorate } from "./whatsapp-registration.service";
import { DEFAULT_STOP_KEYWORDS, matchesStopKeyword } from "./marketing-opt-out.service";

/* ── «توقف» ─────────────────────────────────────────────────────────── */

describe("marketing stop word", () => {
  it("accepts each default keyword on its own", () => {
    for (const word of DEFAULT_STOP_KEYWORDS) {
      assert.equal(matchesStopKeyword(word, DEFAULT_STOP_KEYWORDS), true, word);
    }
  });

  it("ignores surrounding whitespace, punctuation and letter case", () => {
    for (const text of ["  توقف  ", "توقف.", "توقف!", "STOP", "Stop", " stop "]) {
      assert.equal(matchesStopKeyword(text, DEFAULT_STOP_KEYWORDS), true, text);
    }
  });

  it("does NOT unsubscribe someone quoting the campaign's own instruction", () => {
    // The campaign message ends with this exact line. Forwarding or quoting it
    // must never be read as a request to stop.
    assert.equal(
      matchesStopKeyword("للتوقف عن استلام الرسائل، رد بكلمة: توقف", DEFAULT_STOP_KEYWORDS),
      false,
    );
  });

  it("does NOT unsubscribe a sentence that merely contains the word", () => {
    for (const text of [
      "ما اريد توقف الرسائل بس ابي اطلب",
      "شنو يعني توقف؟",
      "لا توقف الرسائل",
    ]) {
      assert.equal(matchesStopKeyword(text, DEFAULT_STOP_KEYWORDS), false, text);
    }
  });

  it("ignores ordinary messages and empty input", () => {
    for (const text of ["اريد اطلب", "سلام عليكم", "1", "", "   "]) {
      assert.equal(matchesStopKeyword(text, DEFAULT_STOP_KEYWORDS), false, JSON.stringify(text));
    }
  });

  it("honours a shop's custom keyword list instead of the defaults", () => {
    const custom = ["كافي"];
    assert.equal(matchesStopKeyword("كافي", custom), true);
    assert.equal(matchesStopKeyword("توقف", custom), false);
  });
});

/* ── Governorate matching ───────────────────────────────────────────── */

describe("governorate matching", () => {
  it("matches every governorate by its exact name", () => {
    for (const g of IRAQI_GOVERNORATES) {
      assert.equal(matchGovernorate(g), g, g);
    }
  });

  it("tolerates a district written next to the governorate", () => {
    assert.equal(matchGovernorate("بغداد الكرخ"), "بغداد");
    assert.equal(matchGovernorate("محافظة البصرة"), "البصرة");
  });

  it("returns null for something that is not a governorate", () => {
    for (const text of ["", "  ", "لا اريد", "مصر"]) {
      assert.equal(matchGovernorate(text), null, JSON.stringify(text));
    }
  });

  it("does not confuse two different governorates", () => {
    assert.equal(matchGovernorate("النجف"), "النجف");
    assert.equal(matchGovernorate("نينوى"), "نينوى");
    assert.notEqual(matchGovernorate("كربلاء"), "بغداد");
  });
});

describe("business type matching", () => {
  it("recognises each type from natural wording", () => {
    assert.equal(matchBusinessType("قرطاسية"), "STATIONERY");
    assert.equal(matchBusinessType("العاب"), "TOYS");
    assert.equal(matchBusinessType("ألعاب"), "TOYS");
    assert.equal(matchBusinessType("مختلط"), "MIXED");
  });

  it("returns null when the reply names no type", () => {
    for (const text of ["", "لا اعرف", "بغداد"]) {
      assert.equal(matchBusinessType(text), null, JSON.stringify(text));
    }
  });
});

/* ── Delivery line ──────────────────────────────────────────────────── */

describe("delivery line", () => {
  it("quotes per-order pricing for the north", () => {
    for (const g of DEFAULT_NORTH_GOVERNORATES) {
      const line = buildDeliveryLine(g, null);
      assert.ok(line?.includes("حسب البضاعة"), `${g}: ${line}`);
    }
  });

  it("quotes free shipping above the threshold everywhere else", () => {
    const middle = IRAQI_GOVERNORATES.filter((g) => !DEFAULT_NORTH_GOVERNORATES.includes(g as never));
    for (const g of middle) {
      const line = buildDeliveryLine(g, null);
      assert.ok(line?.includes("مجاني"), `${g}: ${line}`);
      assert.ok(
        line?.includes(DEFAULT_FREE_SHIPPING_THRESHOLD.toLocaleString("en-US")),
        `${g} should quote the default threshold: ${line}`,
      );
    }
  });

  it("uses the shop's own threshold when it set one", () => {
    const line = buildDeliveryLine("بغداد", { catalogFreeShippingThreshold: 2_000_000 });
    assert.ok(line?.includes("2,000,000"), line ?? "null");
  });

  it("follows the shop when it moves a governorate between regions", () => {
    // Karbala is normally middle; a shop that lists it as north must see the
    // north wording, since this list is theirs to edit.
    const line = buildDeliveryLine("كربلاء", { catalogNorthGovernorates: ["كربلاء"] });
    assert.ok(line?.includes("حسب البضاعة"), line ?? "null");
  });

  it("says nothing at all when the customer's region is unknown", () => {
    // Better silent than guessing a shipping promise we cannot keep.
    assert.equal(buildDeliveryLine(null, null), null);
    assert.equal(buildDeliveryLine("", null), null);
    assert.equal(buildDeliveryLine(undefined, null), null);
  });

  it("classifies against the default list when the shop set none", () => {
    assert.equal(isNorthGovernorate("أربيل"), true);
    assert.equal(isNorthGovernorate("البصرة"), false);
    // An empty custom list means "nothing is north" — an explicit choice, not
    // a reason to silently fall back to the defaults.
    assert.equal(isNorthGovernorate("أربيل", []), false);
  });
});
