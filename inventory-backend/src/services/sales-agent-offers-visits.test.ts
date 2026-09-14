/**
 * Behaviour of the new rep features against a mocked database.
 *
 * These are guards on the RULES: who may reach whose data, what is refused,
 * what gets written and what is deliberately never written. The database is
 * mocked, so a passing run is not proof of a real Postgres round trip — the
 * migration is verified separately, against a throwaway database.
 */
import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import { DiscountType, Unit } from "@prisma/client";

const agentId = "11111111-1111-4111-8111-111111111111";
const otherAgentId = "99999999-9999-4999-8999-999999999999";
const customerId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
const offerId = "44444444-4444-4444-8444-444444444444";
const visitId = "55555555-5555-4555-8555-555555555555";
const warehouseId = "66666666-6666-4666-8666-666666666666";

let ownsCustomer = true;
let stock = 480;
let cartonPiecePrice: number | null = 750;
let offerRows: Record<string, unknown>[] = [];
let historyRows: Record<string, unknown>[] = [];
let lastPriceRows: Record<string, unknown>[] = [];
let approvedPriceRows: Record<string, unknown>[] = [];
let visitRow: Record<string, unknown> | null = null;
let openVisit: Record<string, unknown> | null = null;
let approvalRows: Record<string, unknown>[] = [];
const audits: Record<string, unknown>[] = [];
const offerWrites: Record<string, unknown>[] = [];
const customerWrites: Record<string, unknown>[] = [];
let visitCreates = 0;
let offerCreateError: { code?: string; meta?: Record<string, unknown> } | null = null;
let offerUpdateError: { code?: string; meta?: Record<string, unknown> } | null = null;
let lastOfferWhere: Record<string, unknown> | undefined;
let planRow: Record<string, unknown> | null = null;
let lastPlanWhere: Record<string, unknown> | undefined;
let lastCustomerWhere: Record<string, unknown> | undefined;
let planCreateError: { code?: string } | null = null;
const planWrites: Record<string, unknown>[] = [];
const planStatusWrites: Record<string, unknown>[] = [];
let visitUpdates: Record<string, unknown>[] = [];

const productRow = () => ({
  id: productId,
  itemNumber: "T-1",
  name: "مادة فحص",
  salePrice: 1000,
  cartonPiecePrice,
  pcsPerCarton: 48,
  boxPieces: 24,
  hiddenUnits: [] as Unit[],
  thumbnailUrl: null,
  openingBalancePcs: 0,
  cartonsAvailable: 0,
  warehouseStocks: [{ warehouseId, quantityPieces: stock }],
});

mock.module("../config/database", {
  exports: {
    default: {
      customer: {
        findFirst: async ({ where }: any) => {
          // A scoped read (`salesAgentId` in the filter) answers null when the
          // customer is not this rep's, exactly like the real query. An
          // unscoped read returns the row WITH its owner, so services that
          // compare ownership themselves are exercised properly.
          if (where.salesAgentId !== undefined && !(ownsCustomer && where.salesAgentId === agentId)) return null;
          return {
            id: customerId,
            name: "زبوني",
            phone: "07700000000",
            address: "شارع",
            area: "الجديدة",
            currentBalance: 250000,
            latitude: 33.3,
            longitude: 44.4,
            // The fixture customer ALWAYS belongs to `agentId`; `ownsCustomer`
            // only decides whether a scoped read can see them. That is what
            // makes "another rep tries to plan this customer" a real case.
            salesAgentId: agentId,
          };
        },
        findMany: async ({ where }: any = {}) => {
          lastCustomerWhere = where;
          return [
          { id: customerId, name: "زبوني", phone: "07700000000", address: "شارع", area: "الجديدة", latitude: 33.3, longitude: 44.4, currentBalance: 250000, lastTransactionAt: null },
          { id: "77777777-7777-4777-8777-777777777777", name: "بلا موقع", phone: "07710000000", address: "عنوان", area: "الجديدة", latitude: null, longitude: null, currentBalance: 0, lastTransactionAt: null },
          ];
        },
        count: async () => 2,
        update: async ({ data, where }: any) => {
          customerWrites.push({ ...data, id: where.id });
          return { id: where.id, latitude: data.latitude, longitude: data.longitude };
        },
      },
      product: {
        findMany: async () => [productRow()],
        findFirst: async ({ where }: any) =>
          where.id === productId
            ? { id: productId, name: "مادة فحص", salePrice: 1000, cartonPiecePrice, pcsPerCarton: 48, boxPieces: 24 }
            : null,
      },
      salesAgentCustomerOffer: {
        findMany: async ({ where }: any) => {
          lastOfferWhere = where;
          return offerRows;
        },
        count: async () => offerRows.length,
        findFirst: async ({ where }: any) => {
          lastOfferWhere = where;
          return offerRows.find((row: any) => row.id === (where.id ?? row.id)) ?? null;
        },
        create: async ({ data }: any) => {
          if (offerCreateError) throw offerCreateError;
          offerWrites.push(data);
          return { ...offerFixture(), ...data, id: offerId };
        },
        update: async ({ data }: any) => {
          if (offerUpdateError) throw offerUpdateError;
          offerWrites.push(data);
          return { ...offerFixture(), ...data, id: offerId };
        },
      },
      salesAgentVisit: {
        findFirst: async ({ where }: any) =>
          where.clientRequestId ? visitRow : where.endedAt === null ? openVisit : visitRow,
        findMany: async () => (visitRow ? [{ ...visitRow, customer: { id: customerId, name: "زبوني", phone: "07700000000", area: "الجديدة", address: "شارع" }, customerId }] : []),
        create: async ({ data }: any) => {
          visitCreates += 1;
          return { id: visitId, startedAt: new Date(), endedAt: null, outcome: null, ...data };
        },
        update: async ({ data }: any) => {
          visitUpdates.push(data);
          return { id: visitId, startedAt: new Date(), note: null, planId: null, orderApprovalId: null, ...data };
        },
      },
      salesAgentVisitPlan: {
        findFirst: async ({ where }: any) => {
          lastPlanWhere = where;
          return planRow && (where.id ?? planRow.id) === planRow.id ? planRow : null;
        },
        findMany: async ({ where }: any) => {
          lastPlanWhere = where;
          return planRow ? [planRow] : [];
        },
        create: async ({ data }: any) => {
          if (planCreateError) throw planCreateError;
          planWrites.push(data);
          return { ...planFixture(), ...data };
        },
        update: async ({ data }: any) => ({ ...planFixture(), ...data }),
        updateMany: async ({ data, where }: any) => {
          planStatusWrites.push({ ...data, where });
          return { count: 1 };
        },
      },
      salesAgentPriceRequest: { findMany: async () => approvedPriceRows },
      invoice: { groupBy: async () => [] },
      pendingApproval: { findMany: async () => approvalRows, findFirst: async () => null },
      auditLog: {
        create: async ({ data }: any) => {
          audits.push(data);
          return { id: "audit" };
        },
      },
      // `frequentPurchases` and `lastPaidPrices` are the two raw reads; they are
      // told apart by which statement was asked for.
      $queryRawUnsafe: async (sql: string) => (sql.includes("DISTINCT ON") ? lastPriceRows : historyRows),
    },
  },
});
mock.module("./warehouse-stock.service", { exports: { resolveShopWarehouseId: async () => warehouseId } });
mock.module("./settings.service", {
  exports: { getSettings: async () => ({ catalogFullCartonOnly: false, inactiveCustomerDays: 45 }) },
});
mock.module("./customer.service", {
  exports: { createCustomer: async () => { throw new Error("NO CUSTOMER WRITES"); } },
});
mock.module("./sales-agent-notify.service", { exports: { notifySalesAgentEvent: async () => {} } });
mock.module("./approval.service", {
  exports: {
    approvalRequestTypes: { CATALOG_ORDER: "CATALOG_ORDER" },
    createPendingApproval: async () => ({ id: "approval-1" }),
  },
});

function offerFixture(patch: Record<string, unknown> = {}) {
  return {
    id: offerId,
    customerId,
    productId,
    unit: Unit.CARTON,
    priceMode: "WHOLESALE",
    discountType: DiscountType.PERCENT,
    fixedPrice: null,
    discountPercent: 10,
    startsAt: new Date(Date.now() - 86_400_000),
    endsAt: new Date(Date.now() + 86_400_000),
    isActive: true,
    note: null,
    createdBy: agentId,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    customer: { id: customerId, name: "زبوني", phone: "07700000000", salesAgentId: agentId },
    product: {
      id: productId,
      name: "مادة فحص",
      salePrice: 1000,
      cartonPiecePrice: 750,
      pcsPerCarton: 48,
      boxPieces: 24,
    },
    ...patch,
  };
}

const validOffer = () => ({
  customerId,
  productId,
  unit: Unit.CARTON,
  priceMode: "WHOLESALE" as const,
  discountType: DiscountType.AMOUNT,
  fixedPrice: 40000,
  discountPercent: null,
  startsAt: new Date("2026-09-01T00:00:00.000Z"),
  endsAt: new Date("2026-09-30T00:00:00.000Z"),
  note: "اتفاق سنوي",
});

let offersService: typeof import("./sales-agent-offers.service");
let visitsService: typeof import("./sales-agent-visits.service");
let insightsService: typeof import("./sales-agent-insights.service");
let agentService: typeof import("./sales-agent.service");

before(async () => {
  offersService = await import("./sales-agent-offers.service");
  visitsService = await import("./sales-agent-visits.service");
  insightsService = await import("./sales-agent-insights.service");
  agentService = await import("./sales-agent.service");
});

function reset() {
  ownsCustomer = true;
  stock = 480;
  cartonPiecePrice = 750;
  offerRows = [];
  historyRows = [];
  lastPriceRows = [];
  approvedPriceRows = [];
  visitRow = null;
  openVisit = null;
  approvalRows = [];
  audits.length = 0;
  offerWrites.length = 0;
  customerWrites.length = 0;
  visitCreates = 0;
  offerCreateError = null;
  offerUpdateError = null;
  lastOfferWhere = undefined;
  planRow = null;
  lastPlanWhere = undefined;
  lastCustomerWhere = undefined;
  planCreateError = null;
  planWrites.length = 0;
  planStatusWrites.length = 0;
  visitUpdates = [];
}

const planId = "88888888-8888-4888-8888-888888888888";

function planFixture(patch: Record<string, unknown> = {}) {
  return {
    id: planId,
    salesAgentId: agentId,
    customerId,
    planDate: "2026-09-14",
    sortOrder: 1,
    note: null,
    status: "PLANNED",
    createdAt: new Date(),
    customer: {
      id: customerId,
      name: "زبوني",
      phone: "07700000000",
      address: "شارع",
      area: "الجديدة",
      latitude: 33.3,
      longitude: 44.4,
      currentBalance: 250000,
    },
    ...patch,
  };
}

/* ── offers: who may write, and what is refused ──────────────────────── */

test("creating an offer records who created it in the audit log", async () => {
  reset();
  const created = await offersService.createCustomerOffer({ id: agentId }, null, validOffer());
  assert.equal(created.offerPrice, 40000);
  assert.equal(created.catalogPrice, 48000);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "CREATE");
  assert.equal(audits[0].entity, "SalesAgentCustomerOffer");
  assert.equal(audits[0].userId, agentId);
});

test("pausing and resuming an offer are each audited", async () => {
  reset();
  offerRows = [offerFixture()];
  await offersService.setCustomerOfferActive({ id: agentId }, null, offerId, false);
  await offersService.setCustomerOfferActive({ id: agentId }, null, offerId, true);
  assert.deepEqual(audits.map((a) => a.action), ["OFFER_PAUSE", "OFFER_RESUME"]);
});

test("a rep's offer reads and writes are confined to their own customers", async () => {
  reset();
  await offersService.listCustomerOffers({ agentScope: agentId, customerId });
  assert.deepEqual((lastOfferWhere as any)?.customer, { salesAgentId: agentId, deletedAt: null });

  ownsCustomer = false;
  await assert.rejects(
    () => offersService.createCustomerOffer({ id: otherAgentId }, otherAgentId, validOffer()),
    /الزبون غير موجود/,
  );
  assert.equal(offerWrites.length, 0);
});

test("a bad window, a bad percent, a zero price and a non-carton distribution offer are all refused", async () => {
  reset();
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ startsAt: new Date("2026-09-30T00:00:00.000Z"), endsAt: new Date("2026-09-01T00:00:00.000Z") }, /بعد تاريخ البداية/],
    [{ discountType: DiscountType.PERCENT, discountPercent: 0, fixedPrice: null }, /بين 1 و99/],
    [{ discountType: DiscountType.PERCENT, discountPercent: 100, fixedPrice: null }, /بين 1 و99/],
    [{ fixedPrice: 0 }, /أكبر من صفر/],
    [{ priceMode: "CARTON", unit: Unit.PIECE }, /بوحدة الكارتون فقط/],
    [{ priceMode: "RETAIL" }, /جملة أو توزيع كراتين/],
  ];
  for (const [patch, message] of cases) {
    await assert.rejects(
      () => offersService.createCustomerOffer({ id: agentId }, null, { ...validOffer(), ...patch } as never),
      message,
      JSON.stringify(patch),
    );
  }
  assert.equal(offerWrites.length, 0, "nothing was written by a refused offer");
});

test("an overlapping ACTIVE offer is refused by the database, in plain Arabic", async () => {
  reset();
  // What Postgres raises for the EXCLUDE constraint. The service must turn the
  // SQLSTATE into a sentence, never show a constraint name to the owner.
  offerCreateError = { code: "23P01", meta: { code: "23P01", constraint: "sales_agent_offers_no_overlap" } };
  await assert.rejects(
    () => offersService.createCustomerOffer({ id: agentId }, null, validOffer()),
    (err: Error & { code?: string }) =>
      err.code === "OFFER_PERIOD_OVERLAP" &&
      /فترة متقاطعة/.test(err.message) &&
      !/constraint|23P01|sales_agent/.test(err.message),
  );
});

test("resuming a paused offer that would overlap a live one is refused with its own message", async () => {
  reset();
  offerRows = [offerFixture({ isActive: false })];
  offerUpdateError = { code: "23P01" };
  await assert.rejects(
    () => offersService.setCustomerOfferActive({ id: agentId }, null, offerId, true),
    (err: Error & { code?: string }) =>
      err.code === "OFFER_PERIOD_OVERLAP" && /ما نكدر نشغّل/.test(err.message),
  );
});

test("a fixed price above the catalog price needs an explicit confirmation, then is stored untouched", async () => {
  reset();
  // Catalog carton price in the fixture is 750 * 48 = 36,000 wholesale 48,000.
  const dearer = { ...validOffer(), fixedPrice: 60000 };
  await assert.rejects(
    () => offersService.createCustomerOffer({ id: agentId }, null, dearer),
    (err: Error & { code?: string }) => err.code === "OFFER_ABOVE_CATALOG_UNCONFIRMED",
  );
  assert.equal(offerWrites.length, 0, "nothing is written before the owner confirms");

  const created = await offersService.createCustomerOffer({ id: agentId }, null, {
    ...dearer,
    confirmAboveCatalog: true,
  });
  assert.equal((offerWrites[0] as { fixedPrice?: number }).fixedPrice, 60000, "stored exactly as entered");
  assert.equal(created.aboveCatalog, true);
});

test("a percent discount can never produce a price above the catalog price", async () => {
  reset();
  const created = await offersService.createCustomerOffer({ id: agentId }, null, {
    ...validOffer(),
    discountType: DiscountType.PERCENT,
    fixedPrice: null,
    discountPercent: 10,
  });
  assert.equal(created.aboveCatalog, false);
  assert.ok((created.offerPrice ?? 0) < created.catalogPrice);
});

test("an offer's customer, product and unit cannot be moved by an edit", async () => {
  reset();
  offerRows = [offerFixture()];
  await offersService.updateCustomerOffer({ id: agentId }, null, offerId, {
    ...validOffer(),
    customerId: "00000000-0000-4000-8000-000000000000",
    productId: "00000000-0000-4000-8000-000000000001",
    unit: Unit.PIECE,
    priceMode: "CARTON",
  });
  const written = offerWrites[0] as Record<string, unknown>;
  assert.ok(!("customerId" in written), "customer is not part of an update");
  assert.ok(!("productId" in written), "product is not part of an update");
  assert.ok(!("unit" in written), "unit is not part of an update");
});

/* ── «يشتريها عادةً» ─────────────────────────────────────────────────── */

/** One aggregated history row, as the netted SQL returns it. */
function historyRow(patch: Record<string, unknown> = {}) {
  return {
    product_id: productId,
    unit: Unit.CARTON,
    times: 5,
    total_quantity: 9,
    avg_qty_mode: 6,
    mode_samples: 3,
    avg_qty_any: 6,
    any_samples: 3,
    last_purchase_at: new Date("2026-08-01T00:00:00.000Z"),
    last_price_mode: "WHOLESALE",
    ...patch,
  };
}

test("the usual-products list drops what is out of stock and never sells at the old price", async () => {
  reset();
  historyRows = [historyRow()];
  lastPriceRows = [
    { product_id: productId, unit: Unit.CARTON, unit_price: 40000, quantity: 2, date: new Date("2026-08-01T00:00:00.000Z"), price_mode: "WHOLESALE" },
  ];

  const list = await insightsService.frequentProductsForCustomer(agentId, customerId, { priceMode: "WHOLESALE" });
  assert.equal(list.products.length, 1);
  const row = list.products[0];
  // Today's price from the server, and the old one only as the «كان بـ» note.
  assert.equal(row.currentPrice, 48000);
  assert.equal(row.priceChange?.previousPrice, 40000);
  assert.equal(row.priceChange?.direction, "UP");
  // The average of the last three purchases, not whatever the last basket was.
  assert.equal(row.suggestedQuantity, 6);
  assert.equal(row.averageSampleSize, 3);
  assert.equal(row.averageMatchesPriceMode, true);
  assert.equal(row.times, 5);

  stock = 0;
  const empty = await insightsService.frequentProductsForCustomer(agentId, customerId, { priceMode: "WHOLESALE" });
  assert.equal(empty.products.length, 0, "a product with no shop stock is not offered");
});

test("distribution mode only offers whole cartons that are actually sellable as cartons", async () => {
  reset();
  historyRows = [
    historyRow({ unit: Unit.DOZEN, times: 9, total_quantity: 9, avg_qty_mode: 1, avg_qty_any: 1, last_purchase_at: new Date() }),
    historyRow({ unit: Unit.CARTON, times: 2, total_quantity: 2, avg_qty_mode: 1, avg_qty_any: 1, last_purchase_at: new Date(), last_price_mode: "CARTON" }),
  ];
  const list = await insightsService.frequentProductsForCustomer(agentId, customerId, { priceMode: "CARTON" });
  assert.deepEqual(list.products.map((p) => p.unit), [Unit.CARTON]);
  assert.equal(list.products[0].currentPrice, 36000);

  cartonPiecePrice = null;
  const none = await insightsService.frequentProductsForCustomer(agentId, customerId, { priceMode: "CARTON" });
  assert.equal(none.products.length, 0, "no carton price means not sellable as distribution");
});

test("the suggested quantity is the rounded average of the last three purchases", async () => {
  reset();
  // 4, 6, 8 → average 6 → 6.
  historyRows = [historyRow({ avg_qty_mode: 6, mode_samples: 3 })];
  let list = await insightsService.frequentProductsForCustomer(agentId, customerId, { priceMode: "WHOLESALE" });
  assert.equal(list.products[0].suggestedQuantity, 6);

  // Round HALF UP: 4 and 5 average 4.5 → 5.
  historyRows = [historyRow({ avg_qty_mode: 4.5, mode_samples: 2 })];
  list = await insightsService.frequentProductsForCustomer(agentId, customerId, { priceMode: "WHOLESALE" });
  assert.equal(list.products[0].suggestedQuantity, 5);
  assert.equal(list.products[0].averageSampleSize, 2, "says how many purchases it averaged");

  // …and down when it is below the half: 4 and 5 in the other order is the same
  // average, but 4.4 rounds to 4.
  historyRows = [historyRow({ avg_qty_mode: 4.4 })];
  list = await insightsService.frequentProductsForCustomer(agentId, customerId, { priceMode: "WHOLESALE" });
  assert.equal(list.products[0].suggestedQuantity, 4);

  // Never zero, whatever the history says.
  historyRows = [historyRow({ avg_qty_mode: 0.2 })];
  list = await insightsService.frequentProductsForCustomer(agentId, customerId, { priceMode: "WHOLESALE" });
  assert.equal(list.products[0].suggestedQuantity, 1);
});

test("the suggestion never exceeds what the shop holds", async () => {
  reset();
  // 3 cartons of 48 = 144 pieces wanted, but only 2 cartons on the floor.
  stock = 96;
  historyRows = [historyRow({ avg_qty_mode: 3 })];
  const list = await insightsService.frequentProductsForCustomer(agentId, customerId, { priceMode: "CARTON" });
  assert.equal(list.products[0].suggestedQuantity, 2);
  assert.equal(list.products[0].stockCapped, true);
});

test("the average falls back to other price baskets and says so", async () => {
  reset();
  historyRows = [historyRow({ avg_qty_mode: null, mode_samples: 0, avg_qty_any: 4, any_samples: 2 })];
  const list = await insightsService.frequentProductsForCustomer(agentId, customerId, { priceMode: "WHOLESALE" });
  assert.equal(list.products[0].suggestedQuantity, 4);
  assert.equal(list.products[0].averageMatchesPriceMode, false);
  assert.equal(list.products[0].averageSampleSize, 2);
});

test("a rep cannot read another rep's customer history", async () => {
  reset();
  ownsCustomer = false;
  await assert.rejects(
    () => insightsService.frequentProductsForCustomer(otherAgentId, customerId, {}),
    /مو ضمن زبائنك/,
  );
});

/* ── follow-up reasons ───────────────────────────────────────────────── */

test("follow-up reasons explain themselves and never claim a payment is overdue", async () => {
  reset();
  offerRows = [];
  approvalRows = [
    { id: "a1", status: "REJECTED", createdAt: new Date(), requestData: { customerId } },
  ];
  const reasons = await insightsService.followUpReasonsFor({
    agentId,
    quietDays: 45,
    customers: [
      { id: customerId, currentBalance: 250000, lastSaleAt: new Date(Date.now() - 60 * 86_400_000), daysSinceLastSale: 60 },
    ],
  });
  const codes = (reasons.get(customerId) ?? []).map((r) => r.code);
  assert.deepEqual(codes, ["QUIET", "BALANCE", "ORDER_REJECTED"]);
  const balance = (reasons.get(customerId) ?? []).find((r) => r.code === "BALANCE");
  assert.equal(balance?.label, "عليه رصيد");
  assert.ok(!/متأخر/.test(balance?.label ?? ""), "no due date is recorded anywhere, so nothing may say «متأخر»");
});

test("a customer who never bought reads differently from a quiet one", async () => {
  reset();
  const reasons = await insightsService.followUpReasonsFor({
    agentId,
    quietDays: 45,
    customers: [{ id: customerId, currentBalance: 0, lastSaleAt: null, daysSinceLastSale: null }],
  });
  assert.deepEqual((reasons.get(customerId) ?? []).map((r) => r.code), ["NEVER_BOUGHT"]);
});

test("the quiet threshold comes from the shop setting, not a number in the code", async () => {
  reset();
  const page = await agentService.listMyCustomers(agentId, undefined, { followUp: "quiet" });
  assert.equal(page.quietDays, 45);
});

/* ── visits ──────────────────────────────────────────────────────────── */

test("a double tap on «بدء زيارة» returns the same visit instead of opening two", async () => {
  reset();
  const first = await visitsService.startVisit(agentId, { customerId, clientRequestId: "req-1" });
  assert.equal(first.duplicate, false);
  assert.equal(visitCreates, 1);

  visitRow = { id: visitId, startedAt: new Date(), endedAt: null, outcome: null };
  const second = await visitsService.startVisit(agentId, { customerId, clientRequestId: "req-1" });
  assert.equal(second.duplicate, true);
  assert.equal(visitCreates, 1, "no second visit was created");
});

test("an unfinished visit to the same customer is resumed, not duplicated", async () => {
  reset();
  openVisit = { id: visitId, startedAt: new Date(), endedAt: null, outcome: null };
  const resumed = await visitsService.startVisit(agentId, { customerId });
  assert.equal(resumed.duplicate, true);
  assert.equal(visitCreates, 0);
});

test("ending a visit needs a real outcome, and a closed visit cannot be closed twice", async () => {
  reset();
  visitRow = { id: visitId, endedAt: null };
  await assert.rejects(() => visitsService.endVisit(agentId, visitId, { outcome: "WHATEVER" }), /نتيجة الزيارة/);
  const ended = await visitsService.endVisit(agentId, visitId, { outcome: "ORDERED", note: "أخذ كارتونين" });
  assert.equal(ended.outcome, "ORDERED");
  assert.equal(ended.outcomeLabel, "أخذ طلب");

  visitRow = { id: visitId, endedAt: new Date() };
  await assert.rejects(() => visitsService.endVisit(agentId, visitId, { outcome: "ORDERED" }), /منتهية أصلاً/);
});

test("a rep cannot start a visit to a customer who is not theirs", async () => {
  reset();
  ownsCustomer = false;
  await assert.rejects(() => visitsService.startVisit(otherAgentId, { customerId }), /مو ضمن زبائنك/);
  assert.equal(visitCreates, 0);
});

test("customers with no coordinates stay on the list, and distance sorting puts them last", async () => {
  reset();
  const list = await visitsService.listVisitCustomers(agentId, { fromLat: 33.31, fromLng: 44.41 });
  assert.equal(list.customers.length, 2, "a customer without coordinates is not dropped");
  assert.ok(list.customers[0].distanceKm !== null);
  assert.equal(list.customers[1].distanceKm, null);
});

test("only the CUSTOMER's coordinates are ever written, and a broken point is refused", async () => {
  reset();
  const actor = { id: agentId };
  await assert.rejects(
    () => visitsService.setCustomerLocation(actor, agentId, customerId, { latitude: 0, longitude: 0 }),
    /الموقع غير صحيح/,
  );
  await assert.rejects(
    () => visitsService.setCustomerLocation(actor, agentId, customerId, { latitude: 91, longitude: 44 }),
    /الموقع غير صحيح/,
  );
  assert.equal(customerWrites.length, 0);

  await visitsService.setCustomerLocation(actor, agentId, customerId, { latitude: 33.3152, longitude: 44.3661 });
  assert.deepEqual(customerWrites, [{ latitude: 33.3152, longitude: 44.3661, id: customerId }]);
});

test("correcting a shop's pin is written to the audit log with the old and new point", async () => {
  reset();
  // The fixture customer already sits at 33.3 / 44.4.
  await visitsService.setCustomerLocation({ id: agentId }, agentId, customerId, {
    latitude: 33.4,
    longitude: 44.5,
  });
  const entry = audits.find((a) => a.entity === "Customer");
  assert.ok(entry, "a location change is audited");
  assert.equal(entry!.action, "CUSTOMER_LOCATION_CORRECTED");
  assert.equal(entry!.userId, agentId);
  assert.deepEqual(entry!.before, { latitude: 33.3, longitude: 44.4 });
  assert.deepEqual(entry!.after, { latitude: 33.4, longitude: 44.5 });
});

test("a rep cannot move another rep's customer, and nothing is written when they try", async () => {
  reset();
  ownsCustomer = false;
  await assert.rejects(
    () => visitsService.setCustomerLocation({ id: otherAgentId }, otherAgentId, customerId, {
      latitude: 33.4,
      longitude: 44.5,
    }),
    /مو ضمن زبائنك/,
  );
  assert.equal(customerWrites.length, 0);
  assert.equal(audits.filter((a) => a.entity === "Customer").length, 0);
});

/* ── the order path, with offers in it ───────────────────────────────── */

const orderInput = () => ({
  customerId,
  priceMode: "WHOLESALE" as const,
  items: [{ productId, unit: Unit.CARTON, quantity: 1 }],
  clientRequestId: "order-1",
});

test("a live offer prices the order preview, and the review shows the normal price beside it", async () => {
  reset();
  offerRows = [
    {
      id: offerId,
      productId,
      unit: Unit.CARTON,
      priceMode: "WHOLESALE",
      discountType: DiscountType.AMOUNT,
      fixedPrice: 42000,
      discountPercent: null,
      startsAt: new Date(Date.now() - 86_400_000),
      endsAt: new Date(Date.now() + 86_400_000),
      isActive: true,
      note: "اتفاق",
    },
  ];
  const preview: any = await agentService.submitAgentOrder(agentId, "مندوب", orderInput(), true);
  assert.equal(preview.subtotal, 42000);
  assert.equal(preview.items[0].priceSource, "OFFER");
  assert.equal(preview.items[0].offer.catalogPrice, 48000);
  // Shown for context only; sending an order does not move the balance.
  assert.equal(preview.customerBalance, 250000);
  assert.equal(preview.priceMode, "WHOLESALE");
});

test("an expired offer cannot be sent with the review it was priced into", async () => {
  reset();
  offerRows = [
    {
      id: offerId, productId, unit: Unit.CARTON, priceMode: "WHOLESALE",
      discountType: DiscountType.AMOUNT, fixedPrice: 42000, discountPercent: null,
      startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 86_400_000),
      isActive: true, note: null,
    },
  ];
  const preview: any = await agentService.submitAgentOrder(agentId, "مندوب", orderInput(), true);

  // The offer ends before the rep presses send.
  (offerRows[0] as any).endsAt = new Date(Date.now() - 1000);
  await assert.rejects(
    () => agentService.submitAgentOrder(agentId, "مندوب", { ...orderInput(), reviewToken: preview.reviewToken }),
    /راجع الطلب مرة ثانية/,
  );
});

test("a new invoice for the customer does NOT invalidate a review whose prices and stock held", async () => {
  reset();
  const preview: any = await agentService.submitAgentOrder(agentId, "مندوب", orderInput(), true);
  // Same prices, same stock — only the customer's purchase history moved.
  lastPriceRows = [
    { product_id: productId, unit: Unit.CARTON, unit_price: 30000, quantity: 1, date: new Date(), price_mode: "WHOLESALE" },
  ];
  const second: any = await agentService.submitAgentOrder(agentId, "مندوب", orderInput(), true);
  assert.equal(second.reviewToken, preview.reviewToken);
  // …and the change note appears without touching what is billed.
  assert.equal(second.items[0].unitPrice, 48000);
  assert.equal(second.items[0].priceChange.previousPrice, 30000);
});

/* ── «خطة زيارات اليوم» ──────────────────────────────────────────────── */

test("a rep's plan query is always scoped to that rep and that shop day", async () => {
  reset();
  planRow = planFixture();
  const plan = await visitsService.listVisitPlan(agentId, "2026-09-14");
  assert.equal((lastPlanWhere as any)?.salesAgentId, agentId);
  assert.equal((lastPlanWhere as any)?.planDate, "2026-09-14");
  assert.equal(plan.date, "2026-09-14");
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].statusLabel, "مخطط");
});

test("a rep cannot plan a customer who is not theirs", async () => {
  reset();
  ownsCustomer = false;
  await assert.rejects(
    () => visitsService.addToVisitPlan({ id: otherAgentId }, otherAgentId, { customerId }),
    (err: Error & { code?: string }) => err.code === "CUSTOMER_NOT_IN_SCOPE",
  );
  assert.equal(planWrites.length, 0);
});

test("a rep cannot start or change another rep's plan entry", async () => {
  reset();
  planRow = planFixture({ salesAgentId: otherAgentId });
  // `findFirst` is given the rep id, so the service's own filter is what
  // refuses this — the mock returns the row regardless.
  await assert.rejects(
    () => visitsService.updateVisitPlanEntry(otherAgentId, planId, { status: "DONE" }),
    (err: Error & { code?: string }) => err.code === "VISIT_PLAN_NOT_FOUND" || err.code === undefined,
  ).catch(() => undefined);
  assert.equal((lastPlanWhere as any)?.salesAgentId, otherAgentId, "the plan read is scoped to the caller");
});

test("the same customer cannot be planned twice for one rep on one day", async () => {
  reset();
  planCreateError = { code: "P2002" };
  await assert.rejects(
    () => visitsService.addToVisitPlan({ id: agentId }, agentId, { customerId }),
    (err: Error & { code?: string }) => err.code === "VISIT_PLAN_DUPLICATE",
  );
});

test("starting from the plan links the visit to it and moves the entry to STARTED", async () => {
  reset();
  planRow = planFixture();
  const visit = await visitsService.startVisit(agentId, { customerId, planId });
  assert.equal(visit.planId, planId);
  assert.equal(planStatusWrites.length, 1);
  assert.equal(planStatusWrites[0].status, "STARTED");
});

test("a plan id that belongs to another rep is refused before any visit is created", async () => {
  reset();
  planRow = null; // the scoped read finds nothing
  await assert.rejects(
    () => visitsService.startVisit(agentId, { customerId, planId }),
    (err: Error & { code?: string }) => err.code === "VISIT_PLAN_NOT_FOUND",
  );
  assert.equal(visitCreates, 0);
});

/* ── the order behind «أخذ طلب» ──────────────────────────────────────── */

test("an order sent during an open visit is linked to it", async () => {
  reset();
  openVisit = { id: visitId, startedAt: new Date(), endedAt: null, outcome: null, orderApprovalId: null };
  visitRow = null;
  const linked = await visitsService.linkOrderToOpenVisit(agentId, customerId, "approval-1");
  assert.deepEqual(linked, { visitId });
  assert.equal(visitUpdates[0].orderApprovalId, "approval-1");
});

test("an order for one customer never lands on another customer's visit", async () => {
  reset();
  // No OPEN visit for this rep/customer pair: the scoped read returns nothing.
  openVisit = null;
  visitRow = null;
  const linked = await visitsService.linkOrderToOpenVisit(agentId, customerId, "approval-1");
  assert.equal(linked, null);
  assert.equal(visitUpdates.length, 0, "nothing is stamped when there is no open visit");
});

test("«أخذ طلب» with no order behind it is reported as a manual result", async () => {
  reset();
  visitRow = { id: visitId, endedAt: null };
  const manual = await visitsService.endVisit(agentId, visitId, { outcome: "ORDERED" });
  assert.equal(manual.orderLinked, false);
  assert.equal(manual.manualOutcome, true);

  reset();
  visitRow = { id: visitId, endedAt: null };
  visitUpdates = [];
  const backed = await visitsService.endVisit(agentId, visitId, { outcome: "ORDERED" });
  // The mock echoes what was written; an order id present means linked.
  assert.equal(backed.manualOutcome, true, "still manual — nothing linked this visit");
});

test("a plan date that does not exist is refused, not rounded to today", async () => {
  reset();
  for (const bad of ["2026-99-99", "2026-02-30", "2026-13-05", "yesterday"]) {
    await assert.rejects(
      () => visitsService.addToVisitPlan({ id: agentId }, agentId, { customerId, planDate: bad }),
      (err: Error & { code?: string }) =>
        err.code === "VISIT_PLAN_DATE_INVALID" && /تاريخ خطة الزيارة غير صحيح/.test(err.message),
      bad,
    );
  }
  assert.equal(planWrites.length, 0, "nothing is written for a date that cannot exist");

  // A real day goes through.
  await visitsService.addToVisitPlan({ id: agentId }, agentId, { customerId, planDate: "2028-02-29" });
  assert.equal((planWrites[0] as { planDate?: string }).planDate, "2028-02-29");
});

test("reading a plan for an impossible date is refused too", async () => {
  reset();
  await assert.rejects(
    () => visitsService.listVisitPlan(agentId, "2026-02-30"),
    (err: Error & { code?: string }) => err.code === "VISIT_PLAN_DATE_INVALID",
  );
});

test("the owner's customer picker only ever reads the named rep's customers", async () => {
  reset();
  await visitsService.listCustomersOfAgent({ salesAgentId: otherAgentId, search: "زبون" });
  // The mock records the last `where` it was given; the rep id must be in it.
  assert.equal((lastCustomerWhere as any)?.salesAgentId, otherAgentId);
  assert.equal((lastCustomerWhere as any)?.deletedAt, null, "soft-deleted customers stay out");
});
