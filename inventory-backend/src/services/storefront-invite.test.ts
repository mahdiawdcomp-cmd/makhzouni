import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { matchesInviteKeyword, DEFAULT_INVITE_KEYWORDS } from "./storefront-invite.service";

describe("matchesInviteKeyword", () => {
  const KW = DEFAULT_INVITE_KEYWORDS;

  test("matches the plain keyword", () => {
    assert.equal(matchesInviteKeyword("حسابي", KW), true);
  });

  test("matches the quick-reply button label", () => {
    assert.equal(matchesInviteKeyword("نعم أريد حسابي", KW), true);
  });

  test("ignores surrounding whitespace and punctuation", () => {
    assert.equal(matchesInviteKeyword("  حسابي!  ", KW), true);
  });

  test("matches regardless of hamza and taa-marbuta spelling", () => {
    assert.equal(matchesInviteKeyword("اريد حسابي", KW), true);
    assert.equal(matchesInviteKeyword("أريد حسابي", KW), true);
  });

  test("collapses repeated spaces", () => {
    assert.equal(matchesInviteKeyword("نعم   اريد    حسابي", KW), true);
  });

  // The invite text itself contains the word, so quoting it back must not
  // rotate the shopper's code behind their back.
  test("does not match the keyword quoted inside a sentence", () => {
    assert.equal(matchesInviteKeyword("رد على هذي الرسالة بكلمة: حسابي", KW), false);
    assert.equal(matchesInviteKeyword("شنو يعني حسابي عندكم؟", KW), false);
  });

  test("does not match empty or unrelated text", () => {
    assert.equal(matchesInviteKeyword("", KW), false);
    assert.equal(matchesInviteKeyword("   ", KW), false);
    assert.equal(matchesInviteKeyword("شكراً", KW), false);
    assert.equal(matchesInviteKeyword("توقف", KW), false);
  });

  // The exact labels on the shop's live toys_offer_intro template. The first
  // one carries a comma in the middle — the shape that used to miss.
  test("matches the live quick-reply button labels", () => {
    assert.equal(matchesInviteKeyword("نعم، أريد حسابي", KW), true);
    assert.equal(matchesInviteKeyword("نعم، اريد حسابي", KW), true);
  });

  test("matches a label however the merchant punctuates it", () => {
    const custom = ["افتحلي حساب"];
    assert.equal(matchesInviteKeyword("افتحلي، حساب", custom), true);
    assert.equal(matchesInviteKeyword("افتحلي حساب!", custom), true);
  });

  test("honours a merchant's custom button label", () => {
    assert.equal(matchesInviteKeyword("افتحلي حساب", ["افتحلي حساب"]), true);
    assert.equal(matchesInviteKeyword("حسابي", ["افتحلي حساب"]), false);
  });

  test("ignores blank entries in the configured list", () => {
    assert.equal(matchesInviteKeyword("", ["", "  "]), false);
    assert.equal(matchesInviteKeyword("حسابي", ["", "حسابي"]), true);
  });
});
