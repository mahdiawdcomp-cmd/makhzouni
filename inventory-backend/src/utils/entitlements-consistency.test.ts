// The Super Admin service stores a tenant's purchased features as a flat list
// of keys; this backend blocks routes whose key is absent. If the two ever
// drift, gating silently stops matching and either everything is allowed or
// everything is blocked — both invisible until a customer complains.
//
// These tests pin the contract from this side.

import assert from "node:assert/strict";
import test from "node:test";
import { ROUTE_FEATURE_MAP, featureDecision } from "../middleware/tenant.middleware";

// Mirrors saas-admin-api/src/entitlements.ts FEATURE_GROUPS, flattened.
// Update BOTH files together when adding a feature.
const SUPER_ADMIN_FEATURE_KEYS = new Set([
  "multiWarehouse", "transfers", "stocktake", "stockMovementAdvanced", "lowStockAlerts",
  "advancedPermissions", "auditLog", "advancedReports", "dailyClosing", "profitReports",
  "pos", "salesReturns", "quotations", "advancedDiscounts",
  "catalogWholesale", "catalogOtp", "catalogShowHidePrice", "catalogShowHideStock", "catalogFullCartonFilter",
  "retailShop", "onlineOrders", "retailCoupons", "referral", "orderStatus",
  "whatsappInvoices", "whatsappVouchers", "whatsappCampaigns", "whatsappBot", "whatsappInbox",
  "androidApp", "desktopApp", "desktopWhiteLabel", "offlineDesktopLifetime",
  "systemHealthAdvanced", "aiErrorAnalysis", "campaignProblemAnalysis", "advancedAlerts",
  "onlineBackup", "incrementalBackup", "backupRestore",
]);

test("every gated route uses a feature key Super Admin can actually grant", () => {
  for (const rule of ROUTE_FEATURE_MAP) {
    assert.ok(
      SUPER_ADMIN_FEATURE_KEYS.has(rule.featureKey),
      `${rule.label} gates on "${rule.featureKey}", which is not a Super Admin feature key — ` +
        `no tenant could ever be granted it, so the route is permanently blocked for SaaS tenants.`,
    );
  }
});

// The frontend used to treat an empty list as "unrestricted" while the backend
// treats it as "nothing purchased". A SaaS tenant created with features: []
// therefore saw the full menu and got 403 on every click.
const saasConfig = (features: string[]) =>
  ({
    mode: "saas",
    status: "ACTIVE",
    entitlementFeatures: features,
  }) as unknown as Parameters<typeof featureDecision>[0];

test("an empty entitlement list blocks optional features", () => {
  assert.equal(
    featureDecision(saasConfig([]), "GET", "/catalog-management"),
    "block:catalogWholesale",
  );
});

test("an empty entitlement list still allows always-on base routes", () => {
  const cfg = saasConfig([]);
  for (const path of ["/products", "/customers", "/vouchers", "/reports"]) {
    assert.equal(featureDecision(cfg, "GET", path), "allow", `${path} is base and must never be gated`);
  }
});

test("a granted feature unblocks its route", () => {
  assert.equal(
    featureDecision(saasConfig(["catalogWholesale"]), "GET", "/catalog-management"),
    "allow",
  );
});

test("an unresolved tenant fails open, so a Super Admin outage cannot brick a shop", () => {
  assert.equal(featureDecision(null, "GET", "/catalog-management"), "allow");
});
