/**
 * The settings cache: fewer reads, never a wrong answer.
 *
 * getSettings() used to read the whole settings table on nearly every request.
 * These tests pin the three things the cache must never get wrong:
 *   - a write made through this code is visible on the very next read;
 *   - one caller changing the object it got back cannot change what the next
 *     caller gets;
 *   - a read that was already running when a write landed is never stored.
 */
import { before, beforeEach, test, mock } from "node:test";
import assert from "node:assert/strict";

// A settings table in memory, and a counter of how often it is read.
let rows: Array<{ key: string; value: unknown }> = [];
let reads = 0;
let readDelay: Promise<void> | null = null;

mock.module("../config/database", {
  exports: {
    default: {
      setting: {
        findMany: async () => {
          reads += 1;
          const snapshot = rows.map((r) => ({ ...r }));
          if (readDelay) await readDelay;
          return snapshot;
        },
        upsert: async ({ where, create, update }: { where: { key: string }; create: { key: string; value: unknown }; update: { value: unknown } }) => {
          const found = rows.find((r) => r.key === where.key);
          if (found) found.value = update.value;
          else rows.push({ key: create.key, value: create.value });
          return {};
        },
      },
      $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
    },
  },
});
mock.module("./whatsapp.service", {
  exports: { syncWhatsAppSettings: () => {}, generateVerifyToken: () => "token" },
});

let service: typeof import("./settings.service");

before(async () => {
  service = await import("./settings.service");
});

beforeEach(() => {
  rows = [{ key: "storeName", value: "محل الفحص" }];
  reads = 0;
  readDelay = null;
  service.__setSettingsCacheEnabledForTests(true);
});

test("a second read inside the TTL does not touch the database", async () => {
  await service.getSettings();
  await service.getSettings();
  assert.equal(reads, 1);
});

test("a write through updateSettings is visible on the very next read", async () => {
  assert.equal((await service.getSettings()).storeName, "محل الفحص");
  await service.updateSettings({ storeName: "الاسم الجديد" });
  assert.equal((await service.getSettings()).storeName, "الاسم الجديد");
});

test("a write by another service is visible once it invalidates", async () => {
  await service.getSettings();
  rows.find((r) => r.key === "storeName")!.value = "كتبها غيري";
  // Still the cached value — the other writer has not said anything yet.
  assert.equal((await service.getSettings()).storeName, "محل الفحص");
  service.invalidateSettingsCache();
  assert.equal((await service.getSettings()).storeName, "كتبها غيري");
});

test("changing the returned object cannot leak into the next caller", async () => {
  const first = await service.getSettings();
  (first as { storeName: string }).storeName = "عدّلها المتصل";
  assert.equal((await service.getSettings()).storeName, "محل الفحص");
});

test("callers arriving together on a cold cache share ONE read", async () => {
  await Promise.all(Array.from({ length: 20 }, () => service.getSettings()));
  assert.equal(reads, 1);
});

test("a read already running when a write lands is never stored", async () => {
  let release!: () => void;
  readDelay = new Promise((r) => { release = r; });
  // This read snapshots the OLD row, then waits.
  const slow = service.getSettings();
  // The write lands while that read is still in flight.
  rows.find((r) => r.key === "storeName")!.value = "بعد الكتابة";
  service.invalidateSettingsCache();
  readDelay = null;
  release();
  assert.equal((await slow).storeName, "محل الفحص", "the slow caller gets what it read");
  // …but the next caller must not be handed that stale value from the cache.
  assert.equal((await service.getSettings()).storeName, "بعد الكتابة");
});

test("every file that writes a setting also clears the cache", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join, relative } = await import("node:path");
  const root = join(__dirname, "..");
  // Writers of keys that start with «_» only: getSettings() skips those rows,
  // so they can never make the cache wrong. A separate-process script cannot
  // reach this process's cache at all; the TTL covers it.
  const exempt = new Set([
    "services/whatsapp.service.ts",       // _personalChannelCounter
    "services/backup-status.service.ts",  // _backupStatus
    "scripts/restore-from-backup.ts",     // runs as its own process
  ]);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
      const rel = relative(root, full).split("\\").join("/");
      const src = readFileSync(full, "utf8");
      const writes = /\.setting\.(upsert|update|updateMany|create|createMany|delete|deleteMany)\(/.test(src);
      if (writes && !exempt.has(rel) && !src.includes("invalidateSettingsCache")) offenders.push(rel);
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], `these write settings without clearing the cache: ${offenders.join(", ")}`);
});
