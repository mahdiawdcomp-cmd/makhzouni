import { test, describe } from "node:test";
import assert from "node:assert/strict";
import productsRouter from "./products.routes";

// Regression guard for batch 24B hardening: these write/maintenance routes must
// carry a permission middleware in front of the controller (stack length > the
// bare handler). If someone removes the guard, the count drops and this fails.
const MIN_HANDLERS: Array<{ method: string; path: string; min: number }> = [
  { method: "post", path: "/bulk-delete", min: 2 },
  { method: "get", path: "/deleted", min: 2 },
  { method: "post", path: "/backfill-qr", min: 2 },
  { method: "post", path: "/backfill-thumbnails", min: 2 },
  { method: "post", path: "/:id/adjust-stock", min: 3 }, // guard + validate + handler
  { method: "post", path: "/:id/restore", min: 3 },
];

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: unknown[] };
};

function routeStackLength(method: string, path: string): number | null {
  const layers = (productsRouter as unknown as { stack: Layer[] }).stack;
  for (const layer of layers) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack.length;
    }
  }
  return null;
}

describe("products route guards (batch 24B)", () => {
  for (const { method, path, min } of MIN_HANDLERS) {
    test(`${method.toUpperCase()} ${path} has a permission guard`, () => {
      const length = routeStackLength(method, path);
      assert.ok(length !== null, `route ${method} ${path} must exist`);
      assert.ok(
        (length as number) >= min,
        `${method} ${path} expected >= ${min} handlers (guard present), got ${length}`
      );
    });
  }
});
