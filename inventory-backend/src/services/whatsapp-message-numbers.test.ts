// Numbers that reach a CUSTOMER over WhatsApp. A wrong figure here is one the
// shop owner gets argued with, so these pin the formatting contract.

import assert from "node:assert/strict";
import test from "node:test";
import { balanceForCustomer } from "./whatsapp.service";

test("a positive balance reads as owed BY the customer", () => {
  assert.equal(balanceForCustomer(500000), "عليك 500,000");
});

test("a negative balance reads as owed TO the customer, without a minus sign", () => {
  const out = balanceForCustomer(-500000);
  assert.equal(out, "لك 500,000");
  assert.ok(!out.includes("-"), "a customer must never receive a bare negative number");
});

test("zero carries no direction word", () => {
  assert.equal(balanceForCustomer(0), "0");
});

test("thousands separators are always applied", () => {
  // The raw String(...) this replaced sent "1250000".
  assert.equal(balanceForCustomer(1250000), "عليك 1,250,000");
});

test("null, undefined and garbage degrade to 0 rather than NaN", () => {
  for (const value of [null, undefined, "abc", Number.NaN]) {
    assert.equal(balanceForCustomer(value), "0", `${String(value)} must not reach a customer`);
  }
});

test("Decimal-like strings from Prisma are formatted, not passed through", () => {
  assert.equal(balanceForCustomer("500000.00"), "عليك 500,000");
});
