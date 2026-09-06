import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizePhone, phoneVariants } from "./phone"

test("normalizePhone keeps the canonical international shape", () => {
  assert.equal(normalizePhone("07700178343"), "9647700178343")
  assert.equal(normalizePhone("9647700178343"), "9647700178343")
  assert.equal(normalizePhone("+964 770 017 8343"), "9647700178343")
})

/**
 * The rep's duplicate check searched only the canonical form and answered
 * «ما موجود» for a customer stored as «07…» — so the rep created a second
 * record for someone they already sell to.
 */
test("phoneVariants covers every spelling of the same number", () => {
  const v = phoneVariants("07700178343")
  assert.ok(v.includes("9647700178343"), "international")
  assert.ok(v.includes("07700178343"), "local with the zero")
  assert.ok(v.includes("7700178343"), "bare national")

  // However it is typed, the same set comes back.
  assert.deepEqual(new Set(phoneVariants("9647700178343")), new Set(v))
  assert.deepEqual(new Set(phoneVariants("+964 770 017 8343")), new Set(v))
})

test("phoneVariants is empty for nothing", () => {
  assert.deepEqual(phoneVariants(""), [])
  assert.deepEqual(phoneVariants(null), [])
  assert.deepEqual(phoneVariants("abc"), [])
})
