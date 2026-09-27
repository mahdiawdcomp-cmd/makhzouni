import { before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";

// In-memory stand-ins: the service writes orders through to prep_orders and
// looks up workers; no push is sent (no VAPID keys in tests).
const fakePrisma = {
  prepOrderState: {
    upsert: async () => ({}),
    deleteMany: async () => ({ count: 0 }),
    findMany: async () => [],
  },
  user: { findMany: async () => [], findUnique: async () => ({ name: "Safi" }) },
  staffPushSubscription: { findMany: async () => [] },
};
mock.module("../config/database", { exports: { default: fakePrisma } });

type Svc = typeof import("./prep-screen.service");
let svc: Svc;

const line = (key: string, quantity = 5) => ({ key, name: key, imageUrl: null, quantity, unit: "PIECE" as const });
let clock = 1_000;
const snap = (draftId: string, lines: ReturnType<typeof line>[]) => ({ draftId, customerName: null, lines, updatedAt: ++clock });
const ids = () => svc.getPrepState().orders.map((o) => o.snapshot.draftId);
const order = (id: string) => svc.getPrepState().orders.find((o) => o.snapshot.draftId === id);

describe("prep-screen order state", () => {
  before(async () => { svc = await import("./prep-screen.service"); });

  test("only the open invoice is kept when nothing was sent", () => {
    svc.setPrepLive(snap("A", [line("p1")]));
    assert.deepEqual(ids(), ["A"]);
    svc.setPrepLive(snap("B", [line("p2")]));
    assert.deepEqual(ids(), ["B"], "leaving an unsent invoice drops it");
    svc.setPrepLive(snap("idle-x", []));
    assert.deepEqual(ids(), [], "saving/emptying an unsent invoice drops it");
  });

  test("an older snapshot of the same invoice never overwrites a newer one", () => {
    const newer = snap("C", [line("p1", 7)]);
    const older = { ...snap("C", [line("p1", 2)]), updatedAt: newer.updatedAt - 10 };
    svc.setPrepLive(newer);
    svc.setPrepLive(older);
    assert.equal(order("C")?.snapshot.lines[0].quantity, 7);
  });

  test("a sent order survives the cashier moving on, and keeps worker marks", async () => {
    await svc.sendPrepOrder(snap("S1", [line("p1"), line("p2")]), { urgent: true, note: null, targetUserId: null }, "Mahdi");
    assert.ok(svc.markPrepLine("S1", "p1", { state: "short", found: 3 }, "Safi"));
    svc.setPrepLive(snap("next", [line("p9")]));
    const s1 = order("S1");
    assert.ok(s1, "sent order still there");
    assert.deepEqual(s1!.statuses.p1 && { state: s1!.statuses.p1.state, found: s1!.statuses.p1.found }, { state: "short", found: 3 });
    assert.equal(s1!.sent?.urgent, true);
    assert.equal(s1!.sent?.ack?.by, "Safi", "marking a line counts as receiving it");
  });

  test("re-sending resets the receipt and reminders but keeps the marks", async () => {
    await svc.sendPrepOrder(snap("S1", [line("p1"), line("p2")]), { urgent: false, note: "x", targetUserId: null }, "Mahdi");
    const s1 = order("S1")!;
    assert.equal(s1.sent?.ack, null);
    assert.equal(s1.sent?.reminders, 0);
    assert.equal(s1.statuses.p1?.found, 3);
  });

  test("emptying a SENT invoice cancels it; cancelling is idempotent", () => {
    svc.setPrepLive(snap("S1", []));
    assert.ok(order("S1")?.cancelled, "cancelled");
    const at = order("S1")!.cancelled!.at;
    svc.setPrepLive(snap("S1", []));
    assert.equal(order("S1")!.cancelled!.at, at, "not re-cancelled");
  });

  test("marks on an unknown order are refused; clearing a mark removes it", async () => {
    assert.equal(svc.markPrepLine("nope", "p1", { state: "done" }, "Safi"), false);
    await svc.sendPrepOrder(snap("S2", [line("p1")]), { urgent: false, note: null, targetUserId: null }, "Mahdi");
    svc.markPrepLine("S2", "p1", { state: "count", found: 8 }, "Safi");
    assert.equal(order("S2")!.statuses.p1.found, 8);
    svc.markPrepLine("S2", "p1", null, "Safi");
    assert.equal(order("S2")!.statuses.p1, undefined);
  });

  test("ORDER READY takes it off the open list and acks it", async () => {
    await svc.sendPrepOrder(snap("S3", [line("p1")]), { urgent: false, note: null, targetUserId: null }, "Mahdi");
    assert.ok(svc.markPrepReady("S3", true, "Ali"));
    const s3 = order("S3")!;
    assert.equal(s3.ready?.by, "Ali");
    assert.equal(s3.sent?.ack?.by, "Ali");
  });
});
