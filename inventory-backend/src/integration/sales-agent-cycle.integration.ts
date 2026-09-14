/**
 * The rep's money cycle, end to end, against a REAL PostgreSQL database.
 *
 * Everything else in this feature is tested with a mocked database, which
 * proves the rules but not the round trip. This one provisions a throwaway
 * database, runs every migration on it, and then drives the actual services:
 * offer → server-priced review → order → approval → invoice → stock → balance.
 *
 * It also covers the two things a mock CANNOT test:
 *  - the EXCLUDE constraint that stops two overlapping offers, including when
 *    both requests arrive at the same moment;
 *  - that an invoice line is billed at the price the review promised.
 *
 * Run it with:   npm run test:integration
 * It is deliberately NOT matched by `npm test`'s `src/**\/*.test.ts` glob: it
 * needs a database, and the unit suite must stay runnable with none.
 *
 * ── Safety ──────────────────────────────────────────────────────────────
 * The database name must end with `_test`, the host must be local, and
 * anything that looks like a hosted/production URL is refused outright. The
 * database is created at the start and dropped at the end.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/* ── provisioning ─────────────────────────────────────────────────────── */

const SUFFIX = "_integration_test";

function baseUrl(): URL {
  // Loaded the same way the app loads it. The value is never printed.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config();
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("[INTEGRATION] DATABASE_URL is not set; cannot derive a test database.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("[INTEGRATION] DATABASE_URL is not a valid URL.");
  }
  const host = url.hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`[INTEGRATION] Refusing to run against host "${host}". Local databases only.`);
  }
  if (/railway|neon|rds\.amazonaws|supabase|render|prod/i.test(raw)) {
    throw new Error("[INTEGRATION] DATABASE_URL looks like a hosted database. Refusing.");
  }
  return url;
}

const adminUrl = baseUrl();
const sourceName = decodeURIComponent(adminUrl.pathname.replace(/^\/+/, ""));
if (/_integration_test$/.test(sourceName)) {
  throw new Error("[INTEGRATION] DATABASE_URL already points at the test database; refusing to nest.");
}
const testDbName = `${sourceName}${SUFFIX}`;
if (!testDbName.endsWith("_test")) {
  throw new Error(`[INTEGRATION] Derived name "${testDbName}" must end with _test.`);
}
adminUrl.pathname = "/postgres";
const testUrl = new URL(adminUrl.toString());
testUrl.pathname = `/${testDbName}`;

// Every module below reads DATABASE_URL when it is first imported, so the
// value has to be in place before any service is loaded.
process.env.DATABASE_URL = testUrl.toString();
process.env.NODE_ENV = "test";

let db: PrismaClient;
type Services = {
  agent: typeof import("../services/sales-agent.service");
  offers: typeof import("../services/sales-agent-offers.service");
  insights: typeof import("../services/sales-agent-insights.service");
  visits: typeof import("../services/sales-agent-visits.service");
  approvals: typeof import("../services/approval.service");
};
let svc: Services;

/* ── fixture ids ──────────────────────────────────────────────────────── */

const ids = {
  admin: randomUUID(),
  rep: randomUUID(),
  otherRep: randomUUID(),
  shop: randomUUID(),
  customer: randomUUID(),
  otherCustomer: randomUUID(),
  product: randomUUID(),
};

const CARTON_PIECES = 48;
const SALE_PRICE = 1000;
const OPENING_PIECES = 10 * CARTON_PIECES;
/** The offer: 40,000 a carton against a 48,000 wholesale carton. */
const OFFER_PRICE = 40_000;

before(async () => {
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${testDbName}"`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${testDbName}"`);
  } finally {
    await admin.$disconnect();
  }

  const deploy = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    encoding: "utf8",
    shell: true,
  });
  if (deploy.status !== 0) {
    throw new Error(`[INTEGRATION] migrate deploy failed:\n${deploy.stdout}\n${deploy.stderr}`);
  }

  // The migration history alone does NOT reproduce a real database: this
  // codebase self-heals a handful of columns at boot (`customers.is_both`,
  // `invoices.updated_at`, …). Running the same step here is what makes the
  // throwaway database shaped like the one in production.
  const { runStartupMigrations } = await import("../config/startup-migrations");
  await runStartupMigrations();

  db = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });

  await db.user.createMany({
    data: [
      { id: ids.admin, name: "المالك", username: `owner_${ids.admin.slice(0, 8)}`, passwordHash: "integration-only", role: "ADMIN", permissions: [] },
      { id: ids.rep, name: "مندوب أ", username: `rep_a_${ids.rep.slice(0, 8)}`, passwordHash: "integration-only", role: "STAFF", permissions: ["SALES_AGENT"] },
      { id: ids.otherRep, name: "مندوب ب", username: `rep_b_${ids.otherRep.slice(0, 8)}`, passwordHash: "integration-only", role: "STAFF", permissions: ["SALES_AGENT"] },
    ],
  });

  // Named «المحل» so `resolveShopWarehouseId` finds it the way production does.
  await db.branch.create({ data: { id: ids.shop, name: "المحل", code: `SHOP${Date.now() % 100000}` } });

  await db.customer.createMany({
    data: [
      { id: ids.customer, name: "أسواق الربيع", phone: `0770${Date.now() % 10_000_000}`, salesAgentId: ids.rep },
      { id: ids.otherCustomer, name: "زبون مندوب ثاني", phone: `0771${Date.now() % 10_000_000}`, salesAgentId: ids.otherRep },
    ],
  });

  await db.product.create({
    data: {
      id: ids.product,
      itemNumber: `INT-${Date.now() % 100000}`,
      qrCode: `INT-QR-${Date.now()}`,
      createdBy: ids.admin,
      name: "مادة تكامل",
      salePrice: SALE_PRICE,
      purchasePrice: 600,
      costPrice: 600,
      retailPrice: 1200,
      cartonPiecePrice: 750,
      pcsPerCarton: CARTON_PIECES,
      boxPieces: 24,
      openingBalancePcs: 0,
      cartonsAvailable: 0,
      warehouseStocks: { create: { warehouseId: ids.shop, quantityPieces: OPENING_PIECES } },
    },
  });

  svc = {
    agent: await import("../services/sales-agent.service"),
    offers: await import("../services/sales-agent-offers.service"),
    insights: await import("../services/sales-agent-insights.service"),
    visits: await import("../services/sales-agent-visits.service"),
    approvals: await import("../services/approval.service"),
  };
});

after(async () => {
  // ORDER MATTERS. Approving an order fires notifications, and a failed send
  // used to queue a retry timer; that timer then woke up after the database was
  // gone and logged «Database ... does not exist» while keeping the process
  // alive. So: cancel queued work, let in-flight `setImmediate` callbacks
  // drain, disconnect, and only then drop.
  const { cancelPendingWhatsAppRetries, pendingWhatsAppRetryCount } = await import(
    "../services/order-preparation.service"
  );
  const cancelled = cancelPendingWhatsAppRetries();
  if (cancelled > 0) {
    // Not fatal, but worth knowing: something scheduled a retry despite test
    // mode, which is exactly the leak this teardown exists to catch.
    console.error(`[INTEGRATION] cancelled ${cancelled} queued WhatsApp retries`);
  }
  // One turn of the loop for the fire-and-forget `setImmediate` work the
  // approval path schedules.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(pendingWhatsAppRetryCount(), 0, "no background retry may survive the suite");

  const { prisma } = await import("../config/database").catch(() => ({ prisma: null }) as never);
  await prisma?.$disconnect().catch(() => undefined);
  await db?.$disconnect().catch(() => undefined);
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${testDbName}' AND pid <> pg_backend_pid()`,
    );
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${testDbName}"`);
  } finally {
    await admin.$disconnect();
  }
});

/** Shop-local day keys, so the offer window means what the owner picked. */
async function shopDays() {
  const { shopDateKey, shopDayStart, shopDayEndExclusive } = await import("../utils/shop-day");
  const today = shopDateKey(new Date());
  return { today, start: shopDayStart(today), endExclusive: shopDayEndExclusive(today) };
}

describe("the rep's money cycle, against a real database", () => {
  let offerId: string;
  let approvalId: string;
  let reviewToken: string;
  const clientRequestId = randomUUID();

  it("stores an offer whose window covers the whole picked day, shop time", async () => {
    const { today, start, endExclusive } = await shopDays();
    const created = await svc.offers.createCustomerOffer({ id: ids.admin }, null, {
      customerId: ids.customer,
      productId: ids.product,
      unit: "CARTON",
      priceMode: "WHOLESALE",
      discountType: "AMOUNT",
      fixedPrice: OFFER_PRICE,
      startsAt: start,
      endsAt: endExclusive,
      note: "اتفاق تكامل",
    });
    offerId = created.id;

    assert.equal(created.offerPrice, OFFER_PRICE);
    assert.equal(created.catalogPrice, SALE_PRICE * CARTON_PIECES);
    assert.equal(created.isLive, true, "an offer for today is live today");
    assert.equal(created.state, "LIVE");
    // The day the owner picked, not the exclusive instant.
    assert.equal(created.endsOnDate, today);
    assert.equal(created.startsOnDate, today);

    const row = await db.salesAgentCustomerOffer.findUniqueOrThrow({ where: { id: offerId } });
    assert.equal(row.endsAt.getTime(), endExclusive.getTime(), "stored end is exclusive");
  });

  it("refuses a second overlapping active offer — and refuses it under a real race", async () => {
    const { start, endExclusive } = await shopDays();
    const attempt = () =>
      svc.offers.createCustomerOffer({ id: ids.admin }, null, {
        customerId: ids.customer,
        productId: ids.product,
        unit: "CARTON",
        priceMode: "WHOLESALE",
        discountType: "AMOUNT",
        fixedPrice: 41_000,
        startsAt: start,
        endsAt: endExclusive,
      });

    await assert.rejects(attempt, (err: Error & { code?: string }) => err.code === "OFFER_PERIOD_OVERLAP");

    // Two at once: the database, not the application, is what keeps them apart.
    const pair = await Promise.allSettled([attempt(), attempt()]);
    assert.equal(pair.filter((r) => r.status === "fulfilled").length, 0, "neither may slip past the live offer");

    // …and with the live one paused, exactly ONE of two simultaneous creates wins.
    await svc.offers.setCustomerOfferActive({ id: ids.admin }, null, offerId, false);
    const race = await Promise.allSettled([attempt(), attempt()]);
    const won = race.filter((r) => r.status === "fulfilled");
    assert.equal(won.length, 1, `exactly one of two concurrent creates must win, got ${won.length}`);
    const live = await db.salesAgentCustomerOffer.count({
      where: { customerId: ids.customer, productId: ids.product, unit: "CARTON", priceMode: "WHOLESALE", isActive: true },
    });
    assert.equal(live, 1);

    // Clean up: drop the winner, bring the original back.
    await db.salesAgentCustomerOffer.deleteMany({ where: { id: { not: offerId }, customerId: ids.customer } });
    await svc.offers.setCustomerOfferActive({ id: ids.admin }, null, offerId, true);
  });

  it("allows a new offer once the old window has ended, and keeps the old one as history", async () => {
    const { shopDayStart, shopDayEndExclusive } = await import("../utils/shop-day");
    const { addDaysStr } = await import("../services/daily-assistant.service");
    const { today } = await shopDays();
    const tomorrow = addDaysStr(today, 1);

    const next = await svc.offers.createCustomerOffer({ id: ids.admin }, null, {
      customerId: ids.customer,
      productId: ids.product,
      unit: "CARTON",
      priceMode: "WHOLESALE",
      discountType: "PERCENT",
      discountPercent: 5,
      startsAt: shopDayStart(tomorrow),
      endsAt: shopDayEndExclusive(tomorrow),
    });
    assert.equal(next.state, "SCHEDULED", "tomorrow's offer is scheduled, not live");

    const timeline = await db.salesAgentCustomerOffer.count({
      where: { customerId: ids.customer, productId: ids.product, unit: "CARTON", priceMode: "WHOLESALE" },
    });
    assert.equal(timeline, 2, "the finished/current offer and the next one both exist");
  });

  it("resuming a paused offer that overlaps a live one is refused", async () => {
    const { start, endExclusive } = await shopDays();
    const paused = await svc.offers.createCustomerOffer({ id: ids.admin }, null, {
      customerId: ids.customer,
      productId: ids.product,
      unit: "DOZEN",
      priceMode: "WHOLESALE",
      discountType: "AMOUNT",
      fixedPrice: 9_000,
      startsAt: start,
      endsAt: endExclusive,
      isActive: false,
    });
    // A live DOZEN offer over the same window.
    await svc.offers.createCustomerOffer({ id: ids.admin }, null, {
      customerId: ids.customer,
      productId: ids.product,
      unit: "DOZEN",
      priceMode: "WHOLESALE",
      discountType: "AMOUNT",
      fixedPrice: 9_500,
      startsAt: start,
      endsAt: endExclusive,
    });
    await assert.rejects(
      () => svc.offers.setCustomerOfferActive({ id: ids.admin }, null, paused.id, true),
      (err: Error & { code?: string }) => err.code === "OFFER_PERIOD_OVERLAP",
    );
  });

  it("prices the review from the server, at the offer price", async () => {
    const preview = (await svc.agent.submitAgentOrder(
      ids.rep,
      "مندوب أ",
      {
        customerId: ids.customer,
        priceMode: "WHOLESALE",
        items: [{ productId: ids.product, unit: "CARTON", quantity: 2 }],
        clientRequestId,
      },
      true,
    )) as {
      reviewToken: string;
      subtotal: number;
      items: Array<{ unitPrice: number; priceSource: string; offer?: { catalogPrice: number } }>;
    };

    reviewToken = preview.reviewToken;
    assert.equal(preview.items[0].priceSource, "OFFER");
    assert.equal(preview.items[0].unitPrice, OFFER_PRICE);
    assert.equal(preview.items[0].offer?.catalogPrice, SALE_PRICE * CARTON_PIECES);
    assert.equal(preview.subtotal, OFFER_PRICE * 2);
  });

  it("sends the order once, and a repeat of the same attempt returns the same order", async () => {
    const input = {
      customerId: ids.customer,
      priceMode: "WHOLESALE" as const,
      items: [{ productId: ids.product, unit: "CARTON" as const, quantity: 2 }],
      clientRequestId,
      reviewToken,
    };
    const first = (await svc.agent.submitAgentOrder(ids.rep, "مندوب أ", input)) as {
      approvalId: string;
      duplicate: boolean;
    };
    approvalId = first.approvalId;
    assert.equal(first.duplicate, false);

    const again = (await svc.agent.submitAgentOrder(ids.rep, "مندوب أ", input)) as {
      approvalId: string;
      duplicate: boolean;
    };
    assert.equal(again.approvalId, approvalId, "the same key hands back the same order");
    assert.equal(again.duplicate, true);

    const count = await db.pendingApproval.count({ where: { requestedBy: ids.rep, requestType: "CATALOG_ORDER" } });
    assert.equal(count, 1, "no twin order was created");

    // The customer id is stored in the column, which is what lets the
    // follow-up filter run inside the customers query.
    const stored = await db.pendingApproval.findUniqueOrThrow({ where: { id: approvalId } });
    assert.equal(stored.customerId, ids.customer);
  });

  it("refuses the same review token once the offer behind it is gone", async () => {
    await svc.offers.setCustomerOfferActive({ id: ids.admin }, null, offerId, false);
    await assert.rejects(
      () =>
        svc.agent.submitAgentOrder(ids.rep, "مندوب أ", {
          customerId: ids.customer,
          priceMode: "WHOLESALE",
          items: [{ productId: ids.product, unit: "CARTON", quantity: 2 }],
          clientRequestId: randomUUID(),
          reviewToken,
        }),
      (err: Error & { code?: string }) => err.code === "ORDER_REVIEW_CHANGED",
    );
    await svc.offers.setCustomerOfferActive({ id: ids.admin }, null, offerId, true);
  });

  it("bills the approved order at exactly the reviewed price, and moves stock and balance", async () => {
    const before = await db.customer.findUniqueOrThrow({ where: { id: ids.customer } });
    const stockBefore = await db.productWarehouseStock.findFirstOrThrow({
      where: { productId: ids.product, warehouseId: ids.shop },
    });

    await svc.approvals.reviewApproval(approvalId, "APPROVED", ids.admin, { catalogOrderMode: "INVOICE" });

    const invoice = await db.invoice.findFirstOrThrow({
      where: { customerId: ids.customer, type: "SALE" },
      include: { items: true },
    });

    assert.equal(invoice.items.length, 1);
    const line = invoice.items[0];
    assert.equal(Number(line.unitPrice), OFFER_PRICE, "the invoice bills the reviewed offer price");
    assert.equal(line.quantity, 2);
    assert.equal(Number(line.totalPrice), OFFER_PRICE * 2);
    assert.equal(Number(invoice.subtotal), OFFER_PRICE * 2);
    assert.equal(Number(invoice.totalAmount), OFFER_PRICE * 2);
    assert.equal(invoice.priceMode, "WHOLESALE");

    const stockAfter = await db.productWarehouseStock.findFirstOrThrow({
      where: { productId: ids.product, warehouseId: ids.shop },
    });
    assert.equal(
      stockBefore.quantityPieces - stockAfter.quantityPieces,
      2 * CARTON_PIECES,
      "two cartons left the shop",
    );

    const after = await db.customer.findUniqueOrThrow({ where: { id: ids.customer } });
    // A credit sale raises what the customer owes by the unpaid remainder.
    assert.equal(
      Number(after.currentBalance) - Number(before.currentBalance),
      Number(invoice.remainingAmount),
      "the balance moved by the unpaid remainder, per the project's accounting rule",
    );
  });

  it("«يشتريها عادةً» reads the real invoice and nets a partial return", async () => {
    const usual = await svc.insights.frequentProductsForCustomer(ids.rep, ids.customer, {
      priceMode: "WHOLESALE",
    });
    const row = usual.products.find((p) => p.productId === ids.product && p.unit === "CARTON");
    assert.ok(row, "the product just bought appears");
    assert.equal(row!.suggestedQuantity, 2, "one purchase of 2 averages to 2");
    assert.equal(row!.averageSampleSize, 1);

    // Return ONE of the two cartons: the line stays a purchase, at net 1.
    const sale = await db.invoice.findFirstOrThrow({ where: { customerId: ids.customer, type: "SALE" } });
    const ret = await db.invoice.create({
      data: {
        invoiceNumber: `RET-${Date.now()}`,
        type: "SALES_RETURN",
        customerId: ids.customer,
        createdBy: ids.admin,
        originalInvoiceId: sale.id,
        subtotal: OFFER_PRICE,
        totalAmount: OFFER_PRICE,
        paymentType: "CREDIT",
        items: {
          create: {
            productId: ids.product,
            productName: "مادة تكامل",
            unit: "CARTON",
            quantity: 1,
            unitPrice: OFFER_PRICE,
            totalPrice: OFFER_PRICE,
          },
        },
      },
    });

    const afterReturn = await svc.insights.frequentProductsForCustomer(ids.rep, ids.customer, {
      priceMode: "WHOLESALE",
    });
    const netted = afterReturn.products.find((p) => p.productId === ids.product && p.unit === "CARTON");
    assert.ok(netted, "a partial return does not delete the product from the list");
    assert.equal(netted!.suggestedQuantity, 1, "the suggestion follows the NET quantity");

    // An archived return counts for nothing.
    await db.invoice.update({ where: { id: ret.id }, data: { archivedAt: new Date() } });
    const afterArchive = await svc.insights.frequentProductsForCustomer(ids.rep, ids.customer, {
      priceMode: "WHOLESALE",
    });
    const restored = afterArchive.products.find((p) => p.productId === ids.product && p.unit === "CARTON");
    assert.equal(restored!.suggestedQuantity, 2, "an archived return is not a return");

    // Returning everything removes the line from history entirely.
    await db.invoice.update({ where: { id: ret.id }, data: { archivedAt: null } });
    await db.invoiceItem.updateMany({ where: { invoiceId: ret.id }, data: { quantity: 2 } });
    const afterFull = await svc.insights.frequentProductsForCustomer(ids.rep, ids.customer, {
      priceMode: "WHOLESALE",
    });
    assert.equal(
      afterFull.products.some((p) => p.productId === ids.product && p.unit === "CARTON"),
      false,
      "a fully returned line is not a purchase",
    );

    await db.invoiceItem.deleteMany({ where: { invoiceId: ret.id } });
    await db.invoice.delete({ where: { id: ret.id } });
  });

  it("keeps another rep out of the customer, the offer, the order and the plan", async () => {
    await assert.rejects(
      () => svc.agent.getCustomerHeader(ids.otherRep, ids.customer),
      (err: Error & { code?: string }) => err.code === "CUSTOMER_NOT_IN_SCOPE",
    );

    const theirOffers = await svc.offers.listCustomerOffers({
      agentScope: ids.otherRep,
      customerId: ids.customer,
    });
    assert.equal(theirOffers.total, 0, "another rep sees none of this customer's offers");

    const theirOrders = await svc.agent.listMyOrders(ids.otherRep);
    assert.equal(theirOrders.length, 0, "another rep sees none of this rep's orders");

    await assert.rejects(
      () => svc.insights.frequentProductsForCustomer(ids.otherRep, ids.customer, {}),
      (err: Error & { code?: string }) => err.code === "CUSTOMER_NOT_IN_SCOPE",
    );

    // …and cannot plan or visit them either.
    await assert.rejects(
      () => svc.visits.addToVisitPlan({ id: ids.otherRep }, ids.otherRep, { customerId: ids.customer }),
      (err: Error & { code?: string }) => err.code === "CUSTOMER_NOT_IN_SCOPE",
    );
    await assert.rejects(
      () => svc.visits.startVisit(ids.otherRep, { customerId: ids.customer }),
      (err: Error & { code?: string }) => err.code === "CUSTOMER_NOT_IN_SCOPE",
    );
  });

  it("plans a day, starts the visit from it, and links the order the visit produced", async () => {
    const entry = await svc.visits.addToVisitPlan({ id: ids.admin }, null, {
      salesAgentId: ids.rep,
      customerId: ids.customer,
      note: "يحتاج متابعة",
    });
    assert.equal(entry.status, "PLANNED");

    await assert.rejects(
      () => svc.visits.addToVisitPlan({ id: ids.admin }, null, { salesAgentId: ids.rep, customerId: ids.customer }),
      (err: Error & { code?: string }) => err.code === "VISIT_PLAN_DUPLICATE",
    );

    const started = (await svc.visits.startVisit(ids.rep, {
      customerId: ids.customer,
      planId: entry.id,
    })) as { id: string; planId?: string | null };
    assert.equal(started.planId, entry.id);
    const plannedRow = await db.salesAgentVisitPlan.findUniqueOrThrow({ where: { id: entry.id } });
    assert.equal(plannedRow.status, "STARTED");

    // An order sent while that visit is open belongs to it.
    const key = randomUUID();
    const preview = (await svc.agent.submitAgentOrder(
      ids.rep,
      "مندوب أ",
      {
        customerId: ids.customer,
        priceMode: "WHOLESALE",
        items: [{ productId: ids.product, unit: "CARTON", quantity: 1 }],
        clientRequestId: key,
      },
      true,
    )) as { reviewToken: string };

    const sent = (await svc.agent.submitAgentOrder(ids.rep, "مندوب أ", {
      customerId: ids.customer,
      priceMode: "WHOLESALE",
      items: [{ productId: ids.product, unit: "CARTON", quantity: 1 }],
      clientRequestId: key,
      reviewToken: preview.reviewToken,
    })) as { linkedVisitId: string | null };

    assert.equal(sent.linkedVisitId, started.id, "the order is attached to the open visit");

    const ended = await svc.visits.endVisit(ids.rep, started.id, { outcome: "ORDERED" });
    assert.equal(ended.orderLinked, true, "«أخذ طلب» is backed by a real order");
    assert.equal(ended.manualOutcome, false);

    const donePlan = await db.salesAgentVisitPlan.findUniqueOrThrow({ where: { id: entry.id } });
    assert.equal(donePlan.status, "DONE");
  });

  it("«أخذ طلب» with no order behind it is recorded as a manual result", async () => {
    const visit = await svc.visits.startVisit(ids.rep, { customerId: ids.customer });
    const ended = await svc.visits.endVisit(ids.rep, visit.id, { outcome: "ORDERED" });
    assert.equal(ended.orderLinked, false);
    assert.equal(ended.manualOutcome, true, "nothing may present this as a documented sale");
  });

  it("«يحتاجون متابعة» filters inside the query, so a later page cannot hide anyone", async () => {
    // 30 extra customers for this rep, none of whom ever bought: every one of
    // them needs following up, so paging must show them and the total must
    // count them.
    const extras = Array.from({ length: 30 }, (_, i) => ({
      id: randomUUID(),
      name: `زبون متابعة ${i + 1}`,
      phone: `0772${String(Date.now() % 1_000_000).padStart(6, "0")}${String(i).padStart(2, "0")}`,
      salesAgentId: ids.rep,
    }));
    await db.customer.createMany({ data: extras });

    const firstPage = await svc.agent.listMyCustomers(ids.rep, undefined, {
      needsFollowUp: true,
      page: 1,
      limit: 5,
    });
    assert.ok(firstPage.total >= 30, `the total counts the filtered set, got ${firstPage.total}`);
    assert.equal(firstPage.customers.length, 5, "the page is a page, not the whole list");
    assert.equal(firstPage.hasMore, true);

    const lastPageNo = Math.ceil(firstPage.total / 5);
    const lastPage = await svc.agent.listMyCustomers(ids.rep, undefined, {
      needsFollowUp: true,
      page: lastPageNo,
      limit: 5,
    });
    assert.ok(lastPage.customers.length > 0, "a customer who needs following up on the LAST page still appears");

    // Every row the filter returned has at least one stated reason.
    const reasons = await svc.insights.followUpReasonsFor({
      agentId: ids.rep,
      quietDays: firstPage.quietDays,
      customers: firstPage.customers.map((c) => ({
        id: c.id,
        currentBalance: c.currentBalance,
        lastSaleAt: c.lastSaleAt,
        daysSinceLastSale: c.daysSinceLastSale,
      })),
    });
    for (const customer of firstPage.customers) {
      assert.ok((reasons.get(customer.id) ?? []).length > 0, `no reason for ${customer.name}`);
    }

    // Another rep's customers never appear in it.
    const otherRepPage = await svc.agent.listMyCustomers(ids.otherRep, undefined, { needsFollowUp: true });
    assert.equal(
      otherRepPage.customers.some((c) => c.id === ids.customer),
      false,
    );

    await db.customer.deleteMany({ where: { id: { in: extras.map((e) => e.id) } } });
  });

  it("a rep never holds the offers permission by default, and a granted rep stays inside their own customers", async () => {
    const rep = await db.user.findUniqueOrThrow({ where: { id: ids.rep } });
    assert.equal(
      rep.permissions.includes("MANAGE_CUSTOMER_OFFERS"),
      false,
      "no migration and no seed may grant this to a rep",
    );

    // Granting it lets them write — for THEIR customers only.
    await db.user.update({
      where: { id: ids.rep },
      data: { permissions: { set: ["SALES_AGENT", "MANAGE_CUSTOMER_OFFERS"] } },
    });
    await assert.rejects(
      () =>
        svc.offers.createCustomerOffer({ id: ids.rep }, ids.rep, {
          customerId: ids.otherCustomer,
          productId: ids.product,
          unit: "CARTON",
          priceMode: "WHOLESALE",
          discountType: "AMOUNT",
          fixedPrice: 30_000,
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 86_400_000),
        }),
      (err: Error & { code?: string }) => err.code === "CUSTOMER_NOT_FOUND",
      "another rep's customer is not theirs to price",
    );
    await db.user.update({ where: { id: ids.rep }, data: { permissions: { set: ["SALES_AGENT"] } } });
  });

  it("accepts a fixed price above the catalog price only when confirmed, and stores it untouched", async () => {
    const { addDaysStr } = await import("../services/daily-assistant.service");
    const { shopDayStart, shopDayEndExclusive } = await import("../utils/shop-day");
    const { today } = await shopDays();
    const day = addDaysStr(today, 10);
    const dearer = {
      customerId: ids.customer,
      productId: ids.product,
      unit: "CARTON" as const,
      priceMode: "WHOLESALE" as const,
      discountType: "AMOUNT" as const,
      fixedPrice: 60_000,
      startsAt: shopDayStart(day),
      endsAt: shopDayEndExclusive(day),
    };

    await assert.rejects(
      () => svc.offers.createCustomerOffer({ id: ids.admin }, null, dearer),
      (err: Error & { code?: string }) => err.code === "OFFER_ABOVE_CATALOG_UNCONFIRMED",
    );

    const created = await svc.offers.createCustomerOffer({ id: ids.admin }, null, {
      ...dearer,
      confirmAboveCatalog: true,
    });
    assert.equal(created.offerPrice, 60_000, "stored exactly as the owner entered it");
    assert.equal(created.aboveCatalog, true);

    const row = await db.salesAgentCustomerOffer.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(Number(row.fixedPrice), 60_000, "the server never adjusted it");
  });

  it("a test run sends nothing outward and queues no retry", async () => {
    const prep = await import("../services/order-preparation.service");
    const { externalSendsBlocked, isPermanentSendFailure } = await import("../utils/external-sends");

    // The whole cycle above already approved an order, which is the path that
    // notifies staff and the customer. Nothing may be queued from it.
    assert.equal(externalSendsBlocked(), true, "NODE_ENV=test blocks outbound sends");
    assert.equal(prep.pendingWhatsAppRetryCount(), 0, "no retry timer was scheduled during the cycle");

    // «WhatsApp is disabled» is a setting, not a hiccup: it must never be
    // retried, in test or in production.
    const disabled = Object.assign(new Error("WhatsApp is disabled. Set ENABLE_WHATSAPP=true"), {
      code: "WHATSAPP_DISABLED",
    });
    assert.equal(isPermanentSendFailure(disabled), true);
    assert.equal(isPermanentSendFailure(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })), false);
  });

  it("an invalid plan date is refused, and a real one is accepted, in shop time", async () => {
    const { today } = await shopDays();

    for (const bad of ["2026-99-99", "2026-02-30", "not-a-date", "26-01-01", "2026-13-01"]) {
      await assert.rejects(
        () => svc.visits.addToVisitPlan({ id: ids.admin }, null, {
          salesAgentId: ids.rep,
          customerId: ids.customer,
          planDate: bad,
        }),
        (err: Error & { code?: string }) =>
          err.code === "VISIT_PLAN_DATE_INVALID" && /تاريخ خطة الزيارة غير صحيح/.test(err.message),
        `must refuse ${bad}`,
      );
    }

    // A real leap day is fine; 2026 is not a leap year, so its 29th is not.
    await assert.rejects(
      () => svc.visits.listVisitPlan(ids.rep, "2026-02-29"),
      (err: Error & { code?: string }) => err.code === "VISIT_PLAN_DATE_INVALID",
    );
    const leap = await svc.visits.listVisitPlan(ids.rep, "2028-02-29");
    assert.equal(leap.date, "2028-02-29");

    // …and today's plan still reads back as the shop's today.
    const todaysPlan = await svc.visits.listVisitPlan(ids.rep);
    assert.equal(todaysPlan.date, today);
  });

  it("the owner can only plan a rep's OWN customers, and sees their timeline", async () => {
    // The other rep's customer cannot be planned for this rep, whoever asks.
    await assert.rejects(
      () => svc.visits.addToVisitPlan({ id: ids.admin }, null, {
        salesAgentId: ids.rep,
        customerId: ids.otherCustomer,
      }),
      (err: Error & { code?: string }) => err.code === "CUSTOMER_NOT_IN_SCOPE",
    );

    // The owner's customer picker is scoped to the rep they named.
    const mine = await svc.visits.listCustomersOfAgent({ salesAgentId: ids.rep });
    assert.ok(mine.some((c) => c.id === ids.customer));
    assert.equal(mine.some((c) => c.id === ids.otherCustomer), false);

    // Cancelling the intention does not delete the visit that happened.
    const plan = await svc.visits.listVisitPlan(ids.rep);
    const entry = plan.entries[0];
    assert.ok(entry, "the cycle above left a plan entry");
    const visitsBefore = await db.salesAgentVisit.count({ where: { customerId: entry.customerId } });
    await svc.visits.updateVisitPlanEntry(null, entry.id, { status: "CANCELLED" });
    const visitsAfter = await db.salesAgentVisit.count({ where: { customerId: entry.customerId } });
    assert.equal(visitsAfter, visitsBefore, "a cancelled plan keeps every real visit");
    // …and it can come back.
    const restored = await svc.visits.updateVisitPlanEntry(null, entry.id, { status: "PLANNED" });
    assert.equal(restored.status, "PLANNED");
  });

  it("writes the audit trail the owner needs: offers and moved shop pins", async () => {
    const offerAudits = await db.auditLog.findMany({ where: { entity: "SalesAgentCustomerOffer" } });
    assert.ok(offerAudits.length > 0, "offer writes are audited");
    assert.ok(
      offerAudits.some((a) => a.action === "CREATE") && offerAudits.some((a) => a.action === "OFFER_PAUSE"),
      "creating and pausing are both recorded",
    );

    await svc.visits.setCustomerLocation({ id: ids.rep }, ids.rep, ids.customer, {
      latitude: 33.3152,
      longitude: 44.3661,
    });
    await svc.visits.setCustomerLocation({ id: ids.rep }, ids.rep, ids.customer, {
      latitude: 33.4,
      longitude: 44.5,
    });
    const moves = await db.auditLog.findMany({
      where: { entity: "Customer", recordId: ids.customer },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(moves.length, 2);
    assert.equal(moves[0].action, "CUSTOMER_LOCATION_SET");
    assert.equal(moves[1].action, "CUSTOMER_LOCATION_CORRECTED");
    assert.deepEqual(moves[1].before, { latitude: 33.3152, longitude: 44.3661 });
    assert.deepEqual(moves[1].after, { latitude: 33.4, longitude: 44.5 });
  });
});
