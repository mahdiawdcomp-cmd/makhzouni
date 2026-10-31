import assert from "node:assert/strict";
import { test } from "node:test";
import { unitSuggestion } from "./line-count.service";

const line = (id: string, qty: number, unit: "PIECE" | "CARTON", ppc: number) => ({
  id,
  qty,
  unit,
  qtyPieces: unit === "CARTON" ? qty * ppc : qty,
});

test("worker wrote cartons for pieces — flip explains the gap", () => {
  // system 360 pieces (3 cartons of 120); worker typed 300 as cartons = 36000
  const s = unitSuggestion(360, 36000, 120, [line("a", 300, "CARTON", 120)]);
  assert.deepEqual(s, { lineIds: ["a"], countedQty: 300, delta: -60 });
});

test("worker wrote pieces for cartons — flip explains the gap", () => {
  // system 480 pieces = 4 cartons of 120; worker typed 4 as pieces
  const s = unitSuggestion(480, 4, 120, [line("a", 4, "PIECE", 120)]);
  assert.deepEqual(s, { lineIds: ["a"], countedQty: 480, delta: 0 });
});

test("only the one wrong line among several is flipped", () => {
  // 2 cartons (240) right + a line of 3 typed as pieces that was 3 cartons
  const s = unitSuggestion(600, 243, 120, [line("a", 2, "CARTON", 120), line("b", 3, "PIECE", 120)]);
  assert.deepEqual(s, { lineIds: ["b"], countedQty: 600, delta: 0 });
});

test("no stock in the system — never guesses", () => {
  assert.equal(unitSuggestion(0, 464000, 320, [line("a", 1450, "CARTON", 320)]), null);
});

test("a real shortage that a flip does not explain — no suggestion", () => {
  // system 7776, counted 210 pieces: flipping gives 25200, far off
  assert.equal(unitSuggestion(7776, 210, 72, [line("a", 210, "PIECE", 72)]), null);
});

test("a gap smaller than one carton — no suggestion", () => {
  assert.equal(unitSuggestion(100, 95, 12, [line("a", 95, "PIECE", 12)]), null);
});

test("products without cartons — no suggestion", () => {
  assert.equal(unitSuggestion(50, 5, 1, [line("a", 5, "PIECE", 1)]), null);
});
