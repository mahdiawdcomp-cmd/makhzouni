import assert from "node:assert/strict";
import test from "node:test";
import {
  featureDecision,
  featureNotEnabledResponse,
  matchFeatureRule,
  readOnlyDecision,
  TenantConfig,
} from "./tenant.middleware";

// A resolved SaaS tenant config with an explicit entitlement list. `status`
// stays ACTIVE so read-only never triggers — these tests exercise the FEATURE
// layer in isolation (read-only ordering is covered in the read-only test file
// and in scenario 7 below via the readOnlyDecision import).
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

// ── matchFeatureRule: prefix / exact / regex correctness ────────────────────

test("catalog-management maps to catalogWholesale", () => {
  assert.equal(matchFeatureRule("/catalog-management")?.featureKey, "catalogWholesale");
  assert.equal(matchFeatureRule("/catalog-management/promo")?.featureKey, "catalogWholesale");
});

test("retail-catalog maps to retailShop, campaigns to whatsappCampaigns", () => {
  assert.equal(matchFeatureRule("/retail-catalog/items")?.featureKey, "retailShop");
  assert.equal(matchFeatureRule("/campaigns")?.featureKey, "whatsappCampaigns");
  assert.equal(matchFeatureRule("/campaigns/abc/recipients")?.featureKey, "whatsappCampaigns");
});

test("transfers/audit-logs/inbound-messages/quotations map correctly", () => {
  assert.equal(matchFeatureRule("/transfers")?.featureKey, "transfers");
  assert.equal(matchFeatureRule("/audit-logs")?.featureKey, "auditLog");
  assert.equal(matchFeatureRule("/inbound-messages/1/reply")?.featureKey, "whatsappInbox");
  assert.equal(matchFeatureRule("/quotations/1/convert")?.featureKey, "quotations");
});

test("stocktake management gated, but public worker flow is NOT gated", () => {
  assert.equal(matchFeatureRule("/stocktake")?.featureKey, "stocktake");
  assert.equal(matchFeatureRule("/stocktake/123/close")?.featureKey, "stocktake");
  // public worker QR routes must stay reachable (no rule matches)
  assert.equal(matchFeatureRule("/stocktake/public/tok123"), null);
  assert.equal(matchFeatureRule("/stocktake/public/tok123/scan"), null);
});

test("whatsapp send-invoice and generic send map correctly; status/restart don't", () => {
  assert.equal(matchFeatureRule("/whatsapp/send-invoice/abc")?.featureKey, "whatsappInvoices");
  assert.equal(matchFeatureRule("/whatsapp/send")?.featureKey, "whatsappCampaigns");
  // /whatsapp/send is exact — must not swallow /whatsapp/send-invoice via that rule
  assert.equal(matchFeatureRule("/whatsapp/status"), null);
  assert.equal(matchFeatureRule("/whatsapp/restart"), null);
});

test("error-logs: only AI analysis endpoints gated, not list/resolve", () => {
  assert.equal(matchFeatureRule("/error-logs/analyze-health")?.featureKey, "aiErrorAnalysis");
  assert.equal(matchFeatureRule("/error-logs/123/analyze")?.featureKey, "aiErrorAnalysis");
  // plain list and resolve must pass through un-gated
  assert.equal(matchFeatureRule("/error-logs"), null);
  assert.equal(matchFeatureRule("/error-logs/123/resolve"), null);
});

test("core/basic routes are never in the feature map", () => {
  for (const p of ["/products", "/customers", "/invoices", "/vouchers", "/reports", "/users", "/settings", "/settings/backup/run"]) {
    assert.equal(matchFeatureRule(p), null, `${p} must not be gated`);
  }
});

test("a leading /api is stripped defensively", () => {
  assert.equal(matchFeatureRule("/api/campaigns")?.featureKey, "whatsappCampaigns");
});

// ── featureDecision: the 12 required scenarios ──────────────────────────────

test("1. standalone (null cfg) + POST to gated /campaigns → allow (no block)", () => {
  assert.equal(featureDecision(null, "POST", "/campaigns"), "allow");
});

test("2. saas active + has catalogWholesale + POST/GET /catalog-management → allow", () => {
  const cfg = saasConfig({ entitlementFeatures: ["catalogWholesale"] });
  assert.equal(featureDecision(cfg, "POST", "/catalog-management"), "allow");
  assert.equal(featureDecision(cfg, "GET", "/catalog-management"), "allow");
});

test("3. saas active WITHOUT catalogWholesale + /catalog-management → FEATURE_NOT_ENABLED", () => {
  const cfg = saasConfig({ entitlementFeatures: ["retailShop"] });
  assert.equal(featureDecision(cfg, "POST", "/catalog-management"), "block:catalogWholesale");
  assert.equal(featureDecision(cfg, "GET", "/catalog-management"), "block:catalogWholesale");
});

test("4. saas active + entitlementFeatures=[] + basic invoice POST → allow (basic never gated)", () => {
  const cfg = saasConfig({ entitlementFeatures: [] });
  assert.equal(featureDecision(cfg, "POST", "/invoices"), "allow");
});

test("5. saas active + entitlementFeatures=[] + /campaigns → FEATURE_NOT_ENABLED", () => {
  const cfg = saasConfig({ entitlementFeatures: [] });
  assert.equal(featureDecision(cfg, "POST", "/campaigns"), "block:whatsappCampaigns");
});

test("6. saas active + entitlementFeatures null/undefined → fail-open, never blocks", () => {
  const cfgNull = saasConfig({ entitlementFeatures: null as any });
  const cfgUndef = saasConfig({ entitlementFeatures: undefined as any });
  assert.equal(featureDecision(cfgNull, "POST", "/campaigns"), "allow");
  assert.equal(featureDecision(cfgUndef, "POST", "/campaigns"), "allow");
});

test("7. read-only (expired) takes priority: readOnlyDecision blocks first (READ_ONLY_MODE)", () => {
  // Ordering is enforced by middleware mount order (enforceReadOnlyMiddleware
  // before enforceFeatureMiddleware in server.ts). This asserts the read-only
  // layer would block the same request FIRST, so it never reaches the feature
  // layer with a FEATURE_NOT_ENABLED result.
  const expiredNoFeature = saasConfig({ status: "EXPIRED", entitlementFeatures: [] });
  assert.equal(readOnlyDecision(expiredNoFeature, "POST", "/campaigns"), "block");
  // And the feature layer, if it WERE reached, would also want to block — but
  // read-only wins because it runs first and returns 423 before this executes.
  assert.equal(featureDecision(expiredNoFeature, "POST", "/campaigns"), "block:whatsappCampaigns");
});

test("8. Super Admin down, no cache (null cfg) → doesn't block", () => {
  assert.equal(featureDecision(null, "POST", "/campaigns"), "allow");
  assert.equal(featureDecision(null, "GET", "/catalog-management"), "allow");
});

test("9. Super Admin down, cache exists missing feature → FEATURE_NOT_ENABLED from cache", () => {
  // getTenantConfig() returns the cached config when Super Admin is down; here
  // we assert the decision layer enforces the feature gate from that cache.
  const cachedCfg = saasConfig({ entitlementFeatures: ["retailShop"] });
  assert.equal(featureDecision(cachedCfg, "POST", "/campaigns"), "block:whatsappCampaigns");
});

test("10. OPTIONS always passes regardless of feature/tenant state", () => {
  const cfg = saasConfig({ entitlementFeatures: [] });
  assert.equal(featureDecision(cfg, "OPTIONS", "/campaigns"), "allow");
  assert.equal(featureDecision(cfg, "OPTIONS", "/catalog-management"), "allow");
  assert.equal(featureDecision(null, "OPTIONS", "/campaigns"), "allow");
});

test("11. GET to a basic report route → passes without any feature requirement", () => {
  const cfg = saasConfig({ entitlementFeatures: [] });
  assert.equal(featureDecision(cfg, "GET", "/reports/sales"), "allow");
  assert.equal(featureDecision(cfg, "GET", "/reports/profit"), "allow");
});

test("12. /error-logs/analyze without aiErrorAnalysis → FEATURE_NOT_ENABLED", () => {
  const cfg = saasConfig({ entitlementFeatures: ["auditLog"] });
  assert.equal(featureDecision(cfg, "POST", "/error-logs/analyze-health"), "block:aiErrorAnalysis");
  assert.equal(featureDecision(cfg, "POST", "/error-logs/123/analyze"), "block:aiErrorAnalysis");
  // list + resolve stay open
  assert.equal(featureDecision(cfg, "GET", "/error-logs"), "allow");
  assert.equal(featureDecision(cfg, "PATCH", "/error-logs/123/resolve"), "allow");
});

// ── response shape ──────────────────────────────────────────────────────────

test("featureNotEnabledResponse has the exact documented shape", () => {
  const r = featureNotEnabledResponse("catalogWholesale");
  assert.equal(r.error, "FEATURE_NOT_ENABLED");
  assert.equal(r.message, "هذه الميزة غير مفعلة في نسختك.");
  assert.equal(r.feature, "catalogWholesale");
  assert.deepEqual(Object.keys(r).sort(), ["error", "feature", "message"]);
});
