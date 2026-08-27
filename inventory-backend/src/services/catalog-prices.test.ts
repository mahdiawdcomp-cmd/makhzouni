import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveVisitorPrices } from "./catalog-visitor.service";

/* The merchant asked for all four situations; each is one case here. */
describe("resolveVisitorPrices", () => {
  test("a visitor nobody touched follows the shop-wide default", () => {
    assert.equal(resolveVisitorPrices({}, true), true);
    assert.equal(resolveVisitorPrices({}, false), false);
  });

  test("opened for one person, while the shop is closed to everyone else", () => {
    assert.equal(resolveVisitorPrices({ pricesUnlockedAt: new Date() }, false), true);
  });

  test("closed for one person, while the shop is open to everyone else", () => {
    assert.equal(resolveVisitorPrices({ pricesHidden: true }, true), false);
  });

  // Closing is the stronger statement: it is the merchant naming a person,
  // and it must not be undone by a later change to the shop-wide switch.
  test("an explicit close beats an earlier explicit open", () => {
    assert.equal(
      resolveVisitorPrices({ pricesHidden: true, pricesUnlockedAt: new Date() }, true),
      false,
    );
  });

  test("null and undefined are treated as 'not set', not as 'closed'", () => {
    assert.equal(resolveVisitorPrices({ pricesHidden: null, pricesUnlockedAt: null }, true), true);
  });
});
