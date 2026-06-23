import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { asAuditJson } from "./audit-log.service";

test("audit JSON safely serializes Prisma Decimal, Date, bigint and functions", () => {
  const value = asAuditJson({
    amount: new Prisma.Decimal(6000),
    at: new Date("2026-06-20T00:00:00.000Z"),
    sequence: 12n,
    ignored: () => "not serializable",
  }) as Record<string, unknown>;

  assert.equal(value.amount, "6000");
  assert.equal(value.at, "2026-06-20T00:00:00.000Z");
  assert.equal(value.sequence, "12");
  assert.equal("ignored" in value, false);
});
