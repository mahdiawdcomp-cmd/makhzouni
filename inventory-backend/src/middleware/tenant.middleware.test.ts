import assert from "node:assert/strict";
import test from "node:test";
import { computeReadOnly, TenantConfig } from "./tenant.middleware";

const BASE: TenantConfig = {
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
};

test("computeReadOnly: standalone (null config) is never read-only", () => {
  assert.equal(computeReadOnly(null), false);
});

test("computeReadOnly: ACTIVE status with no dates is not read-only", () => {
  assert.equal(computeReadOnly({ ...BASE }), false);
});

test("computeReadOnly: EXPIRED status is read-only", () => {
  assert.equal(computeReadOnly({ ...BASE, status: "EXPIRED" }), true);
});

test("computeReadOnly: SUSPENDED status is read-only", () => {
  assert.equal(computeReadOnly({ ...BASE, status: "SUSPENDED" }), true);
});

test("computeReadOnly: past entitlementExpiresAt is read-only", () => {
  assert.equal(computeReadOnly({ ...BASE, entitlementExpiresAt: "2020-01-01T00:00:00.000Z" }), true);
});

test("computeReadOnly: future entitlementExpiresAt is not read-only", () => {
  assert.equal(computeReadOnly({ ...BASE, entitlementExpiresAt: "2099-01-01T00:00:00.000Z" }), false);
});

test("computeReadOnly: past trialEndsAt with licenseType TRIAL is read-only", () => {
  assert.equal(
    computeReadOnly({ ...BASE, licenseType: "TRIAL", trialEndsAt: "2020-01-01T00:00:00.000Z" }),
    true
  );
});

test("computeReadOnly: past trialEndsAt with non-TRIAL licenseType is not read-only", () => {
  assert.equal(
    computeReadOnly({ ...BASE, licenseType: "SAAS", trialEndsAt: "2020-01-01T00:00:00.000Z" }),
    false
  );
});

test("computeReadOnly: future trialEndsAt with licenseType TRIAL is not read-only", () => {
  assert.equal(
    computeReadOnly({ ...BASE, licenseType: "TRIAL", trialEndsAt: "2099-01-01T00:00:00.000Z" }),
    false
  );
});
