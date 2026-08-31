import assert from "node:assert/strict";
import test from "node:test";

// Each test imports a fresh module instance so one test's cache never leaks
// into the next — same trick as tenant-config-fetch.test.ts.
let caseCounter = 0;
async function freshTenantMiddleware() {
  return import(`./tenant.middleware.ts?invalidate=${caseCounter++}`) as Promise<
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

function saasResponse(status: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status,
      licenseType: "SAAS",
      features: ["transfers"],
      subscriptions: [{ isActive: true, plan: "BASIC", expiresAt: null }],
    }),
  } as any;
}

test("invalidateTenantConfigCache forces the next call to refetch", async (t) => {
  resetEnv();
  process.env.TENANT_ID = "tenant-1";
  process.env.SUPER_ADMIN_API_URL = "https://admin-api.example.com";
  process.env.SUPER_ADMIN_API_KEY = "test-key";

  let calls = 0;
  let current = "ACTIVE";
  t.mock.method(globalThis, "fetch", async () => { calls++; return saasResponse(current); });

  const { getTenantConfig, invalidateTenantConfigCache } = await freshTenantMiddleware();

  const first = await getTenantConfig();
  assert.equal(first?.status, "ACTIVE");
  assert.equal(calls, 1);

  // Second call inside the TTL must be served from cache, not refetched.
  await getTenantConfig();
  assert.equal(calls, 1, "cached call should not refetch");

  // Super Admin suspends the shop and tells it to drop its cache.
  current = "SUSPENDED";
  invalidateTenantConfigCache();

  const after = await getTenantConfig();
  assert.equal(calls, 2, "invalidation must force a refetch");
  assert.equal(after?.status, "SUSPENDED");
});

test("a suspend applies immediately after invalidation, not after the TTL", async (t) => {
  resetEnv();
  process.env.TENANT_ID = "tenant-2";
  process.env.SUPER_ADMIN_API_URL = "https://admin-api.example.com";
  process.env.SUPER_ADMIN_API_KEY = "test-key";

  let current = "ACTIVE";
  t.mock.method(globalThis, "fetch", async () => saasResponse(current));

  const { getTenantConfig, invalidateTenantConfigCache, readOnlyDecision } = await freshTenantMiddleware();

  assert.equal(readOnlyDecision(await getTenantConfig(), "POST", "/invoices"), "allow");

  current = "SUSPENDED";
  // Without the nudge the stale ACTIVE config would still be served.
  assert.equal(readOnlyDecision(await getTenantConfig(), "POST", "/invoices"), "allow");

  invalidateTenantConfigCache();
  assert.equal(readOnlyDecision(await getTenantConfig(), "POST", "/invoices"), "block");
});
