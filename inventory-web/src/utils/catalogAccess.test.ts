import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  resolveCatalogEntry,
  shouldDisplay,
  deliveryLineFor,
  type GuestConfig,
  type VisitorLike,
} from "./catalogAccess"

const signedInVisitor: VisitorLike = { detailsSubmitted: true, pricesUnlocked: true }
const openShop: GuestConfig = { guestModeEnabled: true, guestPhoneGate: true, guestPricesVisible: false }
const closedShop: GuestConfig = { guestModeEnabled: false }

const entry = (over: Partial<Parameters<typeof resolveCatalogEntry>[0]> = {}) =>
  resolveCatalogEntry({
    accessToken: "",
    visitorToken: "",
    visitor: null,
    visitorLoading: false,
    guestConfig: closedShop,
    guestConfigLoading: false,
    ...over,
  })

describe("who gets which storefront", () => {
  test("a customer link outranks everything", () => {
    assert.equal(entry({ accessToken: "tok", guestConfig: openShop }).screen, "CUSTOMER")
  })

  // The regression that started this file: opening the shop to strangers made
  // signed-in visitors anonymous — no prices even where the shop had opened
  // prices for them by name, and orders arriving unlinked to their account.
  test("a signed-in visitor outranks an open shop", () => {
    const result = entry({ visitorToken: "v", visitor: signedInVisitor, guestConfig: openShop })
    assert.equal(result.screen, "VISITOR")
    assert.equal(result.screen === "VISITOR" && result.allowPrices, true)
  })

  test("a visitor whose prices are locked is still a visitor, not a guest", () => {
    const result = entry({
      visitorToken: "v",
      visitor: { detailsSubmitted: true, pricesUnlocked: false },
      guestConfig: openShop,
    })
    assert.equal(result.screen, "VISITOR")
    assert.equal(result.screen === "VISITOR" && result.allowPrices, false)
  })

  test("a visitor who has not given their details is asked for them first", () => {
    assert.equal(
      entry({ visitorToken: "v", visitor: { detailsSubmitted: false, pricesUnlocked: true } }).screen,
      "VISITOR_DETAILS",
    )
  })

  // Falling through while the session resolves would sign the shopper out and
  // back in on every refresh.
  test("a token still resolving waits instead of falling through", () => {
    assert.equal(entry({ visitorToken: "v", visitorLoading: true, guestConfig: openShop }).screen, "LOADING")
    assert.equal(entry({ visitorToken: "v", visitorLoading: true, guestConfig: closedShop }).screen, "LOADING")
  })

  test("a stale token that resolves to nothing lands on the right screen", () => {
    assert.equal(entry({ visitorToken: "gone", guestConfig: openShop }).screen, "GUEST")
    assert.equal(entry({ visitorToken: "gone", guestConfig: closedShop }).screen, "LOGIN")
  })

  test("an open shop gates or does not gate, as configured", () => {
    const gated = entry({ guestConfig: { ...openShop, guestPhoneGate: true } })
    assert.equal(gated.screen === "GUEST" && gated.gated, true)
    const ungated = entry({ guestConfig: { ...openShop, guestPhoneGate: false } })
    assert.equal(ungated.screen === "GUEST" && ungated.gated, false)
    // Missing means gated: a shop that never chose must not be opened wider
    // than it was.
    const unset = entry({ guestConfig: { guestModeEnabled: true } })
    assert.equal(unset.screen === "GUEST" && unset.gated, true)
  })

  test("guest prices are off unless the shop explicitly says otherwise", () => {
    const off = entry({ guestConfig: { guestModeEnabled: true } })
    assert.equal(off.screen === "GUEST" && off.allowPrices, false)
    const on = entry({ guestConfig: { guestModeEnabled: true, guestPricesVisible: true } })
    assert.equal(on.screen === "GUEST" && on.allowPrices, true)
  })

  test("a closed shop with no identity shows the login", () => {
    assert.equal(entry().screen, "LOGIN")
  })

  test("nothing is decided before the config arrives", () => {
    assert.equal(entry({ guestConfigLoading: true, guestConfig: null }).screen, "LOADING")
    // …except a customer link, which needs no config at all.
    assert.equal(entry({ accessToken: "t", guestConfigLoading: true, guestConfig: null }).screen, "CUSTOMER")
  })
})

describe("what the grid draws", () => {
  const pictured = { currentStock: 100, pcsPerCarton: 10, hasImage: true }
  const bare = { currentStock: 100, pcsPerCarton: 10, hasImage: false }
  const opts = { guestMode: false, stockFilter: "FULL_CARTON_ONLY" as const, hideNoImage: false, noImageMode: false }

  test("a guest only ever sees full cartons", () => {
    const partial = { currentStock: 5, pcsPerCarton: 10, hasImage: true }
    assert.equal(shouldDisplay(partial, { ...opts, guestMode: true }), false)
    assert.equal(shouldDisplay(partial, { ...opts, guestMode: false, stockFilter: "ALL_PRODUCTS" }), true)
  })

  test("a sold-out product is never shown", () => {
    const none = { currentStock: 0, pcsPerCarton: 10, hasImage: true }
    assert.equal(shouldDisplay(none, { ...opts, stockFilter: "ALL_PRODUCTS" }), false)
    assert.equal(shouldDisplay(none, opts), false)
  })

  // The two views must partition the catalog: a product that fell out of both
  // would be unreachable, and one in both would be the mess this replaced.
  test("the pictureless view is the exact complement of the normal one", () => {
    for (const p of [pictured, bare]) {
      const normal = shouldDisplay(p, { ...opts, hideNoImage: true, noImageMode: false })
      const other = shouldDisplay(p, { ...opts, hideNoImage: true, noImageMode: true })
      assert.equal(normal !== other, true, "every in-stock product belongs to exactly one view")
    }
  })

  test("pictureless products show alongside the rest until the shop hides them", () => {
    assert.equal(shouldDisplay(bare, { ...opts, hideNoImage: false }), true)
    assert.equal(shouldDisplay(bare, { ...opts, hideNoImage: true }), false)
    assert.equal(shouldDisplay(pictured, { ...opts, hideNoImage: true }), true)
  })

  test("thumbnailUrl stands in when hasImage was not sent", () => {
    assert.equal(shouldDisplay({ currentStock: 100, pcsPerCarton: 10, thumbnailUrl: "data:..." },
      { ...opts, hideNoImage: true }), true)
    assert.equal(shouldDisplay({ currentStock: 100, pcsPerCarton: 10, thumbnailUrl: null },
      { ...opts, hideNoImage: true }), false)
  })

  test("a product with no carton size is never orderable", () => {
    assert.equal(shouldDisplay({ currentStock: 50, pcsPerCarton: 0, hasImage: true },
      { ...opts, guestMode: true }), false)
  })
})

describe("the delivery sentence", () => {
  const delivery = { northGovernorates: ["نينوى", "أربيل"], freeShippingThreshold: 1_500_000 }

  test("no governorate, no promise", () => {
    assert.equal(deliveryLineFor("", delivery), null)
    assert.equal(deliveryLineFor(null, delivery), null)
    assert.equal(deliveryLineFor("   ", delivery), null)
  })

  test("the north is quoted per shipment, not promised free", () => {
    assert.match(deliveryLineFor("نينوى", delivery) ?? "", /حسب البضاعة/)
  })

  test("everywhere else gets the threshold, formatted", () => {
    assert.match(deliveryLineFor("كربلاء", delivery) ?? "", /1,500,000/)
  })

  test("a shop that configured nothing still says something coherent", () => {
    assert.match(deliveryLineFor("كربلاء", { freeShippingThreshold: 0 }) ?? "", /فوق 0/)
    assert.equal(deliveryLineFor("كربلاء", null), null)
  })
})
