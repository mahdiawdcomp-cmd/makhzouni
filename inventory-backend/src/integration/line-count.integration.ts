/**
 * «جرد بالسطور» end to end against a REAL throwaway PostgreSQL database:
 * duplicate lines sum, cartons convert from the DB size, retry-submit is
 * idempotent, finalize books ONE sale + ONE purchase and moves stock exactly
 * by the accepted variances, rejected/uncounted products stay untouched.
 * Run: npm run test:integration
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/* ── provisioning ─────────────────────────────────────────────────────── */

const SUFFIX = "_linecount_integration_test";

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
let svc: typeof import("../services/line-count.service");

const ids = {
  admin: randomUUID(),
  shop: randomUUID(),
  supplier: randomUUID(),
  a: randomUUID(), // shortage, written on 2 lines → accepted
  b: randomUUID(), // overage in cartons → accepted
  c: randomUUID(), // shortage → rejected
  d: randomUUID(), // matched
  e: randomUUID(), // never written → uncounted
  f: randomUUID(), // corrections session: cartons typed as pieces
  g: randomUUID(), // corrections session: recounted
  h: randomUUID(), // lock session: shortage → frozen until decided
  i: randomUUID(), // lock session: matched → never frozen
  j: randomUUID(), // lock session: uncounted → «أكيد خلصانة»
  k: randomUUID(), // lock session: uncounted → «أعد عدّها»
};

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
  await db.user.create({ data: { id: ids.admin, name: "المالك", username: `owner_${ids.admin.slice(0, 8)}`, passwordHash: "integration-only", role: "ADMIN", permissions: [] } });
  await db.branch.create({ data: { id: ids.shop, name: "المحل", code: `SHOP${Date.now() % 100000}` } });
  await db.customer.create({ data: { id: ids.supplier, name: "مهدي", phone: `0772${Date.now() % 10_000_000}`, isSupplier: true } });
  const mk = (id: string, n: number, stock: number, ppc = 1) =>
    db.product.create({
      data: {
        id, itemNumber: `LC-${n}-${Date.now() % 100000}`, qrCode: `LC-QR-${n}-${Date.now()}`, createdBy: ids.admin,
        name: `مادة ${n}`, salePrice: 1000, purchasePrice: 600, costPrice: 600, pcsPerCarton: ppc,
        openingBalancePcs: 0, cartonsAvailable: 0,
        warehouseStocks: { create: { warehouseId: ids.shop, quantityPieces: stock } },
      },
    });
  await mk(ids.a, 1, 20);
  await mk(ids.b, 2, 10, 12);
  await mk(ids.c, 3, 5);
  await mk(ids.d, 4, 7);
  await mk(ids.e, 5, 9);
  await mk(ids.f, 6, 48, 12);
  await mk(ids.g, 7, 30);
  await mk(ids.h, 8, 10);
  await mk(ids.i, 9, 6);
  await mk(ids.j, 10, 4);
  await mk(ids.k, 11, 3);
  const settings = await import("../services/settings.service");
  await settings.updateSettings({ stocktakeOverageSupplierId: ids.supplier, shopWarehouseId: ids.shop } as never);
  svc = await import("../services/line-count.service");
});

after(async () => {
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


const stock = async (productId: string) =>
  (await db.productWarehouseStock.findFirst({ where: { productId, warehouseId: ids.shop } }))?.quantityPieces;

describe("line count", () => {
  let sessionId = "";
  let token = "";

  it("creates one live session per warehouse", async () => {
    const s = await svc.createLineCount(ids.admin, ids.shop);
    sessionId = s.id;
    token = s.publicToken;
    await assert.rejects(() => svc.createLineCount(ids.admin, ids.shop), /مفتوح/);
  });

  it("serves the catalogue without stock numbers", async () => {
    const p = await svc.publicGetLineCount(token);
    assert.equal(p.status, "OPEN");
    assert.ok(p.products.length >= 5);
    assert.ok(!("quantityPieces" in (p.products[0] as object)));
  });

  it("sums duplicate lines, converts cartons, and a retry is a no-op", async () => {
    const t = new Date().toISOString();
    const lines = [
      { productId: ids.a, qty: 10, unit: "PIECE" as const, writtenAt: t },
      { productId: ids.b, qty: 1, unit: "CARTON" as const, writtenAt: t }, // 12 pcs, sys 10 → +2
      { productId: ids.a, qty: 5, unit: "PIECE" as const, writtenAt: t }, // a total 15, sys 20 → -5
      { productId: ids.c, qty: 2, unit: "PIECE" as const, writtenAt: t }, // sys 5 → -3
      { productId: ids.d, qty: 7, unit: "PIECE" as const, writtenAt: t },
    ];
    const r = await svc.publicSubmitLineCount(token, lines);
    assert.equal(r.alreadySubmitted, false);
    const again = await svc.publicSubmitLineCount(token, lines);
    assert.equal(again.alreadySubmitted, true);
    const rev = await svc.getLineCountReview(sessionId);
    const by = new Map(rev.items.map((i) => [i.productId, i]));
    assert.equal(by.get(ids.a)?.countedQty, 15);
    assert.equal(by.get(ids.a)?.lines.length, 2);
    assert.equal(by.get(ids.b)?.countedQty, 12);
    assert.equal(by.get(ids.d)?.delta, 0);
    assert.equal(rev.items[rev.items.length - 1].delta, 0, "matched rows sort last");
    const uncounted = rev.uncounted.map((u) => u.productId);
    assert.ok(uncounted.includes(ids.e));
    assert.ok(![ids.a, ids.b, ids.c, ids.d].some((p) => uncounted.includes(p)));
    assert.equal(rev.lineCount, 5);
  });

  it("refuses to finalize while a variance has no decision", async () => {
    await assert.rejects(() => svc.finalizeLineCount(sessionId, ids.admin), /بلا قرار/);
  });

  it("finalize books one sale + one purchase and moves only accepted variances", async () => {
    await svc.setLineCountDecision(sessionId, "ACCEPTED");
    await svc.setLineCountDecision(sessionId, "REJECTED", ids.c);
    const r = await svc.finalizeLineCount(sessionId, ids.admin);
    assert.ok(r.saleInvoiceId && r.purchaseInvoiceId);
    const sale = await db.invoice.findUnique({ where: { id: r.saleInvoiceId! }, include: { items: true } });
    const purchase = await db.invoice.findUnique({ where: { id: r.purchaseInvoiceId! }, include: { items: true } });
    assert.equal(sale?.type, "SALE");
    assert.equal(sale?.items.length, 1);
    assert.equal(Number(sale?.totalAmount), 5000);
    assert.equal(purchase?.type, "PURCHASE");
    assert.equal(purchase?.customerId, ids.supplier);
    assert.equal(Number(purchase?.totalAmount), 1200);
    assert.equal(Number(sale?.remainingAmount), 0, "cash sale");
    assert.equal(Number(purchase?.remainingAmount), 0, "cash purchase");
    assert.equal(await stock(ids.a), 15);
    assert.equal(await stock(ids.b), 12);
    assert.equal(await stock(ids.c), 5, "rejected stays");
    assert.equal(await stock(ids.d), 7);
    assert.equal(await stock(ids.e), 9, "uncounted stays");
    await assert.rejects(() => svc.finalizeLineCount(sessionId, ids.admin), /ليست بانتظار/);
  });

  it("cancelling a sale keeps its ledger rows and adds the reversal", async () => {
    const inv = await import("../services/invoice.service");
    const walk = await (await import("../services/customer.service")).getOrCreateWalkInCustomer();
    const before = await stock(ids.d);
    const sale = await inv.createInvoice(
      { customerId: walk.id, type: "SALE" as never, discount: 0, tax: 0, paidAmount: 0,
        items: [{ productId: ids.d, unit: "PIECE" as never, quantity: 3, unitPrice: 1000 }] },
      ids.admin,
    );
    assert.equal(await stock(ids.d), before! - 3);
    await inv.cancelInvoice(sale.id);
    assert.equal(await stock(ids.d), before, "stock restored");
    const rows = await db.stockMovement.findMany({ where: { productId: ids.d, note: { startsWith: "[فاتورة #" } } });
    assert.equal(rows.filter((r) => r.type === "OUT").length, 1, "original sale row kept");
    assert.equal(rows.filter((r) => r.type === "IN").length, 1, "reversal row written");
    assert.equal(await db.stockMovement.count({ where: { invoiceId: sale.id } }), 0, "detached from invoice");
  });

  it("count invoices are tagged STOCK_COUNT and stay out of end-of-day cash", async () => {
    const counted = await db.invoice.findMany({ where: { origin: "STOCK_COUNT" } });
    assert.equal(counted.length, 2);
    const eod = await (await import("../services/report.service")).getEndOfDayReport();
    assert.ok(!eod.sales.count || eod.sales.collected < 5000, "count sale not in collected cash");
  });
});

describe("line count corrections", () => {
  let sessionId = "";
  let token = "";
  const t = () => new Date().toISOString();

  it("suggests the unit flip, applies it only on request, and resets the decision", async () => {
    const s = await svc.createLineCount(ids.admin, ids.shop);
    sessionId = s.id;
    token = s.publicToken;
    await svc.publicSubmitLineCount(token, [
      { productId: ids.f, qty: 4, unit: "PIECE", writtenAt: t() }, // meant 4 cartons = 48
      { productId: ids.g, qty: 20, unit: "PIECE", writtenAt: t() }, // sys 30
    ]);
    let f = (await svc.getLineCountReview(sessionId)).items.find((i) => i.productId === ids.f)!;
    assert.equal(f.countedQty, 4, "nothing changes on its own");
    assert.ok(f.unitSuggestion);
    assert.equal(f.unitSuggestion!.countedQty, 48);
    await svc.setLineCountDecision(sessionId, "ACCEPTED", ids.f);
    await svc.swapLineCountUnits(sessionId, ids.f, f.unitSuggestion!.lineIds, ids.admin);
    f = (await svc.getLineCountReview(sessionId)).items.find((i) => i.productId === ids.f)!;
    assert.equal(f.countedQty, 48);
    assert.equal(f.delta, 0);
    assert.equal(f.decision, "PENDING", "a changed number needs a fresh decision");
    assert.equal(f.workerCountedQty, 4);
    assert.equal(f.lines[0].originalUnit, "PIECE");
  });

  it("edits a line, sets a manager total, and keeps the worker's lines as a trace", async () => {
    let g = (await svc.getLineCountReview(sessionId)).items.find((i) => i.productId === ids.g)!;
    await svc.editLineCountLine(sessionId, g.lines[0].id, 25, "PIECE", ids.admin);
    g = (await svc.getLineCountReview(sessionId)).items.find((i) => i.productId === ids.g)!;
    assert.equal(g.countedQty, 25);
    assert.equal(g.lines[0].originalQty, 20);
    await svc.setLineCountProductTotal(sessionId, ids.g, 29, "PIECE", ids.admin);
    g = (await svc.getLineCountReview(sessionId)).items.find((i) => i.productId === ids.g)!;
    assert.equal(g.countedQty, 29);
    assert.equal(g.workerCountedQty, 20, "the worker's original total survives every edit");
    assert.equal(g.lines.filter((l) => l.deleted).length, 1);
    assert.equal(g.lines.find((l) => !l.deleted)?.source, "ADMIN");
  });

  it("recounts only the chosen products and keeps the others' decisions", async () => {
    await svc.setLineCountDecision(sessionId, "ACCEPTED", ids.f); // f is matched now — no-op
    await svc.setLineCountDecision(sessionId, "REJECTED", ids.g);
    await svc.requestLineCountRecount(sessionId, [ids.g]);
    const pub = await svc.publicGetLineCount(token);
    assert.equal(pub.status, "OPEN");
    assert.deepEqual(pub.products.map((p) => p.id), [ids.g], "only the recount products are served");
    assert.equal(pub.recountRound, 1);
    await assert.rejects(() => svc.publicSubmitLineCount(token, [{ productId: ids.f, qty: 1, unit: "PIECE", writtenAt: t() }]), /محددة/);
    await svc.publicSubmitLineCount(token, [{ productId: ids.g, qty: 30, unit: "PIECE", writtenAt: t() }]);
    const rev = await svc.getLineCountReview(sessionId);
    const g = rev.items.find((i) => i.productId === ids.g)!;
    const f = rev.items.find((i) => i.productId === ids.f)!;
    assert.equal(rev.status, "SUBMITTED");
    assert.equal(g.countedQty, 30);
    assert.equal(g.decision, "PENDING");
    assert.equal(f.countedQty, 48, "the other product is untouched");
    assert.equal((await svc.publicGetLineCount(token)).recountRound, 0, "recount mode ends on upload");
  });

  it("deleting a product's last line drops it to uncounted — its stock is never touched", async () => {
    const g = (await svc.getLineCountReview(sessionId)).items.find((i) => i.productId === ids.g)!;
    await svc.deleteLineCountLine(sessionId, g.lines.find((l) => !l.deleted)!.id, ids.admin);
    const rev = await svc.getLineCountReview(sessionId);
    assert.ok(!rev.items.some((i) => i.productId === ids.g));
    assert.ok(rev.uncounted.some((u) => u.productId === ids.g));
    await svc.cancelLineCount(sessionId);
    await assert.rejects(() => svc.editLineCountLine(sessionId, g.lines[0].id, 1, "PIECE", ids.admin), /ليست بانتظار/);
  });
});

describe("line count lock and uncounted watch", () => {
  let sessionId = "";
  let token = "";
  const t = () => new Date().toISOString();
  const take = async (productId: string, deltaPieces: number) => {
    const { adjustWarehouseStock } = await import("../services/warehouse-stock.service");
    const { prisma } = await import("../config/database");
    return prisma.$transaction((tx) => adjustWarehouseStock(tx as never, { productId, warehouseId: ids.shop, deltaPieces, allowNegative: true }));
  };

  it("freezes outflows of an undecided variance only — inflows and matched products stay open", async () => {
    const s = await svc.createLineCount(ids.admin, ids.shop);
    sessionId = s.id;
    token = s.publicToken;
    await svc.publicSubmitLineCount(token, [
      { productId: ids.h, qty: 7, unit: "PIECE", writtenAt: t() },
      { productId: ids.i, qty: 6, unit: "PIECE", writtenAt: t() },
    ]);
    await assert.rejects(() => take(ids.h, -1), /بالجرد/);
    await take(ids.h, 1); // a purchase still lands
    await take(ids.i, -1); // matched — nothing to decide
  });

  it("«أكيد خلصانة» counts an uncounted product as zero, pending and frozen", async () => {
    assert.ok((await svc.getLineCountReview(sessionId)).uncounted.some((u) => u.productId === ids.j));
    await svc.markLineCountGone(sessionId, [ids.j], ids.admin);
    const j = (await svc.getLineCountReview(sessionId)).items.find((it) => it.productId === ids.j)!;
    assert.equal(j.countedQty, 0);
    assert.equal(j.systemQty, 4);
    assert.equal(j.decision, "PENDING");
    assert.equal(await stock(ids.j), 4, "nothing booked before acceptance");
    await assert.rejects(() => take(ids.j, -1), /بالجرد/);
    await assert.rejects(() => svc.markLineCountGone(sessionId, [ids.j], ids.admin), /محسوبة/);
  });

  it("an uncounted product can be sent back for counting, and the freeze holds meanwhile", async () => {
    await svc.requestLineCountRecount(sessionId, [ids.k]);
    assert.deepEqual((await svc.publicGetLineCount(token)).products.map((p) => p.id), [ids.k]);
    await assert.rejects(() => take(ids.h, -1), /بالجرد/, "still frozen while the worker recounts");
    await svc.publicSubmitLineCount(token, [{ productId: ids.k, qty: 3, unit: "PIECE", writtenAt: t() }]);
    assert.ok((await svc.getLineCountReview(sessionId)).items.some((it) => it.productId === ids.k));
  });

  it("deciding unfreezes at once; finalize watches every product nobody counted", async () => {
    await svc.setLineCountDecision(sessionId, "REJECTED", ids.h);
    await take(ids.h, -1);
    await svc.setLineCountDecision(sessionId, "ACCEPTED");
    await svc.finalizeLineCount(sessionId, ids.admin);
    assert.equal(await stock(ids.j), 0, "accepted zero is booked");
    const watched = await db.lineCountWatch.findMany({ where: { sessionId } });
    const wset = new Set(watched.map((w) => w.productId));
    assert.ok(wset.has(ids.e), "uncounted product is watched");
    for (const pid of [ids.h, ids.i, ids.j, ids.k]) assert.ok(!wset.has(pid), "counted products are not watched");
  });

  it("the watch list waits two months and drops anything counted since", async () => {
    assert.ok(!(await svc.listLineCountWatch(60)).data.some((w) => w.productId === ids.e), "too fresh");
    await db.lineCountWatch.updateMany({ data: { countedAt: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000) } });
    const list = (await svc.listLineCountWatch(60)).data;
    const e = list.find((w) => w.productId === ids.e);
    assert.ok(e, "never counted, never sold → listed even with stock");
    assert.equal(e!.stock, 9);
    assert.equal(e!.times, 2, "missed by both finalized counts");
    assert.ok(!list.some((w) => w.productId === ids.a), "counted by a later session → cleared");
  });
});

describe("line count never loses the worker's count", () => {
  const t = () => new Date().toISOString();

  it("a stalled recount can be cancelled back to review with everything intact", async () => {
    const s = await svc.createLineCount(ids.admin, ids.shop);
    await svc.publicSubmitLineCount(s.publicToken, [
      { productId: ids.h, qty: 2, unit: "PIECE", writtenAt: t() },
      { productId: ids.i, qty: 3, unit: "PIECE", writtenAt: t() },
    ]);
    await svc.setLineCountDecision(s.id, "REJECTED", ids.i);
    const before = await db.lineCountSession.findUniqueOrThrow({ where: { id: s.id } });
    await svc.requestLineCountRecount(s.id, [ids.h]);
    await assert.rejects(() => svc.setLineCountDecision(s.id, "ACCEPTED", ids.h), /ليست بانتظار/);
    await svc.cancelLineCountRecount(s.id);
    const rev = await svc.getLineCountReview(s.id);
    assert.equal(rev.status, "SUBMITTED");
    assert.deepEqual(rev.recountProductIds, []);
    assert.equal(rev.items.find((x) => x.productId === ids.h)?.countedQty, 2);
    assert.equal(rev.items.find((x) => x.productId === ids.i)?.decision, "REJECTED", "decisions survive");
    assert.equal(rev.submittedAt?.getTime(), before.submittedAt?.getTime(), "upload time is kept");
    await assert.rejects(() => svc.cancelLineCountRecount(s.id), /ماكو إعادة عدّ/);

    // Sent back whole: the link carries the saved lines for any device.
    await svc.reopenLineCount(s.id);
    const pub = await svc.publicGetLineCount(s.publicToken);
    assert.deepEqual(pub.lines.map((l) => [l.productId, l.qty]), [[ids.h, 2], [ids.i, 3]]);
    await svc.cancelLineCount(s.id);
    assert.deepEqual((await svc.publicGetLineCount(s.publicToken)).lines, [], "a closed link exposes nothing");
  });
});

describe("line count freeze and invoice edits", () => {
  const t = () => new Date().toISOString();

  it("re-pricing a purchase of a frozen product passes; cutting its quantity does not", async () => {
    const inv = await import("../services/invoice.service");
    const s = await svc.createLineCount(ids.admin, ids.shop);
    const purchase = await inv.createInvoice(
      {
        customerId: ids.supplier, type: "PURCHASE" as never, discount: 0, tax: 0, paidAmount: 0,
        paymentType: "CREDIT" as never, branchId: ids.shop,
        items: [{ productId: ids.f, quantity: 24, unitPrice: 500, warehouseId: ids.shop, unit: "PIECE" as never }],
      },
      ids.admin,
    );
    await svc.publicSubmitLineCount(s.publicToken, [{ productId: ids.f, qty: 1, unit: "PIECE", writtenAt: t() }]);
    const edit = (quantity: number, unitPrice: number) =>
      inv.updateInvoice(purchase.id, {
        customerId: ids.supplier, type: "PURCHASE" as never, discount: 0, tax: 0, paidAmount: 0,
        paymentType: "CREDIT" as never, branchId: ids.shop,
        items: [{ productId: ids.f, quantity, unitPrice, warehouseId: ids.shop, unit: "PIECE" as never }],
      }, ids.admin);
    const before = await stock(ids.f);
    await edit(24, 650); // new customs price, same quantity
    assert.equal(await stock(ids.f), before, "same quantity — stock unchanged");
    await assert.rejects(() => edit(20, 650), /بالجرد/, "a net decrease of a frozen product is still refused");
    assert.equal(await stock(ids.f), before);
    await svc.cancelLineCount(s.id);
  });
});
