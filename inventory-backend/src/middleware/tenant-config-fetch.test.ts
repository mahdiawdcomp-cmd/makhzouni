import assert from "node:assert/strict";
import test from "node:test";

// Each test imports a fresh module instance (via a unique query string) so the
// in-memory cache from one test never leaks into the next.
let caseCounter = 0;
async function freshTenantMiddleware() {
  return import(`./tenant.middleware.ts?case=${caseCounter++}`) as Promise<
    typeof import("./tenant.middleware")
  >;
}

const ORIGINAL_ENV = { ...process.env };
function resetEnv() {
  for (const key of ["TENANT_ID", "SUPER_ADMIN_API_URL", "SUPER_ADMIN_API_KEY"]) {
    delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

test("standalone mode: no TENANT_ID never calls fetch and returns null config", async (t) => {
  resetEnv();
  delete process.env.TENANT_ID;
  delete process.env.SUPER_ADMIN_API_URL;

  let fetchCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetchCalls++;
    throw new Error("should not be called in standalone mode");
  });

  const { getTenantConfig } = await freshTenantMiddleware();
  const cfg = await getTenantConfig();

  assert.equal(cfg, null);
  assert.equal(fetchCalls, 0);
});

test("saas mode: TENANT_ID + SUPER_ADMIN_API_URL set fetches and maps entitlements fields", async (t) => {
  resetEnv();
  process.env.TENANT_ID = "tenant-123";
  process.env.SUPER_ADMIN_API_URL = "https://admin-api.example.com";
  process.env.SUPER_ADMIN_API_KEY = "test-key";

  t.mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({
        status: "ACTIVE",
        licenseType: "SAAS",
        activatedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        trialEndsAt: null,
        features: ["catalogWholesale", "auditLog"],
        limits: { maxAndroidDevices: 3 },
        platforms: { webEnabled: true, androidEnabled: false },
        subscriptions: [{ isActive: true, plan: "PRO", features: ["ANDROID"], maxInvoices: 500, maxCustomers: 200, expiresAt: "2099-01-01T00:00:00.000Z" }],
      }),
      { status: 200 }
    )
  );

  const { getTenantConfig } = await freshTenantMiddleware();
  const cfg = await getTenantConfig();

  assert.ok(cfg);
  assert.equal(cfg!.tenantId, "tenant-123");
  assert.equal(cfg!.status, "ACTIVE");
  assert.equal(cfg!.licenseType, "SAAS");
  assert.deepEqual(cfg!.entitlementFeatures, ["catalogWholesale", "auditLog"]);
  assert.equal(cfg!.subscriptionSource, "entitlements");
  assert.equal(cfg!.isExpired, false);
  assert.equal(cfg!.isSuspended, false);
  // Legacy fields still populated from the subscription block, untouched.
  assert.equal(cfg!.plan, "PRO");
  assert.equal(cfg!.maxInvoices, 500);
});

test("Super Admin unreachable: getTenantConfig returns null without throwing, does not crash caller", async (t) => {
  resetEnv();
  process.env.TENANT_ID = "tenant-123";
  process.env.SUPER_ADMIN_API_URL = "https://admin-api.example.com";

  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network unreachable");
  });

  const { getTenantConfig, getTenantCheckMeta } = await freshTenantMiddleware();
  const cfg = await getTenantConfig();

  assert.equal(cfg, null);
  const meta = getTenantCheckMeta();
  assert.equal(meta.hasCache, false);
  assert.match(meta.lastFetchError ?? "", /network unreachable/);
});

test("cache: a second call within the TTL does not refetch", async (t) => {
  resetEnv();
  process.env.TENANT_ID = "tenant-123";
  process.env.SUPER_ADMIN_API_URL = "https://admin-api.example.com";

  let fetchCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    fetchCalls++;
    return new Response(JSON.stringify({ status: "ACTIVE", features: [], subscriptions: [] }), { status: 200 });
  });

  const { getTenantConfig } = await freshTenantMiddleware();
  await getTenantConfig();
  await getTenantConfig();

  assert.equal(fetchCalls, 1);
});

test("readOnly via isReadOnly(): EXPIRED status reports true without blocking the caller", async (t) => {
  resetEnv();
  process.env.TENANT_ID = "tenant-123";
  process.env.SUPER_ADMIN_API_URL = "https://admin-api.example.com";

  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ status: "EXPIRED", features: [], subscriptions: [] }), { status: 200 })
  );

  const { isReadOnly } = await freshTenantMiddleware();
  assert.equal(await isReadOnly(), true);
});

test("hasFeature(): no entitlements configured (empty features) is unrestricted", async (t) => {
  resetEnv();
  process.env.TENANT_ID = "tenant-123";
  process.env.SUPER_ADMIN_API_URL = "https://admin-api.example.com";

  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ status: "ACTIVE", features: [], subscriptions: [] }), { status: 200 })
  );

  const { hasFeature } = await freshTenantMiddleware();
  assert.equal(await hasFeature("catalogWholesale"), true);
});

test("hasFeature(): entitlements configured but missing the key returns false (report-only, not enforced)", async (t) => {
  resetEnv();
  process.env.TENANT_ID = "tenant-123";
  process.env.SUPER_ADMIN_API_URL = "https://admin-api.example.com";

  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ status: "ACTIVE", features: ["auditLog"], subscriptions: [] }), { status: 200 })
  );

  const { hasFeature } = await freshTenantMiddleware();
  assert.equal(await hasFeature("catalogWholesale"), false);
  assert.equal(await hasFeature("auditLog"), true);
});
