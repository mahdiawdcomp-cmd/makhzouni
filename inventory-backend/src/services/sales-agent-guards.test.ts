/**
 * Regression guards for «المندوب».
 *
 * Two rules hold this feature together, and both are the kind that break
 * silently: a rep must never receive a cost/profit figure, and a rep must never
 * reach a customer who is not theirs. Nothing about a normal code change makes
 * either failure visible — the screen still renders, the request still answers
 * 200 — so they are pinned here instead of resting on a comment.
 *
 * Deliberately source-level, with no database: these assert the SHAPE of the
 * queries and the guards on the routers, which is what actually decays. A test
 * that needed a live Postgres would be skipped in CI and would guard nothing.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import salesAgentRouter from "../routes/sales-agent.routes";
import salesAgentAdminRouter from "../routes/sales-agent-admin.routes";
import customersRouter from "../routes/customers.routes";

const SRC = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/**
 * Strip comments before scanning.
 *
 * These tests search source text for forbidden field names, and this file's own
 * explanatory comments mention the very words being banned. Scanning the raw
 * file makes a comment fail the test it is explaining.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

type Layer = {
  name?: string;
  route?: { path: string; methods: Record<string, boolean>; stack: unknown[] };
};

function layersOf(router: unknown): Layer[] {
  return (router as { stack: Layer[] }).stack;
}

/** Router-level middleware (router.use) sits in the stack without a `route`. */
function routerLevelMiddlewareCount(router: unknown): number {
  return layersOf(router).filter((l) => !l.route).length;
}

describe("«المندوب» — cost and profit never leave the server", () => {
  const service = code(read("services/sales-agent.service.ts"));

  test("every product read uses an explicit select", () => {
    // Each `prisma.product.find*` in the rep's service must be followed by a
    // `select:` before the call closes. `include:` or a bare find would ship
    // whatever columns Product happens to have — including costPrice, and
    // including any cost column added months from now.
    const reads = [...service.matchAll(/prisma\.product\.find(?:First|Many)\(\{/g)];
    assert.ok(reads.length > 0, "expected the rep service to read products");

    for (const match of reads) {
      const window = service.slice(match.index ?? 0, (match.index ?? 0) + 900);
      const body = window.slice(0, window.indexOf("});") + 3);
      assert.ok(
        body.includes("select:"),
        `a product read without an explicit select at offset ${match.index}`,
      );
      assert.ok(
        !body.includes("include:"),
        `a product read using include at offset ${match.index} — include leaks new columns`,
      );
    }
  });

  test("no cost-bearing field name appears in the rep's service", () => {
    for (const forbidden of ["costPrice", "purchasePrice", "landedCost", "profit", "margin"]) {
      assert.ok(
        !service.includes(forbidden),
        `«${forbidden}» must never appear in the rep-facing service`,
      );
    }
  });

  test("the shared customer statement does not read invoice cost", () => {
    // The rep's account statement reuses this builder, so `items: true` here
    // would pull costPrice out of the database on every statement and leave the
    // mapper as the only thing standing between it and the rep's phone.
    const customers = code(read("services/customer.service.ts"));
    const include = customers.slice(
      customers.indexOf("const customerStatementInvoiceInclude"),
      customers.indexOf("} satisfies Prisma.InvoiceInclude;"),
    );
    assert.ok(include.length > 0, "statement include block not found");
    assert.ok(!/items:\s*true/.test(include), "statement must not select all invoice-item columns");
    assert.ok(!include.includes("costPrice"), "statement must not select costPrice");
  });
});

describe("«المندوب» — isolation between reps", () => {
  const service = code(read("services/sales-agent.service.ts"));

  test("every rep-facing customer read is scoped by the rep's own id", () => {
    // assertOwnCustomer is the single funnel. If it ever stops filtering on
    // salesAgentId, one rep can read another's full account statement.
    const fn = service.slice(
      service.indexOf("export async function assertOwnCustomer"),
      service.indexOf("export async function listMyCustomers"),
    );
    assert.ok(fn.includes("salesAgentId: agentId"), "assertOwnCustomer must filter on the rep");
    assert.ok(fn.includes("deletedAt: null"), "assertOwnCustomer must exclude deleted customers");

    const list = service.slice(
      service.indexOf("export async function listMyCustomers"),
      service.indexOf("export async function getCustomerHeader"),
    );
    assert.ok(list.includes("salesAgentId: agentId"), "listMyCustomers must filter on the rep");
  });

  test("the rep router is guarded as a whole, not per handler", () => {
    // A router-level guard covers endpoints added later. A per-route guard is
    // the kind someone forgets exactly once.
    assert.ok(
      routerLevelMiddlewareCount(salesAgentRouter) >= 1,
      "sales-agent router must carry router-level auth + requireSalesAgent",
    );
    const src = read("routes/sales-agent.routes.ts");
    assert.ok(src.includes("router.use(authMiddleware, requireSalesAgent())"));
  });

  test("the owner router is admin-only", () => {
    assert.ok(routerLevelMiddlewareCount(salesAgentAdminRouter) >= 1);
    const src = read("routes/sales-agent-admin.routes.ts");
    assert.ok(src.includes("router.use(authMiddleware, adminOnly)"), "commission must be admin-only");
  });

  test("the ordinary customers router scopes :id and blocks rep writes", () => {
    const src = read("routes/customers.routes.ts");
    assert.ok(
      src.includes('router.param("id", scopeCustomerParamToSalesAgent())'),
      "every :id customer route must be scoped for a rep",
    );
    assert.ok(
      src.includes("router.use(blockSalesAgentWrites())"),
      "a rep must not write through the ordinary customer routes",
    );
    assert.ok(layersOf(customersRouter).length > 0);
  });

  test("SALES_AGENT is a restriction, so ADMIN must not bypass it", () => {
    // hasPermission() lets an ADMIN through everything. If isSalesAgent were
    // written on top of it, an owner would be silently confined to a rep's
    // customer list the moment they were given the marker.
    const mw = code(read("middleware/permission.middleware.ts"));
    const fn = mw.slice(mw.indexOf("export function isSalesAgent"), mw.indexOf("export function salesAgentScopeFor"));
    assert.ok(fn.includes("permissions.includes(SALES_AGENT)"), "isSalesAgent must test membership");
    assert.ok(!fn.includes("hasPermission"), "isSalesAgent must not go through hasPermission");
  });
});

describe("«المندوب» — policy and money rules", () => {
  const service = code(read("services/sales-agent.service.ts"));
  const admin = code(read("services/sales-agent-admin.service.ts"));

  test("a stock shortage never blocks the rep's order", () => {
    // The shop's standing policy. This path used to throw, which stopped a rep
    // mid-sale in front of a customer.
    assert.ok(
      !service.includes("STOCK_NOT_ENOUGH"),
      "a shortage must be recorded on the approval, never refused",
    );
    assert.ok(service.includes("const shortages"), "the shortfall must still be surfaced");
  });

  test("the rep's cash is derived, never stored", () => {
    // A stored running total is a second number that can disagree with the
    // vouchers. Nothing may write an onHand column.
    assert.ok(!/(increment|decrement)/.test(admin), "liability must never be incremented in place");
    assert.ok(admin.includes("collectedBy.get"), "liability must be computed from the vouchers");
    const schema = readFileSync(join(SRC, "..", "prisma", "schema.prisma"), "utf8");
    assert.ok(
      !/model User \{[\s\S]*?cashOnHand[\s\S]*?\n\}/.test(schema),
      "no stored cash-on-hand column may exist on User",
    );
  });

  test("commission stores nothing and names its date basis", () => {
    const fn = admin.slice(admin.indexOf("export async function getCommission"));
    assert.ok(!fn.includes("prisma.") || !/\.(create|update|upsert|delete)\(/.test(fn.slice(0, 2600)),
      "the commission screen must be a reader, never a writer");
    assert.ok(fn.includes("dateBasis"), "the month boundary basis must be stated to the owner");
    assert.ok(fn.includes("collectedInHand"), "what the rep pocketed must be labelled as such");
    assert.ok(
      fn.includes("collectedFromOwnCustomers"),
      "collections from the rep's own customers must be reported separately",
    );
  });

  test("an approved special price is spent, not left standing", () => {
    assert.ok(service.includes("consumedAt"), "a one-off price must be consumable");
    assert.ok(service.includes("spentPriceIds"), "the order must spend the price it used");
  });

  test("orders and handovers are idempotent", () => {
    assert.ok(service.includes("clientRequestId"), "a re-sent cart must not create a second order");
    assert.ok(admin.includes("clientRequestId"), "a double-tapped handover must not book cash twice");
  });
});
