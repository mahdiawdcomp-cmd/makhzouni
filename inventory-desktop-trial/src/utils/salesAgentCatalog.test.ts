import { test } from "node:test"
import assert from "node:assert/strict"
import { agentDefaultUnit, agentWholesaleUnits, stableThumbnailBatches } from "./salesAgentCatalog"
test("wholesale has all four units and does not default to carton", () => {
  assert.deepEqual(agentWholesaleUnits, ["PIECE", "DOZEN", "BOX", "CARTON"])
  assert.equal(agentDefaultUnit("WHOLESALE", 100), "DOZEN")
  assert.equal(agentDefaultUnit("WHOLESALE", 5), "PIECE")
  assert.equal(agentDefaultUnit("CARTON", 100), "CARTON")
})
test("scrolling only enables fixed image batches; it never changes the loaded batch key", () => {
  const ids = Array.from({ length: 75 }, (_, i) => String(i))
  const initial = stableThumbnailBatches(ids, ["0", "1"])
  const scrolled = stableThumbnailBatches(ids, ["0", "1", "24", "50"])
  assert.deepEqual(initial.map(b => b.ids), scrolled.map(b => b.ids))
  assert.deepEqual(initial.map(b => b.enabled), [true, false, false, false])
  assert.deepEqual(scrolled.map(b => b.enabled), [true, true, true, false])
  assert.ok(scrolled.every(b => b.ids.length <= 24))
})
