import assert from "node:assert/strict";
import test from "node:test";
import { matchScore, normalizeIraqiText } from "./voice.controller";

test("normalizes common Arabic letter variants", () => {
  assert.equal(normalizeIraqiText("آلاء"), normalizeIraqiText("الاء"));
  assert.equal(normalizeIraqiText("طيّارة"), normalizeIraqiText("طياره"));
});

test("matches close Iraqi product and customer pronunciations", () => {
  assert.ok(matchScore("طياره", "طيارة أطفال") >= 0.48);
  assert.ok(matchScore("عباس", "عباس أحمد") >= 0.48);
  assert.ok(matchScore("محمد", "طائرة ريموت") < 0.48);
});
