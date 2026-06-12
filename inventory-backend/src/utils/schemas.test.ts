import assert from "node:assert/strict";
import test from "node:test";
import {
  listCustomersSchema,
  listProductsSchema,
  listInvoicesSchema,
  listQuotationsSchema,
  listVouchersSchema,
} from "./schemas";

// ── customers ───────────────────────────────────────────────────────────────

test("customers: default limit is 20", () => {
  const result = listCustomersSchema.parse({ query: {} });
  assert.equal(result.query.limit, 20);
  assert.equal(result.query.page, 1);
});

test("customers: accepts limit up to 5000", () => {
  const result = listCustomersSchema.parse({ query: { limit: "5000" } });
  assert.equal(result.query.limit, 5000);
});

test("customers: rejects limit above 5000", () => {
  assert.throws(
    () => listCustomersSchema.parse({ query: { limit: "5001" } }),
    /too_big|Number must be less/
  );
});

test("customers: isSupplier string is coerced to boolean", () => {
  const trueResult = listCustomersSchema.parse({ query: { isSupplier: "true" } });
  const falseResult = listCustomersSchema.parse({ query: { isSupplier: "false" } });
  assert.equal(trueResult.query.isSupplier, true);
  assert.equal(falseResult.query.isSupplier, false);
});

test("customers: includeDeleted defaults to false", () => {
  const result = listCustomersSchema.parse({ query: {} });
  assert.equal(result.query.includeDeleted, false);
});

// ── products ────────────────────────────────────────────────────────────────

test("products: default limit is 20", () => {
  const result = listProductsSchema.parse({ query: {} });
  assert.equal(result.query.limit, 20);
});

test("products: accepts limit up to 10000", () => {
  const result = listProductsSchema.parse({ query: { limit: "10000" } });
  assert.equal(result.query.limit, 10000);
});

test("products: rejects limit above 10000", () => {
  assert.throws(
    () => listProductsSchema.parse({ query: { limit: "10001" } }),
    /too_big|Number must be less/
  );
});

test("products: lowStock string is coerced to boolean", () => {
  const result = listProductsSchema.parse({ query: { lowStock: "true" } });
  assert.equal(result.query.lowStock, true);
});

// ── invoices ────────────────────────────────────────────────────────────────

test("invoices: default limit is 20", () => {
  const result = listInvoicesSchema.parse({ query: {} });
  assert.equal(result.query.limit, 20);
});

test("invoices: accepts limit up to 1000 (raised from 100)", () => {
  const result = listInvoicesSchema.parse({ query: { limit: "1000" } });
  assert.equal(result.query.limit, 1000);
});

test("invoices: rejects limit above 1000", () => {
  assert.throws(
    () => listInvoicesSchema.parse({ query: { limit: "1001" } }),
    /too_big|Number must be less/
  );
});

test("invoices: valid status values accepted", () => {
  const active = listInvoicesSchema.parse({ query: { status: "ACTIVE" } });
  const cancelled = listInvoicesSchema.parse({ query: { status: "CANCELLED" } });
  assert.equal(active.query.status, "ACTIVE");
  assert.equal(cancelled.query.status, "CANCELLED");
});

test("invoices: invalid status rejected", () => {
  assert.throws(
    () => listInvoicesSchema.parse({ query: { status: "DELETED" } }),
    /invalid_enum_value/
  );
});

test("invoices: valid type values accepted", () => {
  ["SALE", "PURCHASE", "SALES_RETURN"].forEach((type) => {
    const result = listInvoicesSchema.parse({ query: { type } });
    assert.equal(result.query.type, type);
  });
});

// ── quotations ──────────────────────────────────────────────────────────────

test("quotations: default limit is 20", () => {
  const result = listQuotationsSchema.parse({ query: {} });
  assert.equal(result.query.limit, 20);
});

test("quotations: accepts limit up to 1000 (raised from 100)", () => {
  const result = listQuotationsSchema.parse({ query: { limit: "1000" } });
  assert.equal(result.query.limit, 1000);
});

test("quotations: rejects limit above 1000", () => {
  assert.throws(
    () => listQuotationsSchema.parse({ query: { limit: "1001" } }),
    /too_big|Number must be less/
  );
});

test("quotations: all valid status values accepted", () => {
  ["PENDING", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED"].forEach((status) => {
    const result = listQuotationsSchema.parse({ query: { status } });
    assert.equal(result.query.status, status);
  });
});

// ── vouchers ────────────────────────────────────────────────────────────────

test("vouchers: default limit is 20", () => {
  const result = listVouchersSchema.parse({ query: {} });
  assert.equal(result.query.limit, 20);
});

test("vouchers: accepts limit up to 5000", () => {
  const result = listVouchersSchema.parse({ query: { limit: "5000" } });
  assert.equal(result.query.limit, 5000);
});

test("vouchers: rejects limit above 5000", () => {
  assert.throws(
    () => listVouchersSchema.parse({ query: { limit: "5001" } }),
    /too_big|Number must be less/
  );
});

test("vouchers: valid type values accepted", () => {
  ["RECEIPT", "PAYMENT", "EXPENSE"].forEach((type) => {
    const result = listVouchersSchema.parse({ query: { type } });
    assert.equal(result.query.type, type);
  });
});

// ── pagination defaults ──────────────────────────────────────────────────────

test("all schemas default to page 1", () => {
  for (const schema of [listCustomersSchema, listProductsSchema, listInvoicesSchema, listQuotationsSchema, listVouchersSchema]) {
    const result = schema.parse({ query: {} });
    assert.equal(result.query.page, 1, `${schema} did not default to page 1`);
  }
});

test("page must be at least 1", () => {
  for (const schema of [listCustomersSchema, listProductsSchema, listInvoicesSchema]) {
    assert.throws(
      () => schema.parse({ query: { page: "0" } }),
      /too_small|Number must be greater/
    );
  }
});
