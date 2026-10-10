import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { applyPrepCounts, markFromCount, prepCountDiffs, prepLineKeys, type PrepLineStatus } from "./prepScreen"

const st = (state: PrepLineStatus["state"], found?: number): PrepLineStatus => ({ state, found, by: "Safi", at: 1 })

describe("prep screen math", () => {
  test("line keys: product + unit, repeats numbered", () => {
    const keys = prepLineKeys([
      { product: { id: "a" }, unit: "PIECE" },
      { product: { id: "a" }, unit: "CARTON" },
      { product: { id: "a" }, unit: "PIECE" },
      { product: { id: "b" }, unit: "PIECE" },
    ])
    assert.deepEqual(keys, ["a-PIECE", "a-CARTON", "a-PIECE#1", "b-PIECE"])
    assert.equal(new Set(keys).size, keys.length, "keys are unique")
  })

  test("worker count → mark", () => {
    assert.deepEqual(markFromCount(5, 5), { state: "done" })
    assert.deepEqual(markFromCount(5, 3), { state: "short", found: 3 })
    assert.deepEqual(markFromCount(5, 0), { state: "short", found: 0 })
    assert.deepEqual(markFromCount(5, 8), { state: "count", found: 8 })
  })

  test("diffs: only short/count that differ from the invoice", () => {
    const items = [{ quantity: 5 }, { quantity: 4 }, { quantity: 2 }, { quantity: 6 }, { quantity: 3 }]
    const keys = ["k0", "k1", "k2", "k3", "k4"]
    const diffs = prepCountDiffs(items, keys, {
      k0: st("done"),
      k1: st("short", 1),
      k2: st("count", 9),
      k3: st("short", 6), // already applied (6 = 6) — not a diff
      // k4 unmarked
    })
    assert.deepEqual(diffs, [{ index: 1, found: 1 }, { index: 2, found: 9 }])
  })

  test("apply: set counts, remove zeros, remember the original once", () => {
    const items: Array<{ name: string; quantity: number; prepAdjustedFrom?: number }> = [
      { name: "a", quantity: 5 },
      { name: "b", quantity: 4 },
      { name: "c", quantity: 2 },
      { name: "d", quantity: 7 },
    ]
    const out = applyPrepCounts(items, [{ index: 1, found: 0 }, { index: 2, found: 9 }, { index: 3, found: 3 }])
    assert.deepEqual(out.map((i) => i.name), ["a", "c", "d"], "zero-found line removed, order kept")
    assert.deepEqual(out.map((i) => i.quantity), [5, 9, 3])
    assert.equal(out[0].prepAdjustedFrom, undefined, "untouched line has no marker")
    assert.equal(out[1].prepAdjustedFrom, 2)
    assert.equal(out[2].prepAdjustedFrom, 7)
    // Applying again keeps the FIRST original, not the intermediate value.
    const again = applyPrepCounts(out, [{ index: 2, found: 1 }])
    assert.equal(again[2].quantity, 1)
    assert.equal(again[2].prepAdjustedFrom, 7)
    // Inputs are not mutated.
    assert.equal(items[1].quantity, 4)
  })

  test("after applying, the same statuses produce no further diffs", () => {
    const items = [{ quantity: 5 }, { quantity: 4 }]
    const keys = ["k0", "k1"]
    const statuses = { k0: st("short", 2), k1: st("count", 6) }
    const applied = applyPrepCounts(items, prepCountDiffs(items, keys, statuses))
    assert.deepEqual(prepCountDiffs(applied, keys, statuses), [])
  })

  test("duplicate product lines: removing the first never moves its mark to the second", () => {
    const items = [
      { product: { id: "a" }, unit: "PIECE", quantity: 5 },
      { product: { id: "a" }, unit: "PIECE", quantity: 3 },
    ]
    const keys = prepLineKeys(items) // ["a-PIECE", "a-PIECE#1"]
    const statuses = { "a-PIECE": st("short", 0) } // first: none found; second: unmarked
    const applied = applyPrepCounts(items, prepCountDiffs(items, keys, statuses), keys)
    assert.equal(applied.length, 1)
    assert.equal(applied[0].quantity, 3, "the second line survives untouched")
    assert.deepEqual(prepLineKeys(applied), ["a-PIECE#1"], "it keeps its own key")
    assert.deepEqual(prepCountDiffs(applied, prepLineKeys(applied), statuses), [], "and does not inherit the removed line's mark")
    // A new duplicate added later gets a fresh key, not a frozen one.
    const more = [...applied, { product: { id: "a" }, unit: "PIECE", quantity: 1 }]
    assert.deepEqual(prepLineKeys(more), ["a-PIECE#1", "a-PIECE"])
  })
})