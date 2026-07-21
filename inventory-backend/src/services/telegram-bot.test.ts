import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isValidIraqiPhone,
  toLocalPhone,
  isUnderDailyLimit,
  couponErrorMessage,
} from "./telegram-bot.service";
import { normalizePhone } from "../utils/phone";

describe("telegram-bot phone format", () => {
  it("isValidIraqiPhone accepts local 07XXXXXXXXX only", () => {
    assert.equal(isValidIraqiPhone("07701234567"), true);
    assert.equal(isValidIraqiPhone("0770123456"), false); // 10 digits
    assert.equal(isValidIraqiPhone("077012345678"), false); // 12 digits
    assert.equal(isValidIraqiPhone("9647701234567"), false); // canonical, not local
    assert.equal(isValidIraqiPhone("06701234567"), false); // wrong prefix
  });

  it("normalizePhone + toLocalPhone round-trips every entry format to local 07…", () => {
    // The bug that broke returning-customer detection: bot stores LOCAL, the
    // rest of the app stores CANONICAL. This round-trip must always agree.
    for (const input of ["07701234567", "+9647701234567", "009647701234567", "9647701234567"]) {
      const canonical = normalizePhone(input);
      assert.equal(canonical, "9647701234567", `canonical for ${input}`);
      assert.equal(toLocalPhone(canonical), "07701234567", `local for ${input}`);
      assert.equal(isValidIraqiPhone(toLocalPhone(canonical)), true);
    }
  });
});

describe("telegram-bot anti-spam daily cap", () => {
  const TODAY = "2026-07-21";

  it("allows an order below the cap", () => {
    assert.equal(isUnderDailyLimit(4, TODAY, TODAY, 5), true);
  });

  it("blocks at the cap", () => {
    assert.equal(isUnderDailyLimit(5, TODAY, TODAY, 5), false);
  });

  it("resets when the stored day differs (new day)", () => {
    assert.equal(isUnderDailyLimit(5, "2026-07-20", TODAY, 5), true);
  });

  it("treats missing counters as zero", () => {
    assert.equal(isUnderDailyLimit(undefined, undefined, TODAY, 5), true);
  });
});

describe("telegram-bot coupon error messages", () => {
  it("maps each known coupon failure code to its Arabic message", () => {
    assert.match(couponErrorMessage("COUPON_EXPIRED"), /منتهي/);
    assert.match(couponErrorMessage("COUPON_INACTIVE"), /غير فعّال/);
    assert.match(couponErrorMessage("COUPON_NOT_STARTED"), /لسا ما بدأ/);
    assert.match(couponErrorMessage("COUPON_LIMIT_REACHED"), /الحد الأقصى/);
  });

  it("falls back to a generic message for unknown/missing codes", () => {
    assert.equal(couponErrorMessage(undefined), "كود غير صحيح 😔");
    assert.equal(couponErrorMessage("SOMETHING_ELSE"), "كود غير صحيح 😔");
  });
});
