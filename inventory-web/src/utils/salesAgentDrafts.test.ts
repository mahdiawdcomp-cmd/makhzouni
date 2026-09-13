import { test } from "node:test"
import assert from "node:assert/strict"
import { cartonEligible, cleanAgentLines, draftKey, isDefinitiveOrderRejection, mergeAgentDrafts, readAgentWorkspace, workspaceKey } from "./salesAgentDrafts"
const id = "11111111-1111-4111-8111-111111111111"
const line = { productId: id, unit: "CARTON" as const, quantity: 2 }
test("auth/ownership/server failures do not unlock an uncertain request", () => {
  for (const code of [undefined, "TOKEN_REVOKED", "CUSTOMER_NOT_IN_SCOPE", "FEATURE_NOT_ENABLED", "P2002"]) assert.equal(isDefinitiveOrderRejection(code), false)
  assert.equal(isDefinitiveOrderRejection("ORDER_REVIEW_CHANGED"), true)
})
test("guest/carton/wholesale and different reps never share draft keys", () => {
  assert.notEqual(draftKey("WHOLESALE", null), draftKey("CARTON", null))
  assert.notEqual(draftKey("WHOLESALE", id), draftKey("WHOLESALE", null))
  assert.notEqual(workspaceKey("a"), workspaceKey("b"))
})
test("malformed storage is safe and invalid quantities are not restored", () => {
  assert.equal(readAgentWorkspace("{").customerId, null)
  assert.equal(cleanAgentLines([line, { ...line, quantity: -1 }, { ...line, quantity: .5 }, { ...line, productId: "bad" }]).length, 1)
  assert.deepEqual(readAgentWorkspace('{"drafts":null}').drafts, {})
})
test("merging preserves quantities and both notes without mutating original drafts", () => {
  const a = { items: [line], notes: "قديم" }
  const b = { items: [{ ...line, quantity: 3 }], notes: "جديد" }
  const merged = mergeAgentDrafts(a, b)
  assert.equal(merged.items[0].quantity, 5)
  assert.equal(a.items[0].quantity, 2)
  assert.equal(merged.notes, "قديم\nجديد")
})
test("carton distribution hides absent/zero/invalid prices, hidden cartons and insufficient stock", () => {
  const p = { cartonPiecePrice: 750, pcsPerCarton: 48, currentStock: 48, hiddenUnits: [] as string[] }
  assert.equal(cartonEligible(p), true)
  for (const cartonPiecePrice of [0, -1, null, undefined, NaN]) assert.equal(cartonEligible({ ...p, cartonPiecePrice }), false)
  for (const currentStock of [47, 0, -1]) assert.equal(cartonEligible({ ...p, currentStock }), false)
  assert.equal(cartonEligible({ ...p, hiddenUnits: ["CARTON"] }), false)
})
test("reload preserves an uncertain request exactly for idempotent retry", () => {
  const key = draftKey("CARTON", id)
  const pending = { customerId: id, priceMode: "CARTON" as const, clientRequestId: id, items: [line], reviewToken: "a".repeat(64), notes: "طلب" }
  const state = readAgentWorkspace(JSON.stringify({ mode: "CARTON", customerId: id, drafts: { [key]: { items: [line], notes: "طلب", pending } } }))
  assert.deepEqual(state.drafts[key].pending, pending)
  assert.throws(() => mergeAgentDrafts(state.drafts[key], { items: [], notes: "" }))
})
test("a pending payload belonging to a different customer is not restored into this draft", () => {
  const state = readAgentWorkspace(JSON.stringify({ drafts: { [draftKey("CARTON", null)]: { items: [line], pending: { customerId: id, priceMode: "CARTON", clientRequestId: id, reviewToken: "a".repeat(64), items: [line] } } } }))
  assert.equal(state.drafts[draftKey("CARTON", null)].pending, undefined)
})
test("oversized merged quantities are rejected rather than silently truncated", () => {
  assert.throws(() => mergeAgentDrafts({ items: [{ ...line, quantity: 100000 }], notes: "" }, { items: [line], notes: "" }))
})
