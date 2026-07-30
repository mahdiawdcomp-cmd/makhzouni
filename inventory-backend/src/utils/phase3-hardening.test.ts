// Regression tests for the phase-3 audit hardening.

import assert from "node:assert/strict";
import test from "node:test";
import {
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  updateUserSchema,
} from "./schemas";

const UUID = "11111111-1111-1111-1111-111111111111";

// ── password minimums ───────────────────────────────────────────────────────
// The interactive paths allowed 4 characters while ensureInitialAdmin already
// demanded 8. The login schema deliberately stays permissive so accounts with
// an existing short password can still sign in and change it.

test("new passwords must be at least 8 characters", () => {
  assert.throws(() =>
    changePasswordSchema.parse({ body: { currentPassword: "x", newPassword: "1234" } }),
  );
  assert.throws(() =>
    createUserSchema.parse({
      body: { name: "زبون", username: "cashier", password: "1234" },
    }),
  );
  assert.throws(() =>
    updateUserSchema.parse({ params: { id: UUID }, body: { password: "1234" } }),
  );
});

test("an 8-character password is accepted everywhere", () => {
  assert.doesNotThrow(() =>
    changePasswordSchema.parse({ body: { currentPassword: "x", newPassword: "12345678" } }),
  );
  assert.doesNotThrow(() =>
    createUserSchema.parse({
      body: { name: "زبون", username: "cashier", password: "12345678" },
    }),
  );
});

test("login is NOT tightened, so existing short passwords still work", () => {
  assert.doesNotThrow(() =>
    loginSchema.parse({ body: { username: "admin", password: "1234" } }),
  );
});

// ── log redaction of the new backup header path ─────────────────────────────

test("logger redaction covers the query form still accepted for backups", async () => {
  const { redactUrl } = await import("../middleware/request-logger.middleware");
  const out = redactUrl("/api/settings/backup/changes?secret=abc&since=2026-01-01");
  assert.ok(!out.includes("abc"), out);
  assert.ok(out.includes("since=2026-01-01"), out);
});

// ── JWT carries a token version ─────────────────────────────────────────────
// Without it a stolen 30-day token survived a password change.

test("signed tokens carry tokenVersion and verify round-trip", async () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-secret-for-token-version-checks";
  try {
    // Imported lazily so the module reads the secret set above.
    const { signToken, verifyToken } = await import("./jwt");
    const token = signToken({
      userId: UUID,
      username: "admin",
      role: "ADMIN",
      tokenVersion: 3,
    });
    const payload = verifyToken(token);
    assert.equal(payload.tokenVersion, 3);
    assert.equal(payload.userId, UUID);
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  }
});

// ── public URL helpers never borrow another tenant's host ───────────────────

test("backendPublicUrl prefers explicit config, then the platform domain", async () => {
  const { backendPublicUrl } = await import("./public-urls");
  const savedBackend = process.env.BACKEND_PUBLIC_URL;
  const savedRailway = process.env.RAILWAY_PUBLIC_DOMAIN;
  try {
    process.env.BACKEND_PUBLIC_URL = "https://api.example.com/";
    assert.equal(backendPublicUrl(), "https://api.example.com");

    delete process.env.BACKEND_PUBLIC_URL;
    process.env.RAILWAY_PUBLIC_DOMAIN = "tenant-abc.up.railway.app";
    assert.equal(backendPublicUrl(), "https://tenant-abc.up.railway.app");
  } finally {
    if (savedBackend === undefined) delete process.env.BACKEND_PUBLIC_URL;
    else process.env.BACKEND_PUBLIC_URL = savedBackend;
    if (savedRailway === undefined) delete process.env.RAILWAY_PUBLIC_DOMAIN;
    else process.env.RAILWAY_PUBLIC_DOMAIN = savedRailway;
  }
});

test("catalogPublicUrl returns empty rather than another tenant's shop", async () => {
  const { catalogPublicUrl } = await import("./public-urls");
  assert.equal(catalogPublicUrl(undefined), "");
  assert.equal(catalogPublicUrl("   "), "");
  assert.equal(catalogPublicUrl("https://shop.example.com/catalog/"), "https://shop.example.com/catalog");
});
