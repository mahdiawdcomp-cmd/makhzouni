import assert from "node:assert/strict";
import { test } from "node:test";
import { withTxRetry } from "./tx-retry";

test("retries a deadlocked transaction, then succeeds", async () => {
  let calls = 0;
  const out = await withTxRetry(async () => {
    calls++;
    if (calls < 3) throw Object.assign(new Error("deadlock detected"), { code: "P2034" });
    return "ok";
  });
  assert.equal(out, "ok");
  assert.equal(calls, 3);
});

test("does not retry ordinary errors", async () => {
  let calls = 0;
  await assert.rejects(() => withTxRetry(async () => { calls++; throw new Error("نقص مخزون"); }), /نقص/);
  assert.equal(calls, 1);
});
