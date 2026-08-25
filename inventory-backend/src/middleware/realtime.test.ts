import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { __resourceForPathForTests as resourceForPath } from "./realtime.middleware";

describe("resourceForPath", () => {
  test("staff routes keep their resource", () => {
    assert.equal(resourceForPath("/api/products/123"), "products");
    assert.equal(resourceForPath("/api/catalog-management/accounts/promote"), "catalog");
    assert.equal(resourceForPath("/api/whatsapp/send"), "whatsapp-chat");
    assert.equal(resourceForPath("/api/whatsapp-chat/messages"), "whatsapp-chat");
  });

  test("an unmapped staff route still falls back to a full refresh", () => {
    assert.equal(resourceForPath("/api/something-new"), "all");
  });

  // A shopper browsing must never make the owner's screen refetch everything.
  test("shopper traffic publishes nothing", () => {
    assert.equal(resourceForPath("/api/public/catalog/thumbnails"), null);
    assert.equal(resourceForPath("/api/public/catalog/request-prices"), null);
    assert.equal(resourceForPath("/api/public/catalog/signup-details"), null);
    assert.equal(resourceForPath("/api/public/catalog/visitor-heartbeat"), null);
    assert.equal(resourceForPath("/api/public/catalog/track-view"), null);
    assert.equal(resourceForPath("/api/public/otp/send"), null);
  });

  test("the two public actions staff actually watch still publish", () => {
    assert.equal(resourceForPath("/api/public/catalog/orders"), "order-preparations");
    assert.equal(resourceForPath("/api/public/catalog/guest-orders"), "order-preparations");
    assert.equal(resourceForPath("/api/public/catalog/access/request"), "approvals");
  });

  test("query strings never change the answer", () => {
    assert.equal(resourceForPath("/api/public/catalog/thumbnails?access=abc"), null);
    assert.equal(resourceForPath("/api/products?limit=50"), "products");
  });
});
