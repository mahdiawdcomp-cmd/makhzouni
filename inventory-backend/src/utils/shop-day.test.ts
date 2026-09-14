/**
 * The shop's day, and the dates a caller is allowed to name.
 *
 * Two bugs live here if these fail: a plan filed under a day that does not
 * exist (`2026-02-30`), and a window that silently shifts because a date string
 * was parsed as UTC midnight.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isShopDateKey,
  shopDateKey,
  shopDayEndExclusive,
  shopDayStart,
  shopInclusiveEndKey,
} from "./shop-day";
import { externalSendsBlocked, isPermanentSendFailure } from "./external-sends";

const TZ = "Asia/Baghdad";

test("only a real calendar day is accepted", () => {
  for (const good of ["2026-02-28", "2028-02-29", "2026-01-01", "2026-12-31", "2026-09-14"]) {
    assert.equal(isShopDateKey(good), true, good);
  }
  for (const bad of [
    "2026-99-99",
    "2026-02-30",
    "2026-02-29", // 2026 is not a leap year
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
    "2026-1-1", // the key is always four-two-two
    "26-01-01",
    "not-a-date",
    "",
    " ",
    null,
    undefined,
    20260101,
    {},
  ]) {
    assert.equal(isShopDateKey(bad as unknown), false, JSON.stringify(bad));
  }
});

test("surrounding spaces are tolerated, because a date input can send them", () => {
  assert.equal(isShopDateKey(" 2026-09-14 "), true);
});

test("a picked day starts at its own first instant, shop time", () => {
  const start = shopDayStart("2026-09-20", TZ);
  // Baghdad is UTC+3 with no DST, so local midnight is 21:00 the day before.
  assert.equal(start.toISOString(), "2026-09-19T21:00:00.000Z");
  assert.equal(shopDateKey(start, TZ), "2026-09-20", "the instant belongs to the day that was picked");
});

test("a picked END day is included in full, stored as the next day's first instant", () => {
  const end = shopDayEndExclusive("2026-09-25", TZ);
  assert.equal(end.toISOString(), "2026-09-25T21:00:00.000Z");
  // The last moment covered is still the 25th, shop time…
  assert.equal(shopInclusiveEndKey(end, TZ), "2026-09-25");
  // …and the boundary itself already belongs to the 26th.
  assert.equal(shopDateKey(end, TZ), "2026-09-26");
});

test("a window covers its last day right up to local midnight", () => {
  const start = shopDayStart("2026-09-20", TZ);
  const end = shopDayEndExclusive("2026-09-25", TZ);
  // 23:59 local on the 25th is inside; 00:00 local on the 26th is not.
  const lateOnLastDay = new Date("2026-09-25T20:59:00.000Z");
  const midnightAfter = new Date("2026-09-25T21:00:00.000Z");
  assert.ok(lateOnLastDay >= start && lateOnLastDay < end, "23:59 on the last day is still inside");
  assert.equal(midnightAfter < end, false, "the next local midnight is outside");
});

test("a month boundary does not slip", () => {
  const end = shopDayEndExclusive("2026-09-30", TZ);
  assert.equal(shopInclusiveEndKey(end, TZ), "2026-09-30");
  assert.equal(shopDateKey(end, TZ), "2026-10-01");
});

/* ── outbound sends ──────────────────────────────────────────────────── */

test("a test run blocks outbound sends unless it explicitly opts in", () => {
  const previous = process.env.ALLOW_TEST_EXTERNAL_SENDS;
  try {
    delete process.env.ALLOW_TEST_EXTERNAL_SENDS;
    assert.equal(externalSendsBlocked(), true, "NODE_ENV=test blocks sends");
    process.env.ALLOW_TEST_EXTERNAL_SENDS = "true";
    assert.equal(externalSendsBlocked(), false, "a test can opt back in deliberately");
  } finally {
    if (previous === undefined) delete process.env.ALLOW_TEST_EXTERNAL_SENDS;
    else process.env.ALLOW_TEST_EXTERNAL_SENDS = previous;
  }
});

test("a disabled provider is permanent; a network hiccup is not", () => {
  const permanent = [
    Object.assign(new Error("x"), { code: "WHATSAPP_DISABLED" }),
    Object.assign(new Error("x"), { code: "WHATSAPP_MANUAL_ONLY" }),
    Object.assign(new Error("x"), { code: "WHATSAPP_CLOUD_NOT_CONFIGURED" }),
    new Error("WhatsApp is disabled. Set ENABLE_WHATSAPP=true"),
    new Error("الواتساب معطّل من الإعدادات"),
  ];
  for (const err of permanent) {
    assert.equal(isPermanentSendFailure(err), true, err.message);
  }

  const transient = [
    Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    Object.assign(new Error("timeout of 30000ms exceeded"), { code: "ETIMEDOUT" }),
    new Error("Request failed with status code 502"),
    undefined,
  ];
  for (const err of transient) {
    assert.equal(isPermanentSendFailure(err), false, String(err));
  }
});
