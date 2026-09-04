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

/** The deny markers the middleware enforces, mirrored so the test can assert on them. */
const AGENT_DENY_MARKERS = {
  NEW_CUSTOMER: "AGENT_NO_NEW_CUSTOMER",
  RECEIPT: "AGENT_NO_RECEIPT",
  PRICE_REQUEST: "AGENT_NO_PRICE_REQUEST",
  ISSUE: "AGENT_NO_ISSUE",
} as const;

function layersOf(router: unknown): Layer[] {
  return (router as { stack: Layer[] }).stack;
}

/**
 * The body of one exported function, found by name.
 *
 * Slicing between two known function names is brittle — moving a function makes
 * the test fail for a reason that has nothing to do with what it checks. This
 * takes the named function up to the next top-level export instead, so the file
 * can be reordered freely.
 */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `function ${name} not found`);
  const after = src.indexOf("\nexport ", start + 1);
  return src.slice(start, after === -1 ? undefined : after);
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
    const fn = fnBody(service, "assertOwnCustomer");
    assert.ok(fn.includes("salesAgentId: agentId"), "assertOwnCustomer must filter on the rep");
    assert.ok(fn.includes("deletedAt: null"), "assertOwnCustomer must exclude deleted customers");

    const list = fnBody(service, "listMyCustomers");
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
    const fn = fnBody(admin, "getCommission");
    assert.ok(
      !/\.(create|update|upsert|delete)\(/.test(fn),
      "the commission screen must be a reader, never a writer",
    );
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

  test("the 'not his customer' filter survives a NULL rep", () => {
    // `NOT { salesAgentId: id }` compiles to `<> id`, which is NULL — not true —
    // for a customer with no rep at all. Written that way the warning read zero
    // in exactly the case it exists to catch. It must stay an explicit OR.
    const block = fnBody(admin, "getCommission");
    assert.ok(
      block.includes("salesAgentId: null"),
      "the other-customers filter must match customers with no rep",
    );
    assert.ok(
      !/NOT:\s*\{\s*customer:/.test(block),
      "a negated relation filter silently drops NULL rows here",
    );
  });

  test("a negative liability must not deadlock future handovers", () => {
    // A receipt cancelled after its cash was handed over drives the derived
    // figure below zero. Guarding on a negative ceiling locked the owner out of
    // recording money the rep was physically holding.
    const fn = fnBody(admin, "recordHandover");
    assert.ok(
      /onHand > 0 && amount > onHand/.test(fn),
      "the ceiling may only apply while the liability is non-negative",
    );
    assert.ok(fn.includes("HANDOVER_SANITY_CAP"), "a typo guard must still apply");
  });

  test("an approved price for a deleted product is not offered", () => {
    const fn = fnBody(service, "listUsablePrices");
    assert.ok(
      fn.includes("product: { deletedAt: null }"),
      "a price the order would refuse must not be shown as usable",
    );
  });

  test("a settled month is frozen, not recomputed", () => {
    // The whole point: once a number is agreed with a person, a cancelled
    // invoice or a reassigned customer must not rewrite what was paid on.
    const fn = fnBody(admin, "settleMonth");
    assert.ok(fn.includes("amount,"), "the agreed payout must be STORED, not derived on read");
    assert.ok(fn.includes("ALREADY_SETTLED"), "settling twice must be refused");

    const read = fnBody(admin, "getCommission");
    assert.ok(
      read.includes("salesAgentSettlement.findUnique"),
      "the commission read must surface the frozen agreement beside the live figures",
    );
  });

  test("every rep permission is actually grantable through the API", () => {
    // `User.permissions` is an open String[] in the database, but the create /
    // update user endpoint validates against a CLOSED enum. A capability the
    // middleware understands but that enum does not cannot be granted at all —
    // which is how SALES_AGENT shipped unassignable, blocking the very first
    // setup step. Checking the column was not the same as checking the gate.
    const schemas = code(read("utils/schemas.ts"));
    const enumStart = schemas.indexOf('"MANAGE_USERS"');
    const enumBlock = schemas.slice(enumStart, schemas.indexOf("]);", enumStart));

    const mw = code(read("middleware/permission.middleware.ts"));
    const required = ["SALES_AGENT", ...Object.values(AGENT_DENY_MARKERS)];
    for (const perm of required) {
      assert.ok(
        mw.includes(perm),
        `${perm} should be defined in the permission middleware`,
      );
      assert.ok(
        enumBlock.includes(`"${perm}"`),
        `${perm} is enforced but missing from the user-permission enum, so it can never be granted`,
      );
    }
  });

  test("each rep ability is a DENY marker, so absence means allowed", () => {
    // Default-off would have silently disabled every existing rep on deploy.
    const mw = code(read("middleware/permission.middleware.ts"));
    assert.ok(mw.includes("AGENT_NO_RECEIPT"), "the switches must be deny-shaped");
    const fn = mw.slice(mw.indexOf("export function agentCan"), mw.indexOf("export function requireAgentCapability"));
    assert.ok(fn.includes("!user?.permissions.includes"), "agentCan must read absence as allowed");
  });

  test("unit maths lives in exactly one place", () => {
    // A rep's carton must mean what a shopper's carton means. Two copies of the
    // rule is one edit away from it not.
    const catalog = code(read("services/catalog.service.ts"));
    for (const src of [service, catalog]) {
      assert.ok(
        !/function piecesFor\s*\(/.test(src),
        "unit conversion must be imported from utils/catalog-units, not redefined",
      );
    }
    assert.ok(service.includes("piecesForUnit"), "the rep service must use the shared converter");
    assert.ok(catalog.includes("piecesForUnit"), "the catalog must use the shared converter");
  });

  test("orders and handovers are idempotent", () => {
    assert.ok(service.includes("clientRequestId"), "a re-sent cart must not create a second order");
    assert.ok(admin.includes("clientRequestId"), "a double-tapped handover must not book cash twice");
  });
});
