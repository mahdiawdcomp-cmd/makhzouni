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
    assert.deepEqual(rev.uncounted.map((u) => u.productId), [ids.e]);
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
});
