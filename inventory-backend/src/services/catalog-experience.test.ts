import { test, mock, before } from "node:test";
import assert from "node:assert/strict";

let executeCalls: unknown[][] = [];
let historyWhere: any;
let failMetrics = false;
let failOrder = false;
mock.module("../config/database", { exports: { default: {
  $executeRaw: async (...args: unknown[]) => { if (failMetrics) throw new Error("db unavailable"); executeCalls.push(args); },
  $queryRaw: async () => [{ opened: 8n, viewed: 6n, added: 4n, checkout: 3n, completed: 2n, successful: 3n }],
  invoiceItem: { groupBy: async (args: any) => { historyWhere = args.where; return [{ productId: "p" }]; } },
} } });
mock.module("./catalog.service", { exports: { submitCatalogOrder: async () => { if (failOrder) throw new Error("Stock insufficient"); return { approvalId: "saved-order" }; }, getCatalogAccess: async (token: string) => {
  if (token !== "valid-access") throw new Error("Unauthorized");
  return { customer: { id: "customer-a" } };
} } });
mock.module("./catalog-visitor.service", { exports: { requireVisitorSession: async (token: string) => {
  if (token !== "valid-visitor" && token !== "new-visitor") throw new Error("Unauthorized");
  return { customerId: token === "new-visitor" ? null : "customer-b" };
} } });
let experience: typeof import("./catalog-experience.service");
let eventController: typeof import("../controllers/catalog-experience.controller");
let orderController: typeof import("../controllers/catalog.controller");
before(async () => {
  experience = await import("./catalog-experience.service");
  eventController = await import("../controllers/catalog-experience.controller");
  orderController = await import("../controllers/catalog.controller");
});
const catalogPurchaseHistory = (...args: Parameters<typeof experience.catalogPurchaseHistory>) => experience.catalogPurchaseHistory(...args);
const recordFunnelStage = (...args: Parameters<typeof experience.recordFunnelStage>) => experience.recordFunnelStage(...args);
const recordOrderSuccess = (...args: Parameters<typeof experience.recordOrderSuccess>) => experience.recordOrderSuccess(...args);
const catalogFunnelReport = (...args: Parameters<typeof experience.catalogFunnelReport>) => experience.catalogFunnelReport(...args);
const id = "11111111-1111-4111-8111-111111111111";

test("history uses verified customer identity and excludes cancelled/archived sales", async () => {
  assert.deepEqual(await catalogPurchaseHistory("valid-access", ""), { productIds: ["p"] });
  assert.deepEqual(historyWhere.invoice, { customerId: "customer-a", type: "SALE", status: "ACTIVE", archivedAt: null });
  await catalogPurchaseHistory("", "valid-visitor");
  assert.equal(historyWhere.invoice.customerId, "customer-b");
});
test("unverified phone/unknown token cannot obtain purchase history", async () => {
  await assert.rejects(catalogPurchaseHistory("", "07701234567"));
  await assert.rejects(catalogPurchaseHistory("bad-token", "valid-visitor"));
  assert.deepEqual(await catalogPurchaseHistory("", "new-visitor"), { productIds: [] });
});
test("funnel rejects malformed ids and invalid stages; SQL deduplicates session+stage", async () => {
  executeCalls = [];
  await recordFunnelStage("bad", 1);
  await recordFunnelStage(id, 5);
  assert.equal(executeCalls.length, 0);
  await recordFunnelStage(id, 1);
  assert.equal(executeCalls.length, 1);
  assert.ok(String(executeCalls[0][0]).includes("ON CONFLICT DO NOTHING"));
});
test("successful-order telemetry failure must not turn a saved order into a failed response", async () => {
  failMetrics = true;
  await assert.doesNotReject(recordOrderSuccess(id));
  failMetrics = false;
});
test("report normalizes bigint counts and keeps bypassed/restored-cart successes separate", async () => {
  assert.deepEqual(await catalogFunnelReport(30), { days: 30, stages: [8, 6, 4, 3, 2], sessions: 8, successfulSessions: 3, incompletePathOrders: 1 });
});

function callController(controller: any, req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const res = { status: () => res, json: resolve, end: resolve, setHeader: () => {} };
    controller(req, res, reject);
  });
}
test("public event endpoint cannot forge successful orders", async () => {
  executeCalls = [];
  await assert.rejects(callController(eventController.postCatalogFunnel, { body: { sessionId: id, stage: "SUCCESS" } }));
  assert.equal(executeCalls.length, 0);
});
test("order controller records success only after a successful saved order", async () => {
  executeCalls = [];
  failOrder = true;
  await assert.rejects(callController(orderController.createCatalogOrder, { body: {}, query: { access: "valid-access" }, get: () => id }));
  assert.equal(executeCalls.length, 0);
  failOrder = false;
  const response = await callController(orderController.createCatalogOrder, { body: {}, query: { access: "valid-access" }, get: () => id });
  assert.equal(response.data.approvalId, "saved-order");
  assert.equal(executeCalls.length, 1);
  assert.equal(executeCalls[0][2], 4);
});
