import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveCatalogSections, CATALOG_SECTION_KEYS } from "./catalog.service";

describe("resolveCatalogSections", () => {
  test("a shop that never arranged anything gets the built-in order, all on", () => {
    const out = resolveCatalogSections(undefined);
    assert.deepEqual(out.map((s) => s.key), [...CATALOG_SECTION_KEYS]);
    assert.ok(out.every((s) => s.enabled));
  });

  test("keeps the shop's order and switches", () => {
    const out = resolveCatalogSections([
      { key: "banner", enabled: true },
      { key: "badges", enabled: false },
    ]);
    assert.equal(out[0].key, "banner");
    assert.equal(out[1].key, "badges");
    assert.equal(out[1].enabled, false);
  });

  // A section added in a later release must appear for shops that saved their
  // order before it existed — otherwise the new block is invisible to exactly
  // the shops that have been customising the longest.
  test("appends sections the shop has never seen, enabled", () => {
    const out = resolveCatalogSections([{ key: "featured", enabled: true }]);
    assert.equal(out[0].key, "featured");
    assert.equal(out.length, CATALOG_SECTION_KEYS.length);
    assert.ok(out.slice(1).every((s) => s.enabled));
  });

  test("ignores keys the storefront does not know", () => {
    const out = resolveCatalogSections([
      { key: "not_a_section", enabled: true },
      { key: "badges", enabled: false },
    ]);
    assert.ok(!out.some((s) => String(s.key) === "not_a_section"));
    assert.equal(out[0].key, "badges");
    assert.equal(out[0].enabled, false);
  });

  test("a duplicated key is honoured once, at its first position", () => {
    const out = resolveCatalogSections([
      { key: "banner", enabled: false },
      { key: "banner", enabled: true },
    ]);
    assert.equal(out.filter((s) => s.key === "banner").length, 1);
    assert.equal(out[0].enabled, false);
  });

  test("never drops or duplicates a section", () => {
    const out = resolveCatalogSections([
      { key: "priceBar", enabled: false },
      { key: "banner", enabled: true },
      { key: "nope", enabled: true },
    ]);
    assert.equal(out.length, CATALOG_SECTION_KEYS.length);
    assert.equal(new Set(out.map((s) => s.key)).size, CATALOG_SECTION_KEYS.length);
  });
});
