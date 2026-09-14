import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import { Unit } from "@prisma/client";
const id = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
let stock = 100, cartonPrice: number | null = 750, own = true, created = 0;
let prior: any = null, customerWhere: any;
let hiddenUnits: Unit[] = [];
const product = () => ({ id, name: "مادة فحص", itemNumber: "T", category: "قسم", categoryTags: [], typeTags: [], salePrice: 1000, cartonPiecePrice: cartonPrice, pcsPerCarton: 48, boxPieces: 24, hiddenUnits, openingBalancePcs: 0, cartonsAvailable: 0, thumbnailUrl: null, warehouseStocks: [{ warehouseId: id, quantityPieces: stock }] });
mock.module("../config/database", { exports: { default: {
  product: { findMany: async () => [product()] },
  customer: { findFirst: async ({ where }: any) => own && where.salesAgentId === id ? { id: customerId, name: "زبوني", phone: "07700000000" } : null,
    count: async ({ where }: any) => { customerWhere = where; return 0; }, findMany: async () => [] },
  pendingApproval: { findFirst: async () => prior },
  salesAgentPriceRequest: { findMany: async () => [], updateMany: async () => { throw new Error("No price writes in preview"); } },
} } });
mock.module("./warehouse-stock.service", { exports: { resolveShopWarehouseId: async () => id } });
mock.module("./settings.service", { exports: { getSettings: async () => ({ catalogFullCartonOnly: false }) } });
mock.module("./customer.service", { exports: { createCustomer: async () => { throw new Error("NO CUSTOMER WRITES"); } } });
mock.module("./sales-agent-notify.service", { exports: { notifySalesAgentEvent: async () => {} } });
mock.module("./approval.service", { exports: { approvalRequestTypes: { CATALOG_ORDER: "CATALOG_ORDER" }, createPendingApproval: async (_type: any, data: any) => { created++; prior = { id, requestData: data }; return { id }; } } });
let service: typeof import("./sales-agent.service");
before(async () => { service = await import("./sales-agent.service"); });
const input = () => ({ customerId, priceMode: "CARTON" as const, items: [{ productId: id, unit: Unit.CARTON, quantity: 1 }], clientRequestId: id });
test("preview distribution uses stored carton piece price and performs no approval writes", async () => {
  prior = null; created = 0; own = true; stock = 100; cartonPrice = 750;
  const result = await service.submitAgentOrder(id, "rep", input(), true);
  assert.equal(result.subtotal, 36000);
  assert.equal(created, 0);
  assert.ok("reviewToken" in result);
});
test("wholesale preview preserves old price and whole-unit conversions", async () => {
  const result = await service.submitAgentOrder(id, "rep", { ...input(), priceMode: "WHOLESALE" }, true);
  assert.equal(result.subtotal, 48000);
});
test("invoice-hidden units stay available to wholesale catalog orders", async () => {
  hiddenUnits = [Unit.PIECE, Unit.DOZEN, Unit.BOX];
  try {
    for (const [unit, price] of [[Unit.PIECE, 1000], [Unit.DOZEN, 12000], [Unit.BOX, 24000], [Unit.CARTON, 48000]] as const) {
      const result = await service.submitAgentOrder(id, "rep", { ...input(), priceMode: "WHOLESALE", items: [{ productId: id, unit, quantity: 1 }] }, true);
      assert.equal(result.subtotal, price);
    }
  } finally { hiddenUnits = []; }
});
test("customer ownership is checked for previews too", async () => {
  own = false;
  await assert.rejects(service.submitAgentOrder(id, "rep", input(), true), /مو ضمن زبائنك/);
  own = true;
});
test("zero/null carton price, insufficient stock, wrong unit and retail are rejected", async () => {
  for (const price of [0, null]) { cartonPrice = price; await assert.rejects(service.submitAgentOrder(id, "rep", input(), true)); }
  cartonPrice = 750; stock = 47;
  await assert.rejects(service.submitAgentOrder(id, "rep", input(), true));
  stock = 100;
  await assert.rejects(service.submitAgentOrder(id, "rep", { ...input(), items: [{ productId: id, unit: Unit.PIECE, quantity: 1 }] }, true));
  await assert.rejects(service.submitAgentOrder(id, "rep", { ...input(), priceMode: "RETAIL" as any }, true));
});
test("zero and negative stock are hidden from the rep catalog", async () => {
  for (const value of [0, -10]) { stock = value; assert.deepEqual(await service.listAgentCatalogProducts(), []); }
  stock = 100;
  const rows = await service.listAgentCatalogProducts();
  assert.equal(rows[0].cartonPiecePrice, 750);
  assert.equal("costPrice" in rows[0], false);
});
test("price or stock changing after review requires a new review, no silent repricing", async () => {
  prior = null; created = 0;
  const review = await service.submitAgentOrder(id, "rep", input(), true);
  assert.ok("reviewToken" in review);
  cartonPrice = 700;
  await assert.rejects(service.submitAgentOrder(id, "rep", { ...input(), reviewToken: review.reviewToken }), /راجع الطلب/);
  assert.equal(created, 0);
  cartonPrice = 750; stock = 99;
  await assert.rejects(service.submitAgentOrder(id, "rep", { ...input(), reviewToken: review.reviewToken }), /راجع الطلب/);
  stock = 100;
});
test("confirmed order creates once; retry after a lost response returns the existing approval", async () => {
  prior = null; created = 0;
  const review = await service.submitAgentOrder(id, "rep", input(), true);
  assert.ok("reviewToken" in review);
  const payload = { ...input(), reviewToken: review.reviewToken };
  await service.submitAgentOrder(id, "rep", payload);
  assert.equal(prior.requestData.body.priceMode, "CARTON");
  assert.equal(prior.requestData.body.items[0].unitPrice, 36000);
  cartonPrice = 700; // retry must not create a second order even if prices moved
  const retry = await service.submitAgentOrder(id, "rep", payload);
  assert.equal(created, 1);
  assert.ok("duplicate" in retry && retry.duplicate);
  cartonPrice = 750; prior = null;
});
test("legacy wholesale requests still work without review and retain shortage approvals", async () => {
  prior = null; stock = 5;
  const result = await service.submitAgentOrder(id, "rep", { customerId, items: [{ productId: id, unit: Unit.PIECE, quantity: 10 }] });
  assert.equal(result.subtotal, 10000);
  assert.equal(result.shortages[0].short, 5);
  assert.equal(prior.requestData.body.priceMode, "WHOLESALE");
  stock = 100; prior = null;
});
test("follow-up filtering happens before pagination and stays scoped to this rep", async () => {
  await service.listMyCustomers(id, "", { followUp: "quiet", page: 2 });
  assert.equal(customerWhere.salesAgentId, id);
  assert.equal(customerWhere.invoices.none.type, "SALE");
  assert.equal(customerWhere.invoices.none.archivedAt, null);
  assert.ok(customerWhere.invoices.none.date.gt instanceof Date);
  await service.listMyCustomers(id, "", { followUp: "balance" });
  assert.equal(customerWhere.currentBalance.gt, 0);
});
test("preview HTTP handler is read-only regardless of a trailing slash in the URL", async () => {
  const { previewAgentOrder } = await import("../controllers/sales-agent.controller");
  created = 0; prior = null; stock = 100;
  const response: any = await new Promise((resolve, reject) => {
    previewAgentOrder({ user: { id, name: "rep" }, path: "/orders/preview/", body: input() } as any,
      { status() { return this; }, json: resolve } as any, reject);
  });
  assert.equal(response.data.subtotal, 36000);
  assert.equal(created, 0);
});
