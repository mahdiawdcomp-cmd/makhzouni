import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeTestDatabaseUrl } from "./test-database-safety";

test("allows mocked tests with no database URL", () => {
  assert.doesNotThrow(() => assertSafeTestDatabaseUrl(undefined));
});

test("allows an explicitly named isolated test database", () => {
  assert.doesNotThrow(() => assertSafeTestDatabaseUrl("postgresql://localhost/inventory_test?schema=public"));
});

test("rejects a production-like database name without exposing credentials", () => {
  assert.throws(
    () => assertSafeTestDatabaseUrl("postgresql://private-user:private-password@example.com/inventory"),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      const message = (error as Error).message;
      assert.match(message, /inventory/);
      assert.doesNotMatch(message, /private-user|private-password|example\.com/);
      return true;
    },
  );
});

