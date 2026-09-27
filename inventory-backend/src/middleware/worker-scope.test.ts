import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { UserRole } from "@prisma/client";
import { assertWorkerScope, isWorkerOnlyUser } from "./worker-scope";

const worker = { role: UserRole.STAFF, permissions: ["VIEW_WITHOUT_PRICES", "REQUEST_TRANSFER", "PREP_NOTIFY"] };
const allowed = (u: typeof worker, m: string, p: string) => {
  try { assertWorkerScope(u, m, p); return true } catch { return false }
};

describe("worker-only API scope", () => {
  test("who counts as a worker", () => {
    assert.equal(isWorkerOnlyUser(worker), true);
    assert.equal(isWorkerOnlyUser({ role: UserRole.STAFF, permissions: ["REQUEST_TRANSFER"] }), true);
    assert.equal(isWorkerOnlyUser({ role: UserRole.ADMIN, permissions: ["REQUEST_TRANSFER"] }), false);
    // PREP_NOTIFY alone, or next to a real staff permission, is not a worker.
    assert.equal(isWorkerOnlyUser({ role: UserRole.STAFF, permissions: ["PREP_NOTIFY"] }), false);
    assert.equal(isWorkerOnlyUser({ role: UserRole.STAFF, permissions: ["REQUEST_TRANSFER", "MANAGE_INVOICES"] }), false);
    assert.equal(isWorkerOnlyUser({ role: UserRole.STAFF, permissions: [] }), false);
  });

  test("worker screens stay reachable", () => {
    assert.ok(allowed(worker, "GET", "/api/products"));
    assert.ok(allowed(worker, "GET", "/api/products/abc"));
    assert.ok(allowed(worker, "POST", "/api/transfers"));
    assert.ok(allowed(worker, "POST", "/api/stock-losses"));
    assert.ok(allowed(worker, "GET", "/api/approvals/my-requests"));
    assert.ok(allowed(worker, "PUT", "/api/prep-screen/live"));
    assert.ok(allowed(worker, "GET", "/api/auth/me"));
    assert.ok(allowed(worker, "GET", "/api/settings"));
  });

  test("everything else is refused", () => {
    assert.ok(!allowed(worker, "GET", "/api/invoices"));
    assert.ok(!allowed(worker, "GET", "/api/invoices/123"));
    assert.ok(!allowed(worker, "GET", "/api/customers"));
    assert.ok(!allowed(worker, "GET", "/api/reports/sales"));
    assert.ok(!allowed(worker, "GET", "/api/vouchers"));
    assert.ok(!allowed(worker, "GET", "/api/approvals"));
    assert.ok(!allowed(worker, "PUT", "/api/products/abc"));
    assert.ok(!allowed(worker, "PUT", "/api/settings"));
    assert.ok(!allowed(worker, "GET", "/api/productsx"));
  });

  test("non-workers are untouched", () => {
    assert.ok(allowed({ role: UserRole.STAFF, permissions: ["MANAGE_INVOICES"] }, "GET", "/api/invoices"));
    assert.ok(allowed({ role: UserRole.ADMIN, permissions: [] }, "GET", "/api/reports"));
  });
});
