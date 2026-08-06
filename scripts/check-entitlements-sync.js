#!/usr/bin/env node
/**
 * Cross-checks the three hand-maintained copies of the SaaS feature-key list:
 *   - saas-admin-api/src/entitlements.ts   (source of truth — what the API validates/stores)
 *   - saas-admin-web/src/entitlements.ts   (Super Admin UI grouping/labels)
 *   - inventory-backend/src/utils/entitlements-consistency.test.ts (gating contract test)
 *
 * There is no shared package between these three separately-deployed services,
 * so nothing stops them drifting silently — a key added to one and forgotten
 * in another means gating either blocks everything or allows everything for
 * that feature, invisibly, until a customer complains.
 *
 * This script is NOT wired into any build or deploy step (none of the three
 * projects can import across service boundaries at build time). Run it by
 * hand after touching any of the three files:
 *   node scripts/check-entitlements-sync.js
 * Exits non-zero and prints the exact diff if the three sets disagree.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function readFile(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) {
    throw new Error(`Expected file not found: ${relPath}`);
  }
  return fs.readFileSync(full, "utf8");
}

function extractApiKeys(source) {
  const match = source.match(/export const FEATURE_GROUPS = \{([\s\S]*?)\} as const;/);
  if (!match) throw new Error("saas-admin-api/src/entitlements.ts: FEATURE_GROUPS block not found — file shape changed, update this script.");
  const body = match[1];
  return new Set([...body.matchAll(/"([a-zA-Z][a-zA-Z0-9]*)"/g)].map((m) => m[1]));
}

function extractWebKeys(source) {
  const match = source.match(/export const FEATURE_GROUPS: FeatureGroup\[\] = \[([\s\S]*?)\n\];/);
  if (!match) throw new Error("saas-admin-web/src/entitlements.ts: FEATURE_GROUPS block not found — file shape changed, update this script.");
  const body = match[1];
  const keys = new Set();
  for (const itemsMatch of body.matchAll(/items:\s*\[([\s\S]*?)\],\n(\s*)\},/g)) {
    for (const keyMatch of itemsMatch[1].matchAll(/key:\s*"([a-zA-Z][a-zA-Z0-9]*)"/g)) {
      keys.add(keyMatch[1]);
    }
  }
  return keys;
}

function extractBackendTestKeys(source) {
  const match = source.match(/const SUPER_ADMIN_FEATURE_KEYS = new Set\(\[([\s\S]*?)\]\);/);
  if (!match) throw new Error("inventory-backend entitlements-consistency.test.ts: SUPER_ADMIN_FEATURE_KEYS block not found — file shape changed, update this script.");
  return new Set([...match[1].matchAll(/"([a-zA-Z][a-zA-Z0-9]*)"/g)].map((m) => m[1]));
}

function diff(setA, setB) {
  return [...setA].filter((k) => !setB.has(k));
}

function main() {
  const api = extractApiKeys(readFile("saas-admin-api/src/entitlements.ts"));
  const web = extractWebKeys(readFile("saas-admin-web/src/entitlements.ts"));
  const backendTest = extractBackendTestKeys(readFile("inventory-backend/src/utils/entitlements-consistency.test.ts"));

  const pairs = [
    ["saas-admin-api (source of truth)", api, "saas-admin-web", web],
    ["saas-admin-api (source of truth)", api, "inventory-backend test", backendTest],
  ];

  let ok = true;
  for (const [nameA, setA, nameB, setB] of pairs) {
    const onlyInA = diff(setA, setB);
    const onlyInB = diff(setB, setA);
    if (onlyInA.length || onlyInB.length) {
      ok = false;
      console.error(`\nMismatch between ${nameA} and ${nameB}:`);
      if (onlyInA.length) console.error(`  only in ${nameA}: ${onlyInA.join(", ")}`);
      if (onlyInB.length) console.error(`  only in ${nameB}: ${onlyInB.join(", ")}`);
    }
  }

  if (!ok) {
    console.error("\nentitlements key lists are out of sync. Update all three files together.");
    process.exit(1);
  }
  console.log(`OK — ${api.size} feature keys match across all three files.`);
}

main();
