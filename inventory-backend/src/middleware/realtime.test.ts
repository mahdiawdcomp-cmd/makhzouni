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
    // «الكشك» — an order from the in-shop screen is a real order and the
    // owner's approvals screen has to see it arrive.
    assert.equal(resourceForPath("/api/public/kiosk/abc123/orders"), "order-preparations");
    // Everything else the screen does is a read. The grid asks for its
    // thumbnails in batches while someone browses; publishing those is the
    // unfiltered-refetch loop that locked the shop out with 429s before.
    assert.equal(resourceForPath("/api/public/kiosk/abc123/thumbnails"), null);
  });

  test("a rep's document edits map to what they change, never «all»", () => {
    assert.equal(resourceForPath("/api/sales-agent/invoices/abc"), "invoices");
    assert.equal(resourceForPath("/api/sales-agent/invoices/abc/cancel"), "invoices");
    // Queues an approval; the receipt is untouched until the owner decides.
    assert.equal(resourceForPath("/api/sales-agent/receipts/abc/edit-request"), "approvals");
    assert.equal(resourceForPath("/api/sales-agent/receipts/abc/cancel-request"), "approvals");
    assert.equal(resourceForPath("/api/sales-agent/receipts/abc/send-whatsapp"), null);
    assert.equal(resourceForPath("/api/sales-agent/receipts"), "vouchers");
    assert.equal(resourceForPath("/api/areas/123"), "customers");
  });

  test("the owner's rep screen no longer falls through to «all»", () => {
    assert.equal(resourceForPath("/api/sales-agent-admin/handovers"), "vouchers");
    assert.equal(resourceForPath("/api/sales-agent-admin/settlements"), "vouchers");
    assert.equal(resourceForPath("/api/sales-agent-admin/visit-plan/1"), "customers");
    assert.equal(resourceForPath("/api/sales-agent-admin/customers/1/location"), "customers");
    assert.equal(resourceForPath("/api/sales-agent-admin/activity/read"), "notifications");
    assert.equal(resourceForPath("/api/sales-agent-admin/edit-modes/1"), "users");
    assert.equal(resourceForPath("/api/sales-agent-admin/anything-new"), null);
  });

  test("query strings never change the answer", () => {
    assert.equal(resourceForPath("/api/public/catalog/thumbnails?access=abc"), null);
    assert.equal(resourceForPath("/api/products?limit=50"), "products");
  });

  test("sales-agent reads never broadcast; its writes stay scoped (never «all»)", () => {
    assert.equal(resourceForPath("/api/sales-agent/products/thumbnails"), null);
    assert.equal(resourceForPath("/api/sales-agent/customers/lookup"), null);
    assert.equal(resourceForPath("/api/sales-agent/orders/preview"), null);
    assert.equal(resourceForPath("/api/sales-agent/visits/plan"), null);
    assert.equal(resourceForPath("/api/sales-agent/orders"), "approvals");
    assert.equal(resourceForPath("/api/sales-agent/receipts"), "vouchers");
    assert.equal(resourceForPath("/api/sales-agent/customers"), "customers");
  });
});
