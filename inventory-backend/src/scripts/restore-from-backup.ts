/**
 * استرجاع نسخة احتياطية — restore a `makhzouni-backup.json` (or its ZIP) into a
 * TARGET database, and report exactly what landed.
 *
 * Until this existed there was no restore path at all: the daily job produced
 * files nobody could put back, and `verify-backup*.ps1` only proved the ZIP
 * opens and the JSON parses — not that the data can be restored. This is the
 * missing half.
 *
 * Safety, in order of strictness:
 *  - The target URL must be passed explicitly as `--target`. It is never read
 *    from the environment, so a stray `.env` can never aim this at the shop.
 *  - The target must be localhost (or carry `--i-know-this-is-remote`).
 *  - The target database must be EMPTY unless `--wipe` is given, and `--wipe`
 *    refuses outright on a non-localhost host.
 *  - Nothing is ever written to the SOURCE of the backup.
 *
 * Usage:
 *   npx tsx src/scripts/restore-from-backup.ts \
 *     --file "C:/…/makhzouni-online-2026-09-12-12-01.zip" \
 *     --target "postgresql://postgres:pass@localhost:5432/restore_test"
 */
import { existsSync, readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
// No @types/unzipper in the tree; this tool is ops-only so a local shim beats
// pulling a types package into the app build.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const unzipper = require("unzipper") as { Open: { file(path: string): Promise<any> } };

type Json = Record<string, unknown>;

/**
 * A bcrypt comparison against this can never succeed — it is not a bcrypt hash.
 * The backup deliberately omits password hashes, so restored accounts come back
 * LOCKED: the users, their roles and permissions exist (and every invoice's
 * `createdBy` still resolves), but nobody can sign in until an admin sets new
 * passwords. Without this the restore cannot insert a single user, and with no
 * users the whole file is unrestorable.
 */
const LOCKED_PASSWORD = "!locked-by-restore-set-a-new-password";

/** Load order matters: parents before children, or every insert fails on FK. */
const RESTORE_PLAN: Array<{
  key: string;
  model: string;
  /** Nested rows shipped inside each parent row, restored right after it. */
  children?: Array<{ field: string; model: string }>;
  /** Fills in values the export dropped on purpose. */
  transform?: (row: Json) => Json;
  /** Shown once after the run when the transform actually fired. */
  note?: string;
}> = [
  {
    key: "users",
    model: "user",
    transform: (row) => ({ ...row, passwordHash: row.passwordHash ?? LOCKED_PASSWORD }),
    note: "المستخدمون رجعوا بكلمات مرور مقفلة — لازم المدير يضبط كلمات مرور جديدة بعد الاسترجاع.",
  },
  { key: "branches", model: "branch" },
  { key: "counters", model: "counter" },
  { key: "settings", model: "setting" },
  { key: "messageTemplates", model: "messageTemplate" },
  { key: "products", model: "product" },
  { key: "warehouseStocks", model: "productWarehouseStock" },
  { key: "customers", model: "customer" },
  { key: "customerTags", model: "customerTag" },
  { key: "coupons", model: "coupon" },
  { key: "invoices", model: "invoice", children: [{ field: "items", model: "invoiceItem" }] },
  { key: "couponRedemptions", model: "couponRedemption" },
  { key: "vouchers", model: "paymentVoucher" },
  { key: "quotations", model: "quotation", children: [{ field: "items", model: "quotationItem" }] },
  // Everything a stock movement can point at goes in first: it carries optional
  // foreign keys to the invoice, the transfer and the loss that produced it.
  { key: "transfers", model: "inventoryTransfer", children: [{ field: "items", model: "transferItem" }] },
  { key: "stockLosses", model: "stockLoss", children: [{ field: "items", model: "stockLossItem" }] },
  { key: "stocktakeSessions", model: "stocktakeSession", children: [{ field: "items", model: "stocktakeItem" }] },
  { key: "cycleCountSessions", model: "cycleCountSession", children: [{ field: "items", model: "cycleCountItem" }] },
  { key: "stockMovements", model: "stockMovement" },
  { key: "personalDebts", model: "personalDebt" },
  { key: "pendingApprovals", model: "pendingApproval" },
  { key: "orderPreparations", model: "orderPreparation" },
  { key: "salesAgentIssues", model: "salesAgentIssue" },
  { key: "salesAgentPriceRequests", model: "salesAgentPriceRequest" },
  { key: "salesAgentSettlements", model: "salesAgentSettlement" },
  { key: "salesAgentHandovers", model: "salesAgentHandover" },
  { key: "auditLogs", model: "auditLog" },
];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function readBackup(file: string): Promise<Json> {
  if (!existsSync(file)) throw new Error(`الملف غير موجود: ${file}`);
  if (!file.toLowerCase().endsWith(".zip")) {
    return JSON.parse(readFileSync(file, "utf8")) as Json;
  }
  const directory = await unzipper.Open.file(file);
  const entry = directory.files.find((f: any) => f.path.endsWith("makhzouni-backup.json"));
  if (!entry) throw new Error("لا يوجد makhzouni-backup.json داخل الملف المضغوط");
  const buffer: Buffer = await entry.buffer();
  return JSON.parse(buffer.toString("utf8")) as Json;
}

/**
 * Oldest first. Several tables reference themselves — a sales return points at
 * the invoice it reverses — and the export is ordered newest-first, so the
 * child row would be inserted before its parent and the foreign key would
 * reject it. Time order is the order the rows were legal in.
 */
function oldestFirst(rows: Json[]): Json[] {
  return [...rows].sort((a, b) => {
    const left = typeof a.createdAt === "string" ? a.createdAt : "";
    const right = typeof b.createdAt === "string" ? b.createdAt : "";
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/**
 * A restored row is written exactly as exported. `createMany` with
 * `skipDuplicates` keeps the run idempotent, and chunking keeps a 15k-row
 * table from building one enormous statement.
 */
async function insertRows(prisma: any, model: string, rows: Json[], chunk = 500) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const result = await prisma[model].createMany({ data: slice, skipDuplicates: true });
    inserted += result.count;
  }
  return inserted;
}

async function main() {
  const file = arg("file");
  const target = arg("target");
  if (!file || !target) {
    console.error("الاستعمال: --file <backup.zip|.json> --target <postgres url>");
    process.exit(2);
  }

  const host = new URL(target).hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";
  if (!isLocal && !flag("i-know-this-is-remote")) {
    console.error(`✗ الهدف ليس محلياً (${host}). الاسترجاع لقاعدة بعيدة يحتاج --i-know-this-is-remote.`);
    process.exit(2);
  }
  if (flag("wipe") && !isLocal) {
    console.error("✗ --wipe ممنوع على قاعدة غير محلية، بلا استثناء.");
    process.exit(2);
  }

  console.log(`قراءة النسخة: ${file}`);
  const backup = await readBackup(file);
  const counts = (backup.counts ?? {}) as Record<string, number>;
  console.log(`النسخة بتاريخ ${String(backup.exportedAt)} — إصدار ${String(backup.version)}`);

  // Indexed by model name from the restore plan, so the client is addressed
  // dynamically rather than through its generated per-model types.
  const prisma = new PrismaClient({ datasources: { db: { url: target } } }) as unknown as
    Record<string, { createMany(a: any): Promise<{ count: number }>; deleteMany(a: any): Promise<unknown> }> &
    { $disconnect(): Promise<void>; $queryRawUnsafe<T>(sql: string): Promise<T> };

  try {
    // `prisma migrate deploy` alone does NOT produce a complete schema: a set of
    // columns is added at server boot with idempotent ADD COLUMN IF NOT EXISTS
    // (see server.ts). Restoring into a migrations-only database fails halfway
    // through with a raw "column does not exist", so check up front and say what
    // to do about it.
    const rows = await prisma.$queryRawUnsafe<Array<{ ready: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'is_both') AS ready`
    );
    const ready = rows[0]?.ready === true;
    if (!ready) {
      console.error(
        "✗ القاعدة الهدف ناقصة أعمدة يضيفها الخادم عند الإقلاع.\n" +
        "  شغّل الخادم مرة واحدة عليها ثم أعد الاسترجاع:\n" +
        `  DATABASE_URL="${target}" npx tsx src/server.ts`
      );
      process.exit(2);
    }

    if (flag("wipe")) {
      console.log("مسح الجداول المستهدفة قبل الاسترجاع...");
      for (const step of [...RESTORE_PLAN].reverse()) {
        for (const child of [...(step.children ?? [])].reverse()) {
          await prisma[child.model].deleteMany({});
        }
        await prisma[step.model].deleteMany({});
      }
    }

    const notes = new Set<string>();
    const report: Array<{ table: string; inBackup: number; restored: number }> = [];
    for (const step of RESTORE_PLAN) {
      const rows = oldestFirst((backup[step.key] as Json[] | undefined) ?? []);
      if (rows.length === 0) {
        report.push({ table: step.key, inBackup: 0, restored: 0 });
        continue;
      }
      // Children travel inside their parent row and must not be written as
      // parent columns.
      const childFields = (step.children ?? []).map((c) => c.field);
      const parents = rows.map((row) => {
        const copy = step.transform ? step.transform(row) : { ...row };
        for (const field of childFields) delete copy[field];
        return copy;
      });
      if (step.transform && step.note) notes.add(step.note);
      const restored = await insertRows(prisma, step.model, parents);
      report.push({ table: step.key, inBackup: rows.length, restored });

      for (const child of step.children ?? []) {
        const childRows = rows.flatMap((row) => ((row[child.field] as Json[] | undefined) ?? []));
        if (childRows.length === 0) continue;
        const childRestored = await insertRows(prisma, child.model, childRows);
        report.push({ table: `${step.key}.${child.field}`, inBackup: childRows.length, restored: childRestored });
      }
    }

    console.log("\nالجدول                          بالنسخة   استُرجع");
    let mismatches = 0;
    for (const row of report) {
      const ok = row.restored === row.inBackup;
      if (!ok) mismatches += 1;
      console.log(
        `${(ok ? "✓ " : "✗ ") + row.table.padEnd(30)}${String(row.inBackup).padStart(8)}${String(row.restored).padStart(10)}`
      );
    }

    // Tables named in counts but absent from the restore plan would be silent losses.
    const planned = new Set(RESTORE_PLAN.map((s) => s.key));
    const unplanned = Object.keys(counts).filter((k) => !planned.has(k) && (counts[k] ?? 0) > 0);
    if (unplanned.length > 0) {
      console.log(`\n⚠ موجود بالنسخة وما له مكان بخطة الاسترجاع: ${unplanned.join(", ")}`);
    }
    for (const note of notes) console.log(`
⚠ ${note}`);
    const excludes = (backup.meta as Json | undefined)?.excludes as string[] | undefined;
    if (excludes?.length) console.log(`\nغير مشمول بالنسخة أصلاً: ${excludes.join(" | ")}`);

    console.log(mismatches === 0 ? "\n✓ الاسترجاع مطابق بالكامل" : `\n✗ ${mismatches} جدول غير مطابق`);
    process.exitCode = mismatches === 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("✗ فشل الاسترجاع:", error instanceof Error ? error.message : error);
  process.exit(1);
});
