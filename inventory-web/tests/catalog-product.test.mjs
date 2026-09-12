import { test } from "node:test";
import assert from "node:assert/strict";
import handler, { renderProduct, resolveCatalogBackend } from "../api/catalog-product.js";

const id = "11111111-1111-4111-8111-111111111111";
test("product has distinct server-visible metadata, canonical and public image", () => {
  const html = renderProduct({ id, name: "منتج واحد", description: "وصف خاص", itemNumber: "A1" }, "https://example.mazbwoni.com");
  assert.ok(html.includes("<title>منتج واحد |"));
  assert.ok(html.includes('property="og:description" content="وصف خاص"'));
  assert.ok(html.includes(`/catalog/product/${id}/image`));
  assert.ok(html.includes('rel="canonical"'));
  assert.ok(html.includes(`href="/catalog?product=${id}"`));
  assert.equal(html.includes("access="), false);
});
test("untrusted product fields cannot escape HTML attributes or JSON-LD", () => {
  const html = renderProduct({ id, name: '"><script>alert(1)</script>', description: '</script><img src=x onerror=alert(1)>', itemNumber: "'" }, "https://example.mazbwoni.com");
  assert.equal(html.includes("<script>alert(1)"), false);
  assert.equal(html.includes("<img src=x"), false);
  assert.ok(html.includes("\\u003c/script>"));
});
test("tenant routing never falls back to the platform backend", async () => {
  const fetcher = async url => {
    assert.equal(url.searchParams.get("subdomain"), "example");
    return { ok: true, json: async () => ({ status: "ACTIVE", backendUrl: "https://example-api.test" }) };
  };
  assert.equal(await resolveCatalogBackend("example.mazbwoni.com", { VITE_API_URL: "https://platform.test/api" }, fetcher), "https://example-api.test/api");
  await assert.rejects(resolveCatalogBackend("example.mazbwoni.com", { VITE_API_URL: "https://platform.test" }, async () => ({ ok: false })));
  await assert.rejects(resolveCatalogBackend("evil.test", { VITE_API_URL: "https://platform.test" }));
});
test("inactive tenants and credential-bearing backends fail closed", async () => {
  await assert.rejects(resolveCatalogBackend("example.mazbwoni.com", {}, async () => ({ ok: true, json: async () => ({ status: "SUSPENDED", backendUrl: "https://example.test" }) })));
  await assert.rejects(resolveCatalogBackend("app.mazbwoni.com", { VITE_API_URL: "https://user:pass@example.test" }));
});
test("preview pages are noindex", () => {
  assert.ok(renderProduct({ id, name: "product" }, "https://preview.vercel.app", false).includes('content="noindex,nofollow"'));
});
test("missing/private products return a real 404, never SPA success", async t => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 404 }));
  const prior = process.env.VITE_API_URL;
  process.env.VITE_API_URL = "https://api.example.test/api";
  const res = { code: 0, headers: {}, status(n) { this.code = n; return this; }, setHeader(k,v) { this.headers[k] = v; }, end(body) { this.body = body; } };
  try {
    await handler({ headers: { host: "app.mazbwoni.com" }, query: { id } }, res);
    assert.equal(res.code, 404);
    assert.equal(res.headers["X-Robots-Tag"], "noindex");
  } finally { if (prior === undefined) delete process.env.VITE_API_URL; else process.env.VITE_API_URL = prior; }
});
