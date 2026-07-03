import assert from "node:assert/strict";
import test from "node:test";
import {
  computeReadOnly,
  isAllowedInReadOnly,
  readOnlyDecision,
  READ_ONLY_RESPONSE,
  TenantConfig,
} from "./tenant.middleware";

// A resolved SaaS tenant config. `status` drives computeReadOnly:
//   ACTIVE  → not read-only,  EXPIRED/SUSPENDED → read-only.
function saasConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantId: "t1",
    plan: "PRO",
    features: [],
    maxInvoices: null,
    maxCustomers: null,
    expiresAt: null,
    isExpired: false,
    isSuspended: false,
    status: "ACTIVE",
    licenseType: "SAAS",
    activatedAt: null,
    entitlementExpiresAt: null,
    trialEndsAt: null,
    entitlementFeatures: [],
    limits: null,
    platforms: null,
    subscriptionSource: "entitlements",
    ...overrides,
  };
}

const ACTIVE = saasConfig();
const EXPIRED = saasConfig({ status: "EXPIRED" });
const SUSPENDED = saasConfig({ status: "SUSPENDED", isSuspended: true });
// A tenant flagged expired ONLY via the legacy subscription flag (status still
// ACTIVE, no entitlement/trial dates) — the case the old requireActiveSubscription
// full-blocked. Batch 5.1 must treat it as read-only, not fully open.
const LEGACY_EXPIRED = saasConfig({ status: "ACTIVE", isExpired: true });

// ── isAllowedInReadOnly: method + path allow/deny ───────────────────────────

test("read methods always pass while read-only", () => {
  for (const m of ["GET", "HEAD", "OPTIONS", "get", "options"]) {
    assert.equal(isAllowedInReadOnly(m, "/invoices"), true, `${m} should pass`);
  }
});

test("business-data writes are blocked while read-only", () => {
  assert.equal(isAllowedInReadOnly("POST", "/invoices"), false);
  assert.equal(isAllowedInReadOnly("PUT", "/products/123"), false);
  assert.equal(isAllowedInReadOnly("PATCH", "/products/123"), false);
  assert.equal(isAllowedInReadOnly("DELETE", "/customers/123"), false);
  assert.equal(isAllowedInReadOnly("POST", "/vouchers"), false);
  assert.equal(isAllowedInReadOnly("POST", "/transfers"), false);
  assert.equal(isAllowedInReadOnly("POST", "/stocktake"), false);
  assert.equal(isAllowedInReadOnly("POST", "/campaigns"), false);
  assert.equal(isAllowedInReadOnly("POST", "/whatsapp/send"), false);
  assert.equal(isAllowedInReadOnly("PUT", "/settings"), false);
});

test("infra/auth prefixes stay open even for write methods", () => {
  assert.equal(isAllowedInReadOnly("POST", "/auth/login"), true);
  assert.equal(isAllowedInReadOnly("POST", "/auth/logout"), true);
  assert.equal(isAllowedInReadOnly("POST", "/auth/change-password"), true);
  assert.equal(isAllowedInReadOnly("POST", "/public/otp/verify"), true);
  assert.equal(isAllowedInReadOnly("POST", "/public/whatsapp/incoming-webhook"), true);
  assert.equal(isAllowedInReadOnly("GET", "/tenant-info"), true);
  assert.equal(isAllowedInReadOnly("GET", "/health"), true);
});

test("prefix matching does not leak to look-alike paths", () => {
  // "/authorize" must NOT be treated as the "/auth" prefix.
  assert.equal(isAllowedInReadOnly("POST", "/authorize"), false);
  assert.equal(isAllowedInReadOnly("POST", "/public-holidays"), false);
});

test("backup create/export are allowed; destructive settings are blocked", () => {
  assert.equal(isAllowedInReadOnly("POST", "/settings/backup/run"), true);
  assert.equal(isAllowedInReadOnly("POST", "/settings/backup/telegram"), true);
  // no full-backup RESTORE endpoint exists; destructive ones must be blocked
  assert.equal(isAllowedInReadOnly("POST", "/settings/danger/wipe-operational"), false);
  assert.equal(isAllowedInReadOnly("POST", "/settings/danger/merge-warehouses"), false);
  assert.equal(isAllowedInReadOnly("POST", "/invoices/123/restore-archived"), false);
});

test("a leading /api is stripped defensively", () => {
  assert.equal(isAllowedInReadOnly("POST", "/api/settings/backup/run"), true);
  assert.equal(isAllowedInReadOnly("POST", "/api/invoices"), false);
  assert.equal(isAllowedInReadOnly("POST", "/api/auth/login"), true);
});

// ── readOnlyDecision: full tenant-state + request scenarios (spec 1–11) ──────

test("1. standalone (null cfg) + POST invoice → allow", () => {
  assert.equal(readOnlyDecision(null, "POST", "/invoices"), "allow");
});

test("2. saas + readOnly=false + POST invoice → allow", () => {
  assert.equal(readOnlyDecision(ACTIVE, "POST", "/invoices"), "allow");
});

test("3. saas + readOnly=true + GET invoices → allow", () => {
  assert.equal(readOnlyDecision(EXPIRED, "GET", "/invoices"), "allow");
});

test("4. saas + readOnly=true + POST invoice → block", () => {
  assert.equal(readOnlyDecision(EXPIRED, "POST", "/invoices"), "block");
});

test("5. saas + readOnly=true + PUT product → block", () => {
  assert.equal(readOnlyDecision(EXPIRED, "PUT", "/products/abc"), "block");
});

test("6. saas + readOnly=true + DELETE customer → block", () => {
  assert.equal(readOnlyDecision(EXPIRED, "DELETE", "/customers/abc"), "block");
});

test("7. saas + readOnly=true + export/report/print/pdf → allow (all GET)", () => {
  assert.equal(readOnlyDecision(EXPIRED, "GET", "/reports/sales"), "allow");
  assert.equal(readOnlyDecision(EXPIRED, "GET", "/invoices/abc/pdf"), "allow");
  assert.equal(readOnlyDecision(EXPIRED, "GET", "/invoices/abc/image"), "allow");
});

test("8. saas + readOnly=true + backup create/download/list → allow", () => {
  assert.equal(readOnlyDecision(EXPIRED, "POST", "/settings/backup/run"), "allow");
  assert.equal(readOnlyDecision(EXPIRED, "GET", "/settings/backup/download"), "allow");
  assert.equal(readOnlyDecision(EXPIRED, "POST", "/settings/backup/telegram"), "allow");
});

test("9. saas + readOnly=true + destructive/restore-style op → block", () => {
  assert.equal(readOnlyDecision(EXPIRED, "POST", "/settings/danger/wipe-operational"), "block");
  assert.equal(readOnlyDecision(EXPIRED, "POST", "/invoices/abc/restore-archived"), "block");
});

test("5. saas suspended + GET customers → allow (no old full-block)", () => {
  assert.equal(readOnlyDecision(SUSPENDED, "GET", "/customers"), "allow");
});

test("6. saas suspended + DELETE customer → block (READ_ONLY_MODE, not old 403)", () => {
  assert.equal(readOnlyDecision(SUSPENDED, "DELETE", "/customers/abc"), "block");
});

test("10. Super Admin down with no cache (null cfg) → allow (fail-open)", () => {
  assert.equal(readOnlyDecision(null, "POST", "/invoices"), "allow");
  assert.equal(readOnlyDecision(null, "DELETE", "/customers/abc"), "allow");
});

test("12. Super Admin down but cache says read-only → read-only applied (block writes, allow reads)", () => {
  // getTenantConfig() returns the cached config when Super Admin is down; here
  // we assert the decision layer enforces read-only from that cached state.
  assert.equal(readOnlyDecision(EXPIRED, "POST", "/invoices"), "block");
  assert.equal(readOnlyDecision(EXPIRED, "GET", "/invoices"), "allow");
});

test("11. OPTIONS always passes (CORS preflight)", () => {
  assert.equal(readOnlyDecision(EXPIRED, "OPTIONS", "/invoices"), "allow");
  assert.equal(readOnlyDecision(EXPIRED, "OPTIONS", "/settings"), "allow");
});

// ── read-only also triggers on entitlement/trial expiry (not just status) ───

test("entitlementExpiresAt in the past → read-only enforced on writes", () => {
  const cfg = saasConfig({ status: "ACTIVE", entitlementExpiresAt: "2020-01-01T00:00:00.000Z" });
  assert.equal(readOnlyDecision(cfg, "POST", "/invoices"), "block");
  assert.equal(readOnlyDecision(cfg, "GET", "/invoices"), "allow");
});

test("expired TRIAL → read-only; active TRIAL → open", () => {
  const expiredTrial = saasConfig({ licenseType: "TRIAL", trialEndsAt: "2020-01-01T00:00:00.000Z" });
  const activeTrial = saasConfig({ licenseType: "TRIAL", trialEndsAt: "2999-01-01T00:00:00.000Z" });
  assert.equal(readOnlyDecision(expiredTrial, "POST", "/invoices"), "block");
  assert.equal(readOnlyDecision(activeTrial, "POST", "/invoices"), "allow");
});

// ── Batch 5.1: legacy subscription flags now enter read-only (were full-block) ─

test("legacy isExpired flag alone → computeReadOnly true (superset of old block)", () => {
  assert.equal(computeReadOnly(LEGACY_EXPIRED), true);
});

test("legacy isSuspended flag → computeReadOnly true", () => {
  assert.equal(computeReadOnly(SUSPENDED), true);
});

test("legacy-expired tenant → read-only, not fully open: GET allowed, writes blocked", () => {
  assert.equal(readOnlyDecision(LEGACY_EXPIRED, "GET", "/invoices"), "allow");
  assert.equal(readOnlyDecision(LEGACY_EXPIRED, "POST", "/invoices"), "block");
  assert.equal(readOnlyDecision(LEGACY_EXPIRED, "DELETE", "/customers/abc"), "block");
});

test("active tenant stays fully open (extension didn't over-trigger)", () => {
  assert.equal(computeReadOnly(ACTIVE), false);
  assert.equal(readOnlyDecision(ACTIVE, "POST", "/invoices"), "allow");
});

test("standalone (null) is never read-only after the extension", () => {
  assert.equal(computeReadOnly(null), false);
  assert.equal(readOnlyDecision(null, "POST", "/invoices"), "allow");
});

// ── response shape ──────────────────────────────────────────────────────────

test("READ_ONLY_RESPONSE has the documented JSON shape", () => {
  assert.equal(READ_ONLY_RESPONSE.error, "READ_ONLY_MODE");
  assert.equal(READ_ONLY_RESPONSE.readOnly, true);
  assert.equal(typeof READ_ONLY_RESPONSE.message, "string");
});
