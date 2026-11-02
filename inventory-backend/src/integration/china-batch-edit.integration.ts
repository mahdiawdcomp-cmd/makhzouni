/**
 * «تعديل دفعة الصين» against a REAL throwaway PostgreSQL database.
 * Run: npm run test:integration
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/* ── provisioning ─────────────────────────────────────────────────────── */

const SUFFIX = "_chinaedit_integration_test";

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
let svc: typeof import("../services/china-batch-edit.service");


const ids = {
  admin: randomUUID(),
  shop: randomUUID(),
  supplier: randomUUID(),
  a: randomUUID(),
  b: randomUUID(),
};
let batchId = "";

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
  const mk = (id: string, n: number) =>
    db.product.create({
      data: {
        id, itemNumber: `CN-${n}`, qrCode: `CN-QR-${n}-${Date.now()}`, createdBy: ids.admin,
        name: `مادة صين ${n}`, salePrice: 5000, purchasePrice: 1000, costPrice: 1000, pcsPerCarton: 12,
        openingBalancePcs: 0, cartonsAvailable: 0,
        warehouseStocks: { create: { warehouseId: ids.shop, quantityPieces: 0 } },
      },
    });
  await mk(ids.a, 1);
  await mk(ids.b, 2);
  const settings = await import("../services/settings.service");
  await settings.updateSettings({ shopWarehouseId: ids.shop } as never);
  svc = await import("../services/china-batch-edit.service");
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

const params = { cbmPriceUsd: 100, officePercent: 5, cnyPerUsd: 7, usdToIqd: 1500 };

async function sheet(rows: Array<Array<string | number>>, picture?: Buffer) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("تسعيرة الصين");
  ws.addRow(["رقم المادة", "الصورة", "عدد الكراتين", "قطع الكارتون", "سعر القطعة يوان", "حجم الكارتون", "اسم المادة", "سعر البيع"]);
  for (const r of rows) ws.addRow(r);
  if (picture) ws.addImage(wb.addImage({ buffer: picture as never, extension: "png" }), { tl: { col: 1, row: 1 }, ext: { width: 40, height: 40 } });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("China batch edit", () => {
  it("first upload reads the pictures embedded in the sheet", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 30, height: 30, channels: 3, background: { r: 200, g: 20, b: 20 } } }).png().toBuffer();
    const parsed = await svc.parseChinaOrderWithImages(await sheet([["CN-1", "", 2, 12, 10, 0.2], ["CN-2", "", 1, 12, 20, 0.3]], png));
    assert.equal(parsed.length, 2);
    assert.ok(parsed[0].picture?.dataUrl.startsWith("data:image/jpeg;base64,"), "picture on the first data row");
    assert.equal(parsed[1].picture, null);
  });

  it("an applied batch is edited from a sheet and the SAME invoice follows", async () => {
    const pricing = await import("../services/china-order-pricing.service");
    const landed = await import("../services/landed-cost-import.service");
    const priced = await pricing.computeChinaPricing(
      [
        { itemNumber: "CN-1", image: "", cartonCount: 2, piecesPerCarton: 12, unitPriceCny: 10, cartonCbm: 0.2 },
        { itemNumber: "CN-2", image: "", cartonCount: 1, piecesPerCarton: 12, unitPriceCny: 20, cartonCbm: 0.3 },
      ],
      params,
    );
    const batch = await pricing.createChinaBatch({ params, items: priced.items }, ids.admin);
    batchId = batch.id;
    for (const it of batch.items) {
      await landed.setItemDecision(batchId, it.id, { action: "LINK_EXISTING" as never, productId: it.productId!, confirmedSalePrice: 5000 } as never);
    }
    const confirm = await landed.finalConfirmBatch(batchId, { supplierCustomerId: ids.supplier, warehouseId: ids.shop }, ids.admin);
    assert.equal(await stock(ids.a), 24);
    const invoiceId = confirm.purchaseInvoiceId;

    // Round trip with no edits: nothing to save.
    const exported = await svc.exportChinaBatchExcel(batchId);
    const clean = await svc.previewChinaBatchFile(batchId, exported.buffer);
    assert.equal(clean.rows.length, 0, "an untouched export compares clean");
    assert.deepEqual(clean.unmatched, []);

    // Rename, re-price and change what arrived for CN-1.
    const edited = await sheet([["CN-1", "", 3, 12, 10, 0.2, "اسم صحيح", 6500], ["CN-2", "", 1, 12, 20, 0.3, "مادة صين 2", 5000]]);
    const preview = await svc.previewChinaBatchFile(batchId, edited);
    assert.equal(preview.rows.length, 1);
    assert.deepEqual(preview.rows[0].changes.sort(), ["الاسم", "الكراتين", "سعر البيع"].sort());
    assert.ok(preview.rows[0].warnings.some((w) => w.includes("الكمية")));
    assert.equal(await stock(ids.a), 24, "preview saves nothing");

    const result = await svc.applyChinaBatchFile(batchId, edited, ids.admin);
    assert.equal(result.purchaseInvoiceId, invoiceId, "same invoice");
    assert.equal(await stock(ids.a), 36, "3 cartons now");
    const product = await db.product.findUniqueOrThrow({ where: { id: ids.a } });
    assert.equal(product.name, "اسم صحيح");
    assert.equal(Number(product.salePrice), 6500);
    const line = await db.invoiceItem.findFirstOrThrow({ where: { invoiceId, productId: ids.a } });
    assert.equal(line.quantity, 36);
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(Number(invoice.totalAmount), result.newInvoiceTotal);
  });

  it("one row edited on screen, picture included", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toBuffer();
    const item = await db.landedCostImportItem.findFirstOrThrow({ where: { batchId, productId: ids.b } });
    await svc.applyChinaBatchEdits(batchId, [{ itemId: item.id, salePrice: 7000, imageUrl: `data:image/png;base64,${png.toString("base64")}` }], ids.admin);
    const product = await db.product.findUniqueOrThrow({ where: { id: ids.b } });
    assert.equal(Number(product.salePrice), 7000);
    assert.ok(product.imageUrl?.startsWith("data:image/png"));
    assert.ok(product.thumbnailUrl, "thumbnail made");
    // The exported sheet now carries that picture, and comparing it back is clean.
    const exported = await svc.exportChinaBatchExcel(batchId);
    assert.equal((await svc.previewChinaBatchFile(batchId, exported.buffer)).rows.length, 0);
  });
});
