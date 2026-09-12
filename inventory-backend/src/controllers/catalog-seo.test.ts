import { test, mock, before } from "node:test";
import assert from "node:assert/strict";
let enabled = true;
let found = true;
let reads = 0;
let selected: any;
mock.module("../services/catalog.service", { exports: { isGuestCatalogEnabled: async () => enabled } });
mock.module("../config/database", { exports: { default: { product: {
  findFirst: async (args: any) => { reads++; selected = args.select; return found ? { id: "11111111-1111-4111-8111-111111111111", name: "مادة", itemNumber: "A1", catalogDescription: "وصف", updatedAt: new Date(), salePrice: 1000, costPrice: 500, currentStock: 10, imageUrl: "https://internal.invalid/private" } : null; },
  findMany: async () => [], count: async () => 1001,
} } } });
let controllers: typeof import("./catalog-seo.controller");
before(async () => { controllers = await import("./catalog-seo.controller"); });
function call(controller: any, req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => { headers[k] = v; }, json: (body: any) => resolve({ body, headers }), send: (body: any) => resolve({ body, headers }) };
    controller(req, res, reject);
  });
}
const req = { params: { id: "11111111-1111-4111-8111-111111111111" }, query: {} };
test("public metadata has no prices, stock or operational fields", async () => {
  const { body, headers } = await call(controllers.getCatalogSeoProduct, req);
  assert.equal(body.data.name, "مادة");
  assert.equal(body.data.salePrice, undefined);
  assert.equal(body.data.costPrice, undefined);
  assert.equal(body.data.currentStock, undefined);
  assert.equal(selected.salePrice, undefined);
  assert.equal(headers["Cache-Control"], "no-store");
});
test("closed catalog rejects before reading a product", async () => {
  enabled = false; reads = 0;
  await assert.rejects(call(controllers.getCatalogSeoProduct, req));
  await assert.rejects(call(controllers.getCatalogSeoIndex, req));
  await assert.rejects(call(controllers.getCatalogSeoImage, req));
  assert.equal(reads, 0);
  enabled = true;
});
test("missing and malformed product ids are not successful pages", async () => {
  found = false;
  await assert.rejects(call(controllers.getCatalogSeoProduct, req));
  found = true;
  await assert.rejects(call(controllers.getCatalogSeoProduct, { params: { id: "bad" } }));
});
test("share image is a real 1200x630 JPEG; remote stored URLs are never fetched", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Remote fetch forbidden"); });
  const { body, headers } = await call(controllers.getCatalogSeoImage, req);
  assert.equal(headers["Content-Type"], "image/jpeg");
  assert.equal(body[0], 0xff); assert.equal(body[1], 0xd8);
  const sharp = (await import("sharp")).default;
  const metadata = await sharp(body).metadata();
  assert.equal(metadata.width, 1200); assert.equal(metadata.height, 630);
});
test("sitemap is paginated and rejects malformed page numbers", async () => {
  const { body } = await call(controllers.getCatalogSeoIndex, req);
  assert.equal(body.data.pages, 2);
  await assert.rejects(call(controllers.getCatalogSeoIndex, { query: { page: "-1" } }));
});
