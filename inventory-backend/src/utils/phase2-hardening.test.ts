// Regression tests for the phase-2 audit hardening.
//
// Each test below pins a behaviour that was previously wrong in a way the type
// system could not catch — an uncapped array, a missing schema field, a default
// that silently hid data, a secret written to the log stream.

import assert from "node:assert/strict";
import test from "node:test";
import {
  customerDebtsReportSchema,
  retailAiChatSchema,
  submitRetailOrderSchema,
  updateInvoiceSchema,
  validatePromoSchema,
} from "./schemas";
import { redactUrl } from "../middleware/request-logger.middleware";

const UUID = "11111111-1111-1111-1111-111111111111";

// ── updateInvoiceSchema.customerId ──────────────────────────────────────────
// validate() REPLACES req.body with the parsed result. customerId was missing
// from the schema, so both edit UIs sent it and it was deleted before the
// service saw it — the whole customer-reassignment branch was dead code and
// reassigning an invoice silently did nothing.

test("invoice edit: customerId survives validation", () => {
  const parsed = updateInvoiceSchema.parse({
    params: { id: UUID },
    body: {
      customerId: UUID,
      discount: 0,
      tax: 0,
      paidAmount: 0,
      items: [{ productId: UUID, unit: "PIECE", quantity: 1, unitPrice: 1000 }],
    },
  });
  assert.equal(parsed.body.customerId, UUID);
});

test("invoice edit: customerId stays optional", () => {
  const parsed = updateInvoiceSchema.parse({
    params: { id: UUID },
    body: {
      discount: 0,
      tax: 0,
      paidAmount: 0,
      items: [{ productId: UUID, unit: "PIECE", quantity: 1, unitPrice: 1000 }],
    },
  });
  assert.equal(parsed.body.customerId, undefined);
});

// ── submitRetailOrderSchema.items cap ───────────────────────────────────────
// Unauthenticated endpoint. Uncapped, an 8 MB body is ~100k line items all
// processed inside one Serializable transaction.

function retailOrderBody(itemCount: number) {
  return {
    body: {
      customerName: "زبون تجريبي",
      phone: "07701234567",
      items: Array.from({ length: itemCount }, () => ({
        retailItemId: UUID,
        quantity: 1,
      })),
    },
  };
}

test("public retail order: accepts a normal basket", () => {
  const parsed = submitRetailOrderSchema.parse(retailOrderBody(200));
  assert.equal(parsed.body.items.length, 200);
});

test("public retail order: rejects an oversized basket", () => {
  assert.throws(() => submitRetailOrderSchema.parse(retailOrderBody(201)));
});

test("public retail order: still requires at least one line", () => {
  assert.throws(() => submitRetailOrderSchema.parse(retailOrderBody(0)));
});

// ── validatePromoSchema ─────────────────────────────────────────────────────
// The route had no schema at all, so `code.trim()` on an absent field threw a
// TypeError → an unauthenticated 500 that also wrote an ErrorLog row.

test("validate-promo: a missing code is a 400, not a crash", () => {
  assert.throws(() => validatePromoSchema.parse({ body: {} }));
});

test("validate-promo: accepts a code with an optional customerId", () => {
  const parsed = validatePromoSchema.parse({
    body: { code: "  EID2026  ", customerId: UUID },
  });
  assert.equal(parsed.body.code, "EID2026");
  assert.equal(parsed.body.customerId, UUID);
});

test("validate-promo: rejects a non-uuid customerId", () => {
  assert.throws(() =>
    validatePromoSchema.parse({ body: { code: "EID2026", customerId: "null" } }),
  );
});

// ── retailAiChatSchema ──────────────────────────────────────────────────────
// Every request is a paid LLM call on the merchant's account, previously with
// a completely unbounded prompt and history.

test("ai-chat: accepts a normal message", () => {
  const parsed = retailAiChatSchema.parse({ body: { message: "عندكم عصير؟" } });
  assert.equal(parsed.body.message, "عندكم عصير؟");
});

test("ai-chat: rejects an oversized prompt", () => {
  assert.throws(() =>
    retailAiChatSchema.parse({ body: { message: "x".repeat(1001) } }),
  );
});

test("ai-chat: rejects an oversized history", () => {
  assert.throws(() =>
    retailAiChatSchema.parse({
      body: {
        message: "hi",
        history: Array.from({ length: 21 }, () => ({
          role: "user" as const,
          content: "x",
        })),
      },
    }),
  );
});

test("ai-chat: rejects an empty message", () => {
  assert.throws(() => retailAiChatSchema.parse({ body: { message: "   " } }));
});

// ── customerDebtsReportSchema.maxDays ───────────────────────────────────────
// A default of 999 read as "no cap" but was a hard cap: the single most
// delinquent account (last transaction 3 years ago) was dropped from the
// dashboard's top-5 debts table while still counted in the total-debt KPI.

test("debt report: omitting maxDays means no upper bound", () => {
  const parsed = customerDebtsReportSchema.parse({ query: {} });
  assert.equal(parsed.query.maxDays, undefined);
});

test("debt report: an explicit maxDays is still honoured", () => {
  const parsed = customerDebtsReportSchema.parse({ query: { maxDays: "30" } });
  assert.equal(parsed.query.maxDays, 30);
});

// ── request logger redaction ────────────────────────────────────────────────
// requestLogger writes req.originalUrl for every request, so the full-database
// backup secret was landing verbatim in the platform log stream on every
// scheduled backup pull.

test("logger: masks the backup secret in the query string", () => {
  const out = redactUrl("/api/settings/backup/download?secret=super-secret-value");
  assert.ok(!out.includes("super-secret-value"), out);
  assert.ok(out.includes("secret=***"), out);
  assert.ok(out.startsWith("/api/settings/backup/download?"), out);
});

test("logger: masks token-like keys and keeps the rest readable", () => {
  const out = redactUrl("/api/x?page=2&token=abc123&sort=name");
  assert.ok(!out.includes("abc123"), out);
  assert.ok(out.includes("page=2"), out);
  assert.ok(out.includes("sort=name"), out);
});

test("logger: leaves ordinary URLs untouched", () => {
  assert.equal(redactUrl("/api/products"), "/api/products");
  assert.equal(redactUrl("/api/products?page=2"), "/api/products?page=2");
});
