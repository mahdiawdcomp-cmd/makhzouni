#!/usr/bin/env node
/**
 * Cross-checks the three hand-maintained copies of the SaaS feature-key list:
 *   - saas-admin-api/src/entitlements.ts   (source of truth — what the API validates/stores)
 *   - saas-admin-web/src/entitlements.ts   (Super Admin UI grouping/labels)
 *   - inventory-backend/src/utils/entitlements-consistency.test.ts (gating contract test)
 *
 * It ALSO checks a second, separate thing: saas-admin-web's ENFORCED_FEATURE_KEYS,
 * the set the Super Admin UI uses to tell an admin which switches actually do
 * something. That set is re-derived here from inventory-backend's real gates
 * (ROUTE_FEATURE_MAP + service-level hasFeature calls), so the UI cannot claim a
 * feature is enforced when no gate exists, nor keep calling a newly-gated
 * feature inert.
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
  // Normalise line endings. Several patterns below anchor on a newline, and a
  // file saved with Windows CRLF silently matched nothing — which surfaced as
  // "this whole list is missing" rather than as a parse failure.
  return fs.readFileSync(full, "utf8").replace(/\r\n/g, "\n");
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

/** Feature keys the shop backend really gates: route map + service-level hasFeature. */
function extractBackendEnforcedKeys(middlewareSource, serviceSources) {
  const mapMatch = middlewareSource.match(/export const ROUTE_FEATURE_MAP[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!mapMatch) throw new Error("inventory-backend tenant.middleware.ts: ROUTE_FEATURE_MAP block not found — file shape changed, update this script.");
  const keys = new Set([...mapMatch[1].matchAll(/featureKey:\s*"([a-zA-Z][a-zA-Z0-9]*)"/g)].map((m) => m[1]));
  for (const source of serviceSources) {
    for (const m of source.matchAll(/hasFeature\("([a-zA-Z][a-zA-Z0-9]*)"\)/g)) keys.add(m[1]);
  }
  return keys;
}

function extractWebEnforcedKeys(source) {
  const match = source.match(/export const ENFORCED_FEATURE_KEYS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\);/);
  if (!match) throw new Error("saas-admin-web/src/entitlements.ts: ENFORCED_FEATURE_KEYS block not found — file shape changed, update this script.");
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

  // Second check: does the UI's "this switch actually works" set match the gates
  // that really exist in the shop backend?
  const backendEnforced = extractBackendEnforcedKeys(
    readFile("inventory-backend/src/middleware/tenant.middleware.ts"),
    [readFile("inventory-backend/src/services/catalog.service.ts")],
  );
  const webEnforced = extractWebEnforcedKeys(readFile("saas-admin-web/src/entitlements.ts"));
  const claimedNotGated = diff(webEnforced, backendEnforced);
  const gatedNotClaimed = diff(backendEnforced, webEnforced);
  if (claimedNotGated.length || gatedNotClaimed.length) {
    ok = false;
    console.error("\nMismatch between the Super Admin UI's ENFORCED_FEATURE_KEYS and the real gates in inventory-backend:");
    if (claimedNotGated.length) console.error(`  UI says enforced, backend has no gate: ${claimedNotGated.join(", ")}`);
    if (gatedNotClaimed.length) console.error(`  backend gates it, UI still labels it inert: ${gatedNotClaimed.join(", ")}`);
  }

  if (!ok) {
    console.error("\nentitlements key lists are out of sync. Update all three files together.");
    process.exit(1);
  }
  console.log(`OK — ${api.size} feature keys match across all three files.`);
  console.log(`OK — ${webEnforced.size} enforced keys match the real gates in inventory-backend.`);
}

main();
