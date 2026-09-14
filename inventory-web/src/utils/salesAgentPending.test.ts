/**
 * The pending-attempt queue: what survives a reload, and what must not.
 *
 * The queue is DERIVED from the one saved workspace rather than stored twice,
 * so these tests are the guard that a reload cannot lose an unconfirmed order,
 * duplicate one, or resurrect a corrupted payload.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { draftKey, pendingAttempts, readAgentWorkspace, type AgentWorkspace } from "./salesAgentDrafts"

const customerId = "11111111-1111-4111-8111-111111111111"
const otherCustomerId = "22222222-2222-4222-8222-222222222222"
const productId = "33333333-3333-4333-8333-333333333333"
const requestId = "44444444-4444-4444-8444-444444444444"
const token = "a".repeat(64)

const line = { productId, unit: "CARTON" as const, quantity: 2 }

const payload = (patch: Record<string, unknown> = {}) => ({
  customerId,
  priceMode: "WHOLESALE" as const,
  clientRequestId: requestId,
  items: [line],
  reviewToken: token,
  ...patch,
})

const meta = (patch: Record<string, unknown> = {}) => ({
  createdAt: 1_700_000_000_000,
  lastAttemptAt: 1_700_000_060_000,
  attempts: 2,
  subtotal: 48000,
  customerName: "زبوني",
  ...patch,
})

const stored = (workspace: Partial<AgentWorkspace> & { drafts: Record<string, unknown> }) =>
  readAgentWorkspace(JSON.stringify({ customerId: null, mode: "WHOLESALE", ...workspace }))

test("an unconfirmed attempt survives a reload with its key, time and total", () => {
  const workspace = stored({
    drafts: { [draftKey("WHOLESALE", customerId)]: { items: [line], notes: "ملاحظة", pending: payload(), pendingMeta: meta() } },
  })
  const rows = pendingAttempts(workspace)
  assert.equal(rows.length, 1)
  // The SAME key: this is what makes a retry a re-check instead of a new order.
  assert.equal(rows[0].payload?.clientRequestId, requestId)
  assert.equal(rows[0].meta?.subtotal, 48000)
  assert.equal(rows[0].meta?.attempts, 2)
  assert.equal(rows[0].customerId, customerId)
  assert.equal(rows[0].lineCount, 1)
})

test("a settled attempt keeps its reason on screen after the payload is dropped", () => {
  const workspace = stored({
    drafts: {
      [draftKey("WHOLESALE", customerId)]: {
        items: [line],
        notes: "",
        // No payload: nothing can re-send it.
        pendingMeta: meta({ settled: true, reason: "تغيّرت الأسعار؛ راجع الطلب" }),
      },
    },
  })
  const rows = pendingAttempts(workspace)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].payload, undefined)
  assert.equal(rows[0].meta?.settled, true)
  assert.equal(rows[0].meta?.reason, "تغيّرت الأسعار؛ راجع الطلب")
})

test("attempts for different customers and price modes are listed separately, newest first", () => {
  const workspace = stored({
    drafts: {
      [draftKey("WHOLESALE", customerId)]: { items: [line], notes: "", pending: payload(), pendingMeta: meta({ createdAt: 1000 }) },
      [draftKey("CARTON", otherCustomerId)]: {
        items: [line],
        notes: "",
        pending: payload({ customerId: otherCustomerId, priceMode: "CARTON", clientRequestId: "55555555-5555-4555-8555-555555555555" }),
        pendingMeta: meta({ createdAt: 2000 }),
      },
    },
  })
  const rows = pendingAttempts(workspace)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].customerId, otherCustomerId, "newest first")
  assert.equal(rows[0].mode, "CARTON")
  assert.notEqual(rows[0].payload?.clientRequestId, rows[1].payload?.clientRequestId)
})

test("a corrupt meta never discards the attempt it describes", () => {
  const workspace = stored({
    drafts: {
      // Deliberately the wrong type: this is what a hand-edited or partly
      // written storage file looks like.
      [draftKey("WHOLESALE", customerId)]: { items: [line], notes: "", pending: payload(), pendingMeta: { createdAt: "غلط" } as unknown as never },
    },
  })
  const rows = pendingAttempts(workspace)
  assert.equal(rows.length, 1, "the payload is what matters; the meta is display only")
  assert.equal(rows[0].meta, undefined)
  assert.equal(rows[0].payload?.clientRequestId, requestId)
})

test("a payload whose review token or key is broken is not restored as sendable", () => {
  for (const patch of [{ reviewToken: "short" }, { clientRequestId: "not-a-uuid" }, { priceMode: "RETAIL" }]) {
    const workspace = stored({
      drafts: { [draftKey("WHOLESALE", customerId)]: { items: [line], notes: "", pending: payload(patch) } },
    })
    const rows = pendingAttempts(workspace)
    assert.equal(rows.length, 0, JSON.stringify(patch))
  }
})

test("a payload stored under another customer's draft key is not restored", () => {
  // Otherwise a rewritten storage file could send one customer's order under
  // another customer's cart.
  const workspace = stored({
    drafts: { [draftKey("WHOLESALE", otherCustomerId)]: { items: [line], notes: "", pending: payload() } },
  })
  assert.equal(pendingAttempts(workspace).length, 0)
})

test("meta fields are clamped, so a corrupted file cannot render absurd values", () => {
  const workspace = stored({
    drafts: {
      [draftKey("WHOLESALE", customerId)]: {
        items: [line],
        notes: "",
        pending: payload(),
        pendingMeta: meta({ attempts: 10_000, reason: "x".repeat(5000), lastAttemptAt: 0 }),
      },
    },
  })
  const row = pendingAttempts(workspace)[0]
  assert.equal(row.meta?.attempts, 999)
  assert.equal(row.meta?.reason?.length, 300)
  // A missing last attempt falls back to when the attempt was created.
  assert.equal(row.meta?.lastAttemptAt, 1_700_000_000_000)
})

test("a draft with neither payload nor meta is not a pending attempt", () => {
  const workspace = stored({
    drafts: { [draftKey("WHOLESALE", customerId)]: { items: [line], notes: "مسودة عادية" } },
  })
  assert.equal(pendingAttempts(workspace).length, 0)
})
