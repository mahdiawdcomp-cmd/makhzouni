/**
 * Proves the offers EXCLUDE constraint on a THROWAWAY database.
 *
 *   node scripts/check-offer-overlap-constraint.mjs
 *
 * Creates `<db>_constraint_check`, applies every migration, then exercises the
 * six cases the rule has to get right, and drops the database again. Refuses to
 * run against anything that is not a local database, and never prints the
 * connection string.
 *
 * This is a developer check, not part of any test suite: it wants a real
 * Postgres with permission to CREATE DATABASE and CREATE EXTENSION.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const source = new URL(raw);
if (!["localhost", "127.0.0.1", "::1"].includes(source.hostname.toLowerCase())) {
  console.error(`Refusing to run against host "${source.hostname}". Local databases only.`);
  process.exit(1);
}
if (/railway|neon|rds\.amazonaws|supabase|render|prod/i.test(raw)) {
  console.error("DATABASE_URL looks like a hosted database. Refusing.");
  process.exit(1);
}

const name = `${decodeURIComponent(source.pathname.replace(/^\/+/, ""))}_constraint_check`;
const adminUrl = new URL(source.toString());
adminUrl.pathname = "/postgres";
const testUrl = new URL(source.toString());
testUrl.pathname = `/${name}`;

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

const results = [];
const record = (label, pass, detail = "") => {
  results.push({ label, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/** Insert straight into the table: this tests the CONSTRAINT, not the service. */
function insertSql(id, start, end, active = true, unit = "CARTON", mode = "WHOLESALE") {
  return `
    INSERT INTO "sales_agent_customer_offers"
      ("id","customer_id","product_id","unit","price_mode","discount_type","fixed_price",
       "starts_at","ends_at","is_active","created_by","created_at","updated_at")
    VALUES ('${id}'::uuid,'${CUSTOMER}'::uuid,'${PRODUCT}'::uuid,'${unit}','${mode}','AMOUNT',1000,
       '${start}'::timestamp,'${end}'::timestamp,${active},'${USER}'::uuid,NOW(),NOW())`;
}

const isOverlapError = (err) =>
  err?.meta?.code === "23P01" ||
  err?.code === "23P01" ||
  /23P01|sales_agent_offers_no_overlap|exclusion constraint/i.test(String(err?.message ?? ""));

(async () => {
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  await admin.$disconnect();

  const deploy = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    encoding: "utf8",
    shell: true,
  });
  record("every migration applies from scratch", deploy.status === 0, deploy.status === 0 ? "" : deploy.stderr?.slice(0, 300));

  const db = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  try {
    const ext = await db.$queryRawUnsafe(`SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`);
    record("btree_gist is installed by the migration", ext.length === 1);

    const con = await db.$queryRawUnsafe(
      `SELECT conname, contype FROM pg_constraint WHERE conname = 'sales_agent_offers_no_overlap'`,
    );
    record("the exclusion constraint exists", con.length === 1 && con[0].contype === "x");

    // The rows reference real customers/products/users through FKs.
    await db.$executeRawUnsafe(
      `INSERT INTO "users" ("id","name","username","password_hash","role","created_at","updated_at")
       VALUES ('${USER}'::uuid,'check','check_${Date.now()}','x','ADMIN',NOW(),NOW())`,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "customers" ("id","name","phone","created_at","updated_at")
       VALUES ('${CUSTOMER}'::uuid,'زبون فحص','0770${Date.now() % 10000000}',NOW(),NOW())`,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "products"
        ("id","item_number","qr_code","name","purchase_price","sale_price","retail_price","cost_price",
         "pcs_per_carton","opening_balance_pcs","cartons_available","min_stock","created_by","created_at","updated_at")
       VALUES ('${PRODUCT}'::uuid,'CHK-${Date.now() % 100000}','QR-${Date.now()}','مادة فحص',600,1000,1200,600,
         48,0,0,0,'${USER}'::uuid,NOW(),NOW())`,
    );

    const id = (n) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;

    // 1. the first offer
    await db.$executeRawUnsafe(insertSql(id(1), "2026-09-20T00:00:00", "2026-09-26T00:00:00"));
    record("a first active offer inserts", true);

    // 2. an overlapping active offer
    let overlapRejected = false;
    try {
      await db.$executeRawUnsafe(insertSql(id(2), "2026-09-25T00:00:00", "2026-09-30T00:00:00"));
    } catch (err) {
      overlapRejected = isOverlapError(err);
    }
    record("two overlapping ACTIVE offers are refused", overlapRejected);

    // 3. adjacent, touching but not overlapping: [20,26) then [26,30)
    let adjacentOk = true;
    try {
      await db.$executeRawUnsafe(insertSql(id(3), "2026-09-26T00:00:00", "2026-09-30T00:00:00"));
    } catch {
      adjacentOk = false;
    }
    record("adjacent windows that only touch are allowed", adjacentOk);

    // 4. a finished offer and a brand new one
    let afterEndOk = true;
    try {
      await db.$executeRawUnsafe(insertSql(id(4), "2026-10-01T00:00:00", "2026-10-05T00:00:00"));
    } catch {
      afterEndOk = false;
    }
    record("a new offer after the old one ended is allowed", afterEndOk);

    // 5. a paused offer may overlap a live one
    let pausedOk = true;
    try {
      await db.$executeRawUnsafe(insertSql(id(5), "2026-09-21T00:00:00", "2026-09-23T00:00:00", false));
    } catch {
      pausedOk = false;
    }
    record("a PAUSED offer may overlap a live one", pausedOk);

    // 6. …and resuming it is refused
    let resumeRejected = false;
    try {
      await db.$executeRawUnsafe(
        `UPDATE "sales_agent_customer_offers" SET "is_active" = true WHERE "id" = '${id(5)}'::uuid`,
      );
    } catch (err) {
      resumeRejected = isOverlapError(err);
    }
    record("resuming a paused offer that overlaps a live one is refused", resumeRejected);

    // 7. two genuinely concurrent inserts into a free window
    const concurrent = await Promise.allSettled([
      db.$executeRawUnsafe(insertSql(id(6), "2026-11-01T00:00:00", "2026-11-10T00:00:00")),
      db.$executeRawUnsafe(insertSql(id(7), "2026-11-05T00:00:00", "2026-11-15T00:00:00")),
    ]);
    const won = concurrent.filter((r) => r.status === "fulfilled").length;
    record("exactly one of two concurrent overlapping inserts wins", won === 1, `${won} succeeded`);
  } finally {
    await db.$disconnect();
    const admin2 = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
    await admin2.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`,
    );
    await admin2.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`);
    await admin2.$disconnect();
    console.log(`\ndropped ${name}`);
    const failed = results.filter((r) => !r.pass);
    console.log(`${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length === 0 ? 0 : 1);
  }
})();
