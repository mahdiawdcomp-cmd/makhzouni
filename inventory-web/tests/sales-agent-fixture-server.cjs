/**
 * The rep screens' browser fixture: serves the BUILT app plus a canned `/api`.
 *
 * Exists so the offline/pending-order behaviour can be driven in a real browser
 * with no database, no backend and no production data. Every name and number in
 * here is invented for the test.
 *
 * Two knobs the test drives over HTTP:
 *  - `/__fixture/fail-orders?on=1` — make `POST /orders` answer 502, which is
 *    what an unconfirmed send looks like;
 *  - `/__fixture/role?admin=1` — swap the signed-in user for an owner.
 *
 * `/__fixture/order-keys` reports how many DISTINCT idempotency keys the server
 * has seen, which is how the test proves a retry did not create a second order.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const DIST = path.join(__dirname, "..", "dist");
const PORT = Number(process.env.FIXTURE_PORT || 4176);

const CUSTOMER = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "أسواق الربيع",
  phone: "07700000001",
  address: "شارع الجديدة، مقابل المدرسة",
  area: "الجديدة",
  province: "بغداد",
  currentBalance: 250000,
  lastTransactionAt: null,
  lastSaleAt: "2026-08-01T00:00:00.000Z",
  daysSinceLastSale: 44,
  latitude: 33.3152,
  longitude: 44.3661,
  followUpReasons: [
    { code: "QUIET", label: "ما اشترى من مدة", detail: "آخر شراء قبل 44 يوم" },
    { code: "BALANCE", label: "عليه رصيد" },
    { code: "OFFER_ENDING", label: "عنده عرض خاص قرب ينتهي", detail: "ينتهي بعد 3 يوم" },
  ],
};

const CUSTOMER_2 = {
  id: "22222222-2222-4222-8222-222222222223",
  name: "مكتبة النور",
  phone: "07700000002",
  address: "سوق الشعلة",
  area: "الشعلة",
  province: "بغداد",
  currentBalance: 0,
  lastTransactionAt: null,
  lastSaleAt: null,
  daysSinceLastSale: null,
  latitude: null,
  longitude: null,
  followUpReasons: [{ code: "NEVER_BOUGHT", label: "ما اشترى ولا مرة" }],
};

const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "مندوب الاختبار",
  username: "fixture",
  role: "STAFF",
  permissions: ["SALES_AGENT"],
  isActive: true,
};

const picture =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#f1f5f9"/><circle cx="200" cy="200" r="110" fill="#38bdf8"/></svg>',
  );

const products = Array.from({ length: 12 }, (_, i) => ({
  id: `33333333-3333-4333-8333-${String(i + 1).padStart(12, "0")}`,
  itemNumber: `P-${i + 1}`,
  name: `مادة فحص ${i + 1}`,
  category: i % 2 ? "منزليات" : "أطفال",
  categoryTags: [],
  typeTags: [],
  salePrice: 1000,
  cartonPiecePrice: 750,
  oldPrice: null,
  isOffer: i === 1,
  isNewArrival: i === 0,
  pcsPerCarton: 48,
  boxPieces: 24,
  hiddenUnits: [],
  hasImage: i !== 11,
  currentStock: 100,
}));

const USUAL = [
  {
    productId: products[0].id,
    productName: products[0].name,
    itemNumber: products[0].itemNumber,
    unit: "CARTON",
    times: 6,
    suggestedQuantity: 2,
    averageQuantity: 2,
    averageSampleSize: 3,
    averageMatchesPriceMode: true,
    stockCapped: false,
    lastPurchaseAt: "2026-08-01T00:00:00.000Z",
    availableStock: 100,
    pcsPerCarton: 48,
    boxPieces: 24,
    hasImage: true,
    currentPrice: 48000,
    catalogPrice: 48000,
    priceSource: "CATALOG",
    priceChange: {
      previousPrice: 40000,
      currentPrice: 48000,
      difference: 8000,
      percent: 20,
      direction: "UP",
      lastPurchaseAt: "2026-08-01T00:00:00.000Z",
    },
  },
  {
    productId: products[1].id,
    productName: products[1].name,
    itemNumber: products[1].itemNumber,
    unit: "DOZEN",
    times: 3,
    suggestedQuantity: 5,
    averageQuantity: 4.6,
    averageSampleSize: 3,
    averageMatchesPriceMode: true,
    stockCapped: false,
    lastPurchaseAt: "2026-09-01T00:00:00.000Z",
    availableStock: 100,
    pcsPerCarton: 48,
    boxPieces: 24,
    hasImage: true,
    currentPrice: 10800,
    catalogPrice: 12000,
    priceSource: "OFFER",
    offer: { id: "offer-1", endsAt: "2026-09-18T00:00:00.000Z", endsOnDate: "2026-09-17", note: "اتفاق موسمي" },
    priceChange: {
      previousPrice: 12000,
      currentPrice: 10800,
      difference: -1200,
      percent: -10,
      direction: "DOWN",
      lastPurchaseAt: "2026-09-01T00:00:00.000Z",
    },
  },
];

const OFFERS = [
  {
    id: "offer-1",
    customerId: CUSTOMER.id,
    customerName: CUSTOMER.name,
    productId: products[1].id,
    productName: products[1].name,
    unit: "DOZEN",
    priceMode: "WHOLESALE",
    discountType: "PERCENT",
    fixedPrice: null,
    discountPercent: 10,
    startsAt: "2026-09-01T00:00:00.000Z",
    endsAt: "2026-09-18T00:00:00.000Z",
    startsOnDate: "2026-09-01",
    endsOnDate: "2026-09-17",
    isActive: true,
    note: "اتفاق موسمي",
    catalogPrice: 12000,
    offerPrice: 10800,
    isLive: true,
    state: "LIVE",
  },
];

// Flipped by the test to prove an unconfirmed send leaves a pending attempt.
let failOrders = false;
let orderKeys = new Set();
// The owner's plan for the fixture rep, mutated by the admin-screen test.
let adminPlan = [];

function send(res, data, status = 200) {
  const body = JSON.stringify({ success: status < 400, data, ...(status >= 400 ? { message: "فحص: فشل مصطنع", code: "FIXTURE_FAIL" } : {}) });
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${server.address()?.port ?? PORT}`);
  const p = url.pathname;

  // Local fixture only: the static app is served on one port and the baked-in
  // API base points at another, so the browser treats them as cross-origin.
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (p === "/__fixture/role") {
    USER.role = url.searchParams.get("admin") === "1" ? "ADMIN" : "STAFF";
    USER.permissions = url.searchParams.get("admin") === "1" ? ["MANAGE_CUSTOMER_OFFERS"] : ["SALES_AGENT"];
    return send(res, USER);
  }

  if (p === "/__fixture/order-keys") {
    return send(res, { distinctKeys: orderKeys.size });
  }

  if (p === "/__fixture/reset") {
    failOrders = false;
    orderKeys = new Set();
    adminPlan = [];
    return send(res, { reset: true });
  }

  if (p === "/__fixture/fail-orders") {
    failOrders = url.searchParams.get("on") === "1";
    return send(res, { failOrders });
  }

  if (p.startsWith("/api/")) {
    // PATCH carries a body too — the plan screen sends status/note/sortOrder
    // that way, and skipping it made every PATCH a silent no-op.
    const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : {};
    if (p === "/api/realtime/events") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      return res.end(": fixture\n\n");
    }
    if (p === "/api/auth/me") return send(res, USER);
    if (p === "/api/settings") return send(res, {});
    if (p === "/api/health/system") {
      const ok = { level: "ok", message: "فحص" };
      return send(res, { db: ok, whatsapp: ok, campaigns: ok, cron: ok, backup: ok });
    }
    if (p === "/api/sales-agent/areas") return send(res, ["الجديدة", "الشعلة"]);
    if (p === "/api/sales-agent/today")
      return send(res, { orders: 2, rejectedOrders: 0, rejectedValue: 0, orderValue: 96000, receipts: 1, collected: 25000, issues: 0, newCustomers: 0, customersVisited: 1 });
    if (p === "/api/sales-agent/products") return send(res, products);
    if (p === "/api/sales-agent/products/thumbnails")
      return send(res, Object.fromEntries((body.ids ?? []).map((id) => [id, picture])));
    if (p === "/api/sales-agent/customers") {
      const area = url.searchParams.get("area");
      const list = [CUSTOMER, CUSTOMER_2].filter((c) => !area || c.area === area);
      return send(res, { total: list.length, page: 1, limit: 200, hasMore: false, quietDays: 45, customers: list });
    }
    if (/\/header$/.test(p)) return send(res, { ...CUSTOMER, lastPayment: { amount: 50000, date: "2026-09-10T00:00:00.000Z" } });
    // «كشف الحساب»: one sale and one receipt, oldest first as the server sends it.
    if (/\/customers\/[^/]+\/detail$/.test(p))
      return send(res, {
        customer: { id: CUSTOMER.id, name: CUSTOMER.name, openingBalance: 0 },
        transactions: [
          { id: "33333333-3333-4333-8333-333333333333", date: "2026-09-01T00:00:00.000Z", type: "INVOICE", invoiceType: "SALE", amount: 300000, referenceNumber: "INV-1", status: "ACTIVE", runningBalance: 300000, mine: true, pending: null },
          { id: "44444444-4444-4444-8444-444444444444", date: "2026-09-10T00:00:00.000Z", type: "RECEIPT", invoiceType: null, amount: 50000, referenceNumber: "REC-1", status: "ACTIVE", runningBalance: 250000, mine: true, pending: null },
        ],
      });
    if (/\/usable-prices$/.test(p)) return send(res, []);
    if (/\/frequent-products$/.test(p)) return send(res, { priceMode: url.searchParams.get("priceMode") ?? "WHOLESALE", products: USUAL });
    if (/\/customers\/[^/]+\/offers$/.test(p)) return send(res, { total: 1, page: 1, limit: 50, hasMore: false, offers: OFFERS });
    if (p === "/api/sales-agent/visits/customers")
      return send(res, {
        total: 2,
        page: 1,
        limit: 200,
        hasMore: false,
        customers: [
          { ...CUSTOMER, distanceKm: 1.4, todayVisit: null },
          { ...CUSTOMER_2, distanceKm: null, todayVisit: null },
        ],
      });
    // «خطة زيارات اليوم» — one planned stop, not yet visited.
    if (p === "/api/sales-agent/visits/plan")
      return send(res, {
        date: "2026-09-14",
        timezone: "Asia/Baghdad",
        entries: [
          {
            id: "99999999-9999-4999-8999-999999999999",
            salesAgentId: USER.id,
            customerId: CUSTOMER.id,
            customerName: CUSTOMER.name,
            customerPhone: CUSTOMER.phone,
            address: CUSTOMER.address,
            area: CUSTOMER.area,
            latitude: CUSTOMER.latitude,
            longitude: CUSTOMER.longitude,
            currentBalance: CUSTOMER.currentBalance,
            planDate: "2026-09-14",
            sortOrder: 1,
            note: "يحتاج متابعة",
            status: "PLANNED",
            statusLabel: "مخطط",
            visit: null,
          },
        ],
      });
    if (p === "/api/sales-agent/visits/plan-statuses")
      return send(res, [
        { code: "PLANNED", label: "مخطط" },
        { code: "DONE", label: "اكتملت" },
      ]);
    if (p === "/api/sales-agent/visits/today") return send(res, { date: "2026-09-14", timezone: "Asia/Baghdad", visits: [] });
    if (p === "/api/sales-agent/visits/outcomes")
      return send(res, [{ code: "ORDERED", label: "أخذ طلب" }, { code: "NO_ORDER", label: "ما طلب" }]);
    if (p === "/api/sales-agent/visits" && req.method === "POST")
      return send(res, { id: "visit-1", startedAt: new Date().toISOString(), endedAt: null, outcome: null, customerId: body.customerId, duplicate: false }, 201);
    if (p === "/api/sales-agent/orders/preview") {
      const pieces = { CARTON: 48, BOX: 24, DOZEN: 12, PIECE: 1 };
      const items = (body.items ?? []).map((i) => {
        const prod = products.find((x) => x.id === i.productId) ?? products[0];
        const base = (body.priceMode === "CARTON" ? prod.cartonPiecePrice : prod.salePrice) * pieces[i.unit];
        const offered = prod.id === products[1].id && body.priceMode !== "CARTON" ? Math.round(base * 0.9) : base;
        return {
          productId: prod.id,
          productName: prod.name,
          unit: i.unit,
          quantity: i.quantity,
          unitPrice: offered,
          totalPrice: offered * i.quantity,
          // Deliberately different from the catalog's 100, to prove the review
          // reports what moved.
          availableStock: 80,
          priceSource: offered === base ? "CATALOG" : "OFFER",
          ...(offered === base
            ? {}
            : { offer: { id: "offer-1", endsAt: "2026-09-17T00:00:00.000Z", discountType: "PERCENT", discountPercent: 10, note: "اتفاق موسمي", catalogPrice: base } }),
          priceChange: {
            previousPrice: Math.round(base * 0.8),
            currentPrice: offered,
            difference: offered - Math.round(base * 0.8),
            percent: 25,
            direction: "UP",
            lastPurchaseAt: "2026-08-01T00:00:00.000Z",
          },
        };
      });
      return send(res, {
        reviewToken: "a".repeat(64),
        customerName: CUSTOMER.name,
        customerPhone: CUSTOMER.phone,
        customerBalance: CUSTOMER.currentBalance,
        priceMode: body.priceMode ?? "WHOLESALE",
        notes: body.notes ?? "",
        subtotal: items.reduce((s, i) => s + i.totalPrice, 0),
        items,
        shortages: [{ productId: items[0]?.productId, productName: items[0]?.productName ?? "", requested: 96, available: 80, short: 16 }],
        pricedAt: new Date().toISOString(),
      });
    }
    if (p === "/api/sales-agent/orders" && req.method === "POST") {
      if (failOrders) {
        // A gateway-shaped failure: proves nothing about whether it landed, so
        // the attempt must stay pending with its key.
        return send(res, null, 502);
      }
      orderKeys.add(body.clientRequestId);
      return send(res, { approvalId: "approval-1", subtotal: 0, lineCount: (body.items ?? []).length, shortages: [], duplicate: false, fixtureDistinctKeys: orderKeys.size });
    }
    if (p === "/api/sales-agent/orders") return send(res, []);
    if (p === "/api/sales-agent/cash-on-hand") return send(res, { collected: 25000, handedOver: 15000, onHand: 10000 });
    /* ── owner side: «خطة زيارات المندوب» ─────────────────────────── */
    if (p === "/api/sales-agent-admin/liability")
      return send(res, [
        { agentId: USER.id, name: "مندوب الاختبار", username: "fixture", phone: null, isActive: true, collected: 25000, handedOver: 15000, onHand: 10000, overHanded: false },
      ]);
    if (p === "/api/sales-agent-admin/handovers") return send(res, []);
    // «إشعارات المندوبين», «صلاحيات تعديل المندوب», «يومه» — the real shapes, so
    // the admin-screen test renders these panels instead of skipping past them.
    if (p === "/api/sales-agent-admin/activity/counts") return send(res, { unread: 1, importantUnread: 1 });
    if (p === "/api/sales-agent-admin/activity")
      return send(res, {
        items: [
          {
            id: "a1111111-1111-4111-8111-111111111111",
            salesAgentId: USER.id,
            agentName: "مندوب الاختبار",
            kind: "EDIT_REQUEST",
            customerId: null,
            referenceId: null,
            approvalId: "b1111111-1111-4111-8111-111111111111",
            title: "طلب تعديل سند قبض",
            message: "طلب تعديل سند قبض — ينتظر موافقتك",
            important: true,
            amount: 15000,
            read: false,
            createdAt: new Date().toISOString(),
          },
        ],
        nextBefore: null,
        unread: 1,
        importantUnread: 1,
      });
    if (p === "/api/sales-agent-admin/edit-modes")
      return send(res, [{ agentId: USER.id, name: "مندوب الاختبار", isActive: true, INVOICE_EDIT: "DIRECT", INVOICE_CANCEL: "APPROVAL" }]);
    if (p === "/api/sales-agent-admin/agent-day")
      return send(res, {
        date: new Date().toISOString().slice(0, 10),
        agentName: "مندوب الاختبار",
        events: [],
        startedAt: null,
        endedAt: null,
        spanMin: 0,
        gaps: [],
        idleMin: 0,
        counts: { orders: 0, rejectedOrders: 0, receipts: 0, visits: 0, issues: 0, newCustomers: 0, customersVisited: 0 },
        money: { sold: 0, collected: 0, rejectedValue: 0 },
        location: { withFix: 0, denied: 0, unavailable: 0, far: 0, vague: 0 },
        areas: [],
      });
    // The shapes these panels actually read — an array of commission rows, and
    // five/five arrays for the health and issue reports. A wrong shape here
    // crashes the page, which is its own kind of useful test.
    if (p === "/api/sales-agent-admin/commission")
      return send(res, [
        {
          agentId: USER.id,
          agentName: "مندوب الاختبار",
          month: "2026-09",
          dateBasis: "invoice",
          invoiceCount: 1,
          sold: 96000,
          collectedInHand: 25000,
          collectedFromOwnCustomers: 25000,
          collectedFromOtherCustomers: 0,
          ratePercent: null,
          onSold: null,
          onCollectedInHand: null,
          onCollectedFromOwn: null,
          settled: null,
        },
      ]);
    if (p === "/api/sales-agent-admin/health")
      return send(res, {
        negativeLiability: [],
        inactiveWithMoney: [],
        cancelledReceipts: [],
        staleApprovedPrices: [],
        collectionsFromOthersCustomers: [],
      });
    if (p === "/api/sales-agent-admin/issue-reports")
      return send(res, { total: 0, byReason: [], priceRefusals: [], byCustomer: [], competitors: [] });
    if (p === "/api/sales-agent-admin/issues") return send(res, []);
    if (p === "/api/sales-agent-admin/settlements") return send(res, []);
    if (p === "/api/sales-agent-admin/agent-customers") {
      const term = (url.searchParams.get("search") || "").trim();
      const area = url.searchParams.get("area");
      const pool = [CUSTOMER, CUSTOMER_2]
        .filter((c) => !area || c.area === area)
        .filter((c) => !term || c.name.includes(term) || c.phone.includes(term));
      return send(
        res,
        pool.map((c) => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          area: c.area,
          address: c.address,
          currentBalance: c.currentBalance,
          hasLocation: c.latitude != null,
        })),
      );
    }
    if (p === "/api/sales-agent-admin/visit-plan" && req.method === "POST") {
      // The duplicate rule the real unique index enforces.
      if (adminPlan.some((e) => e.customerId === body.customerId)) {
        return send(res, null, 409);
      }
      const source = [CUSTOMER, CUSTOMER_2].find((c) => c.id === body.customerId) ?? CUSTOMER;
      adminPlan.push({
        id: `plan-${adminPlan.length + 1}`,
        salesAgentId: USER.id,
        customerId: source.id,
        customerName: source.name,
        customerPhone: source.phone,
        address: source.address,
        area: source.area,
        latitude: source.latitude,
        longitude: source.longitude,
        currentBalance: source.currentBalance,
        planDate: body.planDate || "2026-09-14",
        sortOrder: adminPlan.length + 1,
        note: body.note ?? null,
        status: "PLANNED",
        statusLabel: "مخطط",
        visit: null,
      });
      return send(res, adminPlan[adminPlan.length - 1], 201);
    }
    if (/^\/api\/sales-agent-admin\/visit-plan\/[^/]+$/.test(p) && req.method === "PATCH") {
      const id = p.split("/").pop();
      const entry = adminPlan.find((e) => e.id === id);
      if (!entry) return send(res, null, 404);
      if (typeof body.status === "string") {
        entry.status = body.status;
        entry.statusLabel = { PLANNED: "مخطط", STARTED: "بدأت", DONE: "اكتملت", CANCELLED: "أُلغيت" }[body.status] ?? body.status;
      }
      if (body.note !== undefined) entry.note = body.note || null;
      if (body.sortOrder !== undefined) entry.sortOrder = Number(body.sortOrder);
      adminPlan.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      return send(res, entry);
    }
    if (p === "/api/sales-agent-admin/visit-plan")
      return send(res, { date: url.searchParams.get("date") || "2026-09-14", timezone: "Asia/Baghdad", entries: adminPlan });

    if (p === "/api/customer-offers") return send(res, { total: 1, page: 1, limit: 200, hasMore: false, offers: OFFERS });
    return send(res, []);
  }

  // Static files, SPA fallback to index.html.
  const rel = p === "/" ? "/index.html" : p;
  const file = path.join(DIST, rel);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file);
    const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
    res.writeHead(200, { "content-type": (types[ext] ?? "application/octet-stream") + (ext === ".html" ? "; charset=utf-8" : "") });
    return res.end(fs.readFileSync(file));
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(path.join(DIST, "index.html")));
});

// `FIXTURE_PORT=0` lets the OS pick a free port, which is how two test files
// can run without fighting over one number — and how a stale process from an
// earlier crashed run cannot block a fresh one. The chosen port is printed so
// the caller can read it back.
server.listen(PORT, "127.0.0.1", () => {
  const actual = server.address().port;
  console.log(`fixture server on http://127.0.0.1:${actual}`);
});

server.on("error", (err) => {
  console.error(`fixture server failed: ${err.message}`);
  process.exit(1);
});
