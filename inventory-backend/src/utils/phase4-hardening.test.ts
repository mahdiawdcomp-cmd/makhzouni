// Regression tests for the final audit round (accounting, public catalog).

import assert from "node:assert/strict";
import test from "node:test";
import {
  createVoucherSchema,
  guestCatalogEnterSchema,
  submitRetailOrderSchema,
  updateVoucherSchema,
} from "./schemas";

const UUID = "11111111-1111-1111-1111-111111111111";

// ── voucher `date` survives validation ──────────────────────────────────────
// Both clients have always sent a date. It was absent from the schema, so
// validate() deleted it and the service fell back to new Date() — a raw
// server-UTC timestamp that filed a 01:30 Iraq receipt under the previous day.

test("voucher create: date survives validation", () => {
  const parsed = createVoucherSchema.parse({
    body: {
      customerId: UUID,
      amount: 500000,
      type: "RECEIPT",
      date: "2026-08-02",
    },
  });
  assert.equal(parsed.body.date, "2026-08-02");
});

test("voucher update: date survives validation", () => {
  const parsed = updateVoucherSchema.parse({
    params: { id: UUID },
    body: { amount: 1000, date: "2026-08-02" },
  });
  assert.equal(parsed.body.date, "2026-08-02");
});

test("voucher create: date stays optional", () => {
  const parsed = createVoucherSchema.parse({
    body: { customerId: UUID, amount: 500000, type: "RECEIPT" },
  });
  assert.equal(parsed.body.date, undefined);
});

// ── retail order: referralCode and warehouseId reach the service ───────────
// The service read both; the schema declared neither, so validate() stripped
// them. The shop rendered a referral discount the backend never applied.

function retailOrderBody(extra: Record<string, unknown> = {}) {
  return {
    body: {
      customerName: "زبون",
      phone: "07701234567",
      items: [{ retailItemId: UUID, quantity: 1 }],
      ...extra,
    },
  };
}

test("retail order: referralCode survives validation", () => {
  const parsed = submitRetailOrderSchema.parse(retailOrderBody({ referralCode: "REF123" }));
  assert.equal(parsed.body.referralCode, "REF123");
});

test("retail order: warehouseId survives validation", () => {
  const parsed = submitRetailOrderSchema.parse(retailOrderBody({ warehouseId: UUID }));
  assert.equal(parsed.body.warehouseId, UUID);
});

test("retail order: a non-uuid warehouseId is rejected", () => {
  assert.throws(() => submitRetailOrderSchema.parse(retailOrderBody({ warehouseId: "null" })));
});

// ── guest catalog entry is validated ───────────────────────────────────────
// The only public catalog route mounted without a schema, and it creates a
// lead row and fires an admin WhatsApp per unseen phone.

test("guest-enter: requires a plausible phone", () => {
  assert.throws(() => guestCatalogEnterSchema.parse({ body: {} }));
  assert.throws(() => guestCatalogEnterSchema.parse({ body: { phone: "0770" } }));
});

test("guest-enter: accepts and trims a real phone", () => {
  const parsed = guestCatalogEnterSchema.parse({ body: { phone: "  07701234567  " } });
  assert.equal(parsed.body.phone, "07701234567");
});
