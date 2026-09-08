import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

// ── In-memory fakes ──────────────────────────────────────────────────────────
// Same style as retail-prepare.test.ts: stub prisma + crypto + the outbound
// Meta Graph fetch, exercise the real service/queue-tick logic in isolation.

type Post = {
  id: string;
  productId: string | null;
  productTitle: string;
  accountId: string;
  postType: "IMAGE" | "CAROUSEL";
  status: string;
  caption: string;
  notes: string | null;
  scheduledAt: Date | null;
  igCreationId: string | null;
  igMediaId: string | null;
  permalink: string | null;
  errorMessage: string | null;
  skipReason: string | null;
  attemptCount: number;
  publishedAt: Date | null;
};

function freshPost(overrides: Partial<Post> = {}): Post {
  return {
    id: "post-1",
    productId: "prod-1",
    productTitle: "منتج تجريبي",
    accountId: "acc-1",
    postType: "IMAGE",
    status: "SCHEDULED",
    caption: "كابشن تجريبي",
    notes: null,
    scheduledAt: new Date(Date.now() - 60_000), // due
    igCreationId: null,
    igMediaId: null,
    permalink: null,
    errorMessage: null,
    skipReason: null,
    attemptCount: 0,
    publishedAt: null,
    ...overrides,
  };
}

let post: Post;
let account: { id: string; igUserId: string; accessTokenEnc: string; status: string };
let mediaRows: Array<{ id: string; mediaAssetId: string; sortOrder: number; mediaAsset: { publicToken: string } }>;
let product: {
  id: string;
  deletedAt: Date | null;
  openingBalancePcs: number;
  cartonsAvailable: number;
  pcsPerCarton: number;
  warehouseStocks: Array<{ quantityPieces: number }>;
};
let fetchCalls: string[];

function applyData(target: Record<string, unknown>, data: Record<string, unknown>) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as Record<string, unknown>)) {
      target[k] = ((target[k] as number) ?? 0) + ((v as { increment: number }).increment);
    } else {
      target[k] = v;
    }
  }
}

const fakePrisma = {
  wholesaleInstagramPost: {
    updateMany: async ({ where, data }: any) => {
      if (where.id !== post.id) return { count: 0 };
      const allowed: string[] | null = where.status?.in ?? (where.status ? [where.status] : null);
      if (allowed && !allowed.includes(post.status)) return { count: 0 };
      applyData(post as unknown as Record<string, unknown>, data);
      return { count: 1 };
    },
    update: async ({ where, data }: any) => {
      if (where.id !== post.id) throw new Error("not found");
      applyData(post as unknown as Record<string, unknown>, data);
      return { ...post };
    },
    findUnique: async ({ where, include }: any) => {
      if (where.id !== post.id) return null;
      const result: any = { ...post };
      if (include?.account) result.account = { ...account };
      if (include?.media) result.media = mediaRows.map((m) => ({ ...m }));
      return result;
    },
    findMany: async ({ where }: any) => {
      if (where.status === "SCHEDULED" && post.status === "SCHEDULED" && post.scheduledAt && post.scheduledAt.getTime() <= Date.now()) {
        return [{ id: post.id }];
      }
      return [];
    },
  },
  product: {
    findUnique: async ({ where }: any) => (where.id === product.id ? { ...product } : null),
  },
};

mock.module("../config/database", { exports: { default: fakePrisma } });
mock.module("../utils/crypto", { exports: { decryptSecret: () => "fake-token", encryptSecret: (s: string) => s } });

const originalFetch = globalThis.fetch;

function installFetchStub() {
  fetchCalls = [];
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    fetchCalls.push(url);
    if (url.includes("/media_publish")) {
      return new Response(JSON.stringify({ id: "ig-media-1" }), { status: 200 });
    }
    if (url.includes("/media?") || (init?.method === "POST" && url.endsWith("/media"))) {
      return new Response(JSON.stringify({ id: "ig-container-1" }), { status: 200 });
    }
    if (url.includes("fields=permalink")) {
      return new Response(JSON.stringify({ permalink: "https://www.instagram.com/p/fake/" }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
}

let runWholesalePublish: (id: string) => Promise<void>;
let runWholesaleInstagramQueueTick: () => Promise<void>;

describe("wholesale Instagram — publish pipeline + stock gate", () => {
  before(async () => {
    ({ runWholesalePublish } = await import("./wholesale-instagram.service"));
    ({ runWholesaleInstagramQueueTick } = await import("./wholesale-instagram-queue.service"));
  });

  beforeEach(() => {
    post = freshPost();
    account = { id: "acc-1", igUserId: "ig-user-1", accessTokenEnc: "enc", status: "connected" };
    mediaRows = [{ id: "media-1", mediaAssetId: "asset-1", sortOrder: 0, mediaAsset: { publicToken: "tok-1" } }];
    product = { id: "prod-1", deletedAt: null, openingBalancePcs: 5, cartonsAvailable: 0, pcsPerCarton: 1, warehouseStocks: [] };
    installFetchStub();
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it("available product: tick claims a due SCHEDULED post and publishes it", async () => {
    await runWholesaleInstagramQueueTick();
    assert.equal(post.status, "PUBLISHED");
    assert.equal(post.igCreationId, "ig-container-1");
    assert.equal(post.igMediaId, "ig-media-1");
    assert.equal(post.permalink, "https://www.instagram.com/p/fake/");
    assert.ok(post.publishedAt);
  });

  it("zero-stock product: tick skips without ever calling Meta", async () => {
    product.openingBalancePcs = 0;
    await runWholesaleInstagramQueueTick();
    assert.equal(post.status, "SKIPPED_OUT_OF_STOCK");
    assert.equal(post.skipReason, "الكمية صفر بالمخزون");
    assert.equal(fetchCalls.length, 0, "must never reach Meta once stock is 0");
  });

  it("deleted product: tick skips with a clear reason, no Meta call", async () => {
    product.deletedAt = new Date();
    await runWholesaleInstagramQueueTick();
    assert.equal(post.status, "SKIPPED_OUT_OF_STOCK");
    assert.match(post.skipReason ?? "", /محذوف/);
    assert.equal(fetchCalls.length, 0);
  });

  it("skipped post is never picked up again automatically (no auto-retry)", async () => {
    product.openingBalancePcs = 0;
    await runWholesaleInstagramQueueTick();
    assert.equal(post.status, "SKIPPED_OUT_OF_STOCK");
    // Stock comes back, but the post is no longer SCHEDULED — another tick must not touch it.
    product.openingBalancePcs = 10;
    await runWholesaleInstagramQueueTick();
    assert.equal(post.status, "SKIPPED_OUT_OF_STOCK", "must stay skipped until an explicit reschedule/publish-now");
  });

  it("retry after Meta failure is idempotent: an already-published igMediaId is never republished", async () => {
    post.status = "PUBLISHING";
    post.igMediaId = "already-published-id";
    await runWholesalePublish(post.id);
    assert.equal(post.status, "PUBLISHED");
    assert.equal(fetchCalls.some((u) => u.includes("/media?") || u.endsWith("/media")), false, "must not recreate a container");
  });

  it("concurrent claim race: two overlapping ticks only publish once", async () => {
    // Two ticks fire back-to-back for the same due post — the atomic
    // conditional updateMany must let exactly one through.
    const results = await Promise.allSettled([runWholesaleInstagramQueueTick(), runWholesaleInstagramQueueTick()]);
    assert.equal(results.every((r) => r.status === "fulfilled"), true);
    assert.equal(post.status, "PUBLISHED");
    const publishCalls = fetchCalls.filter((u) => u.includes("/media_publish"));
    assert.equal(publishCalls.length, 1, "media_publish must fire exactly once, never twice for one post");
  });

  it("connected account required: FAILED (not SKIPPED) when the account itself is broken", async () => {
    account.status = "error";
    await runWholesaleInstagramQueueTick();
    assert.equal(post.status, "FAILED");
    assert.match(post.errorMessage ?? "", /غير مربوط|منتهي/);
  });
});
