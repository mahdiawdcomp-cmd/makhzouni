import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildMerchandisingData } from "./catalog-product-page.service";

/* «العروض» و«وصل حديثاً» — what the two rows write, and what they clear. */
describe("buildMerchandisingData", () => {
  test("an empty patch writes nothing at all", () => {
    assert.deepEqual(buildMerchandisingData({}), {});
  });

  test("each flag is written on its own, without disturbing the other", () => {
    assert.deepEqual(buildMerchandisingData({ isNewArrival: true }), { isNewArrival: true });
    assert.deepEqual(buildMerchandisingData({ isOffer: true }), { isOffer: true });
  });

  // The rule that deletes data: a product put back in the offers row weeks
  // later must not resurrect the old price it carried the first time, nor a
  // countdown whose deadline has already gone by.
  test("leaving the offers row clears the struck-through price and the countdown", () => {
    assert.deepEqual(buildMerchandisingData({ isOffer: false }), {
      isOffer: false,
      oldPrice: null,
      offerEndsAt: null,
    });
  });

  test("leaving the offers row wins over an old price sent in the same patch", () => {
    // A stale form posting both must not leave a price behind on a product
    // that is no longer on offer.
    assert.deepEqual(buildMerchandisingData({ isOffer: false, oldPrice: 12000 }), {
      isOffer: false,
      oldPrice: null,
      offerEndsAt: null,
    });
  });

  test("leaving the «وصل حديثاً» row touches nothing else", () => {
    assert.deepEqual(buildMerchandisingData({ isNewArrival: false }), { isNewArrival: false });
  });

  test("an empty deadline clears it rather than being ignored", () => {
    assert.deepEqual(buildMerchandisingData({ offerEndsAt: "" }), { offerEndsAt: null });
    assert.deepEqual(buildMerchandisingData({ offerEndsAt: null }), { offerEndsAt: null });
  });

  test("a real deadline becomes an instant", () => {
    const data = buildMerchandisingData({ offerEndsAt: "2026-09-20T18:00:00.000Z" });
    assert.ok(data.offerEndsAt instanceof Date);
    assert.equal((data.offerEndsAt as Date).toISOString(), "2026-09-20T18:00:00.000Z");
  });

  test("an unreadable deadline is refused, not silently dropped", () => {
    assert.throws(() => buildMerchandisingData({ offerEndsAt: "بكرة" }), /INVALID_DATE|تاريخ/);
  });

  test("clearing the old price is distinguishable from not mentioning it", () => {
    assert.deepEqual(buildMerchandisingData({ oldPrice: null }), { oldPrice: null });
    assert.deepEqual(buildMerchandisingData({ isNewArrival: true }), { isNewArrival: true });
  });
});
