import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// ── In-memory fakes ──────────────────────────────────────────────────────────
// The Claude client is stubbed with a scripted queue of responses, so the tool
// loop is exercised end-to-end without a single network call. Same prisma-fake
// style as retail-prepare.test.ts.

type ApiResponse = { content: Array<Record<string, unknown>> };

let scripted: ApiResponse[] = [];
let apiCalls: Array<{ messages: any[]; system?: string; model?: string }> = [];

function toolCall(name: string, args: Record<string, unknown>, id = `call_${name}`): ApiResponse {
  return { content: [{ type: "tool_use", id, name, input: args }] };
}
function textReply(text: string): ApiResponse {
  return { content: [{ type: "text", text }] };
}

/** Tool results now come back as tool_result blocks inside a user message. */
function toolResultsOf(call: { messages: any[] }): Array<Record<string, any>> {
  return call.messages
    .filter((m: any) => m.role === "user" && Array.isArray(m.content))
    .flatMap((m: any) => m.content)
    .filter((b: any) => b?.type === "tool_result");
}

let products: Array<Record<string, unknown>>;
let requestedRows: Array<Record<string, unknown>>;
let escalationRows: Array<Record<string, unknown>>;
let invoiceRows: Array<Record<string, any>>;
let recordedErrors: Array<Record<string, any>>;
let aiChatRow: { phone: string; messages: unknown; updatedAt: Date; repliesToday?: number; todayKey?: string | null } | null;
let sentTexts: Array<{ phone: string; text: string }>;
let sentImages: Array<{ phone: string; caption: string; bytes: number }>;
let sentPdfs: Array<{ phone: string; caption: string; filename: string }>;
let voucherRows: Array<Record<string, any>>;
let portalLinksMinted: string[];
/** Set to make an invoice PDF render blow up (the failure path). */
let invoicePdfImpl: null | (() => Promise<Buffer>) = null;
let memoryRows: Array<Record<string, any>>;
let settingsRow: Record<string, any>;
/** A real 1x1 PNG — sharp actually re-encodes it, no image mocking needed. */
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
/** Set to simulate a send that never resolves (the real bug). */
let sendImageImpl: null | (() => Promise<unknown>) = null;

function freshProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod-1",
    name: "اوربيز ناشف",
    itemNumber: "1001",
    qrCode: null,
    cartonQrCode: null,
    category: "العاب",
    categoryTags: [] as string[],
    typeTags: [] as string[],
    isNewArrival: false,
    isOffer: false,
    pcsPerCarton: 24,
    boxPieces: 12,
    openingBalancePcs: 100,
    cartonsAvailable: 0,
    imageUrl: `data:image/jpeg;base64,${Buffer.from("fake-image-bytes-full-size").toString("base64")}`,
    mediumUrl: `data:image/jpeg;base64,${Buffer.from("smaller").toString("base64")}`,
    catalogDescription: "وصف تجريبي",
    warehouseStocks: [] as Array<{ quantityPieces: number }>,
    deletedAt: null,
    ...overrides,
  };
}

const fakePrisma = {
  product: {
    findMany: async () => products.map((p) => ({ ...p })),
    findFirst: async ({ where }: any) => {
      const found = products.find((p) => p.id === where.id && !p.deletedAt);
      return found ? { ...found } : null;
    },
  },
  requestedProduct: {
    findFirst: async ({ where }: any) =>
      requestedRows.find((r) => r.normalizedName === where.normalizedName && r.status === where.status) ?? null,
    create: async ({ data }: any) => {
      const row = { id: `req-${requestedRows.length + 1}`, requestCount: 1, status: "OPEN", ...data };
      requestedRows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = requestedRows.find((r) => r.id === where.id)!;
      if (data.requestCount?.increment) row.requestCount = (row.requestCount as number) + data.requestCount.increment;
      for (const [k, v] of Object.entries(data)) if (k !== "requestCount") row[k] = v;
      return row;
    },
  },
  invoice: {
    // Every agent invoice read is scoped by customerId — the fake enforces it
    // too, so a test that forgets the scope fails instead of quietly passing.
    findMany: async ({ where, take }: any) =>
      invoiceRows.filter((r) => r.customerId === where.customerId).slice(0, take ?? invoiceRows.length),
    findFirst: async ({ where }: any) =>
      invoiceRows.find(
        (r) => r.customerId === where.customerId && (!where.invoiceNumber || r.invoiceNumber === where.invoiceNumber),
      ) ?? null,
  },
  paymentVoucher: {
    findFirst: async ({ where }: any) =>
      voucherRows.find(
        (v) => v.customerId === where.customerId && v.type === where.type && !v.cancelledAt && !v.archivedAt,
      ) ?? null,
  },
  errorLog: {
    findFirst: async () => null,
    create: async ({ data }: any) => { recordedErrors.push(data); return data; },
    update: async () => ({}),
  },
  aiEscalation: {
    create: async ({ data }: any) => {
      const row = { id: `esc-${escalationRows.length + 1}`, alertedAt: null, ...data };
      escalationRows.push(row);
      return row;
    },
    findFirst: async ({ where }: any) =>
      escalationRows.find(
        (r) =>
          r.phone === where.phone &&
          r.kind === where.kind &&
          r.alertedAt &&
          r.alertedAt.getTime() >= where.alertedAt.gte.getTime(),
      ) ?? null,
    update: async ({ where, data }: any) => {
      const row = escalationRows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
  },
  whatsappAiMemory: {
    findMany: async ({ where, take }: any) => {
      const rows = memoryRows
        .filter((r) => r.phone === where.phone)
        .sort((a, b) => a.createdAt - b.createdAt);
      return take ? rows.slice(0, take) : rows;
    },
    upsert: async ({ where, create, update }: any) => {
      const key = where.phone_normalized;
      const found = memoryRows.find((r) => r.phone === key.phone && r.normalized === key.normalized);
      if (found) {
        Object.assign(found, update);
        return found;
      }
      const row = { id: `mem-${memoryRows.length + 1}`, createdAt: memoryRows.length, ...create };
      memoryRows.push(row);
      return row;
    },
    deleteMany: async ({ where }: any) => {
      const ids: string[] = where.id.in;
      memoryRows = memoryRows.filter((r) => !ids.includes(r.id));
      return { count: ids.length };
    },
  },
  whatsappAiChat: {
    findUnique: async ({ where }: any) => (aiChatRow && aiChatRow.phone === where.phone ? { ...aiChatRow } : null),
    upsert: async ({ where, create, update }: any) => {
      const prev = aiChatRow && aiChatRow.phone === where.phone ? aiChatRow : null;
      aiChatRow = {
        phone: where.phone,
        messages: update.messages ?? prev?.messages ?? create.messages,
        updatedAt: new Date(),
        repliesToday: update.repliesToday ?? prev?.repliesToday ?? create.repliesToday ?? 0,
        todayKey: update.todayKey ?? prev?.todayKey ?? create.todayKey ?? null,
        imagesToday: update.imagesToday ?? prev?.imagesToday ?? create.imagesToday ?? 0,
        aiMutedUntil:
          "aiMutedUntil" in update ? update.aiMutedUntil : prev?.aiMutedUntil ?? create.aiMutedUntil ?? null,
      };
      return aiChatRow;
    },
    updateMany: async ({ where, data }: any) => {
      if (aiChatRow && aiChatRow.phone === where.phone) Object.assign(aiChatRow, data);
      return { count: 1 };
    },
    deleteMany: async () => {
      aiChatRow = null;
      return { count: 1 };
    },
  },
};

mock.module("../config/database", { exports: { default: fakePrisma } });
mock.module("./whatsapp.service", {
  exports: {
    sendWhatsAppText: async (phone: string, text: string) => {
      sentTexts.push({ phone, text });
      return { to: phone };
    },
    sendWhatsAppImage: async (phone: string, caption: string, image: Buffer) => {
      if (sendImageImpl) return sendImageImpl();
      sentImages.push({ phone, caption, bytes: image.length });
      return { to: phone };
    },
    sendWhatsAppPdf: async (phone: string, caption: string, _pdf: Buffer, filename: string) => {
      sentPdfs.push({ phone, caption, filename });
      return { to: phone, filename };
    },
  },
});
// Mocking "@anthropic-ai/sdk" directly does NOT work here — the CJS
// default-import interop this project compiles to bypasses it, the real SDK
// loads, and the suite silently makes live API calls. Mocking the local seam
// does work (this bit the first version of this file).
const fakeAnthropic = {
  messages: {
    create: async ({ messages, system, model }: any) => {
      apiCalls.push({ messages, system, model });
      const next = scripted.shift();
      if (!next) throw new Error("no scripted completion left");
      return next;
    },
  },
};
mock.module("./settings.service", {
  exports: {
    getSettings: async () => ({
      ...settingsRow,
      storeName: "مهدي عوض",
      catalogPublicUrl: "https://mahdi.mazbwoni.com/catalog",
      catalogDesignFooterAddress: "كربلاء شارع العباس",
      catalogDesignFooterHours: "كل يوم من الساعة 7 صباحا الى الساعة 12 ليلاً",
      catalogDesignFooterPhone: "07860333033",
      catalogDesignFooterDeliveryAreas: "جميع المحافظات",
      catalogDesignFooterDeliveryTime: "من يوم الى يومين",
      catalogDesignFooterMinOrder: "150000",
      catalogDesignFooterCashOnDelivery: true,
      catalogDesignFooterAbout: "",
    }),
  },
});
mock.module("../utils/anthropic-client", { exports: { getAnthropicClient: () => fakeAnthropic } });
mock.module("./invoice-export.service", {
  exports: {
    generateInvoicePdf: async () => (invoicePdfImpl ? invoicePdfImpl() : Buffer.from("fake-invoice-pdf")),
  },
});
mock.module("./voucher-export.service", {
  exports: { generateVoucherPdf: async () => Buffer.from("fake-voucher-pdf") },
});
mock.module("./statement-export.service", {
  exports: { generateCustomerStatementPdf: async () => Buffer.from("fake-statement-pdf") },
});
mock.module("./customer-portal.service", {
  exports: {
    createCustomerPortalLink: async (customerId: string) => {
      portalLinksMinted.push(customerId);
      return { token: "cpl_test", urlPath: "/client/cpl_test", expiresAt: null, customer: { id: customerId } };
    },
  },
});

/** Same Baghdad day key the service computes, so cap tests line up. */
function baghdadToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

let runWhatsAppAiTurn: (input: {
  phone: string;
  text: string;
  images?: string[];
  customer: { id: string; name: string; currentBalance: unknown } | null;
}) => Promise<"replied" | "skipped" | "unavailable">;
let muteAiAgent: (phone: string, minutes?: number) => Promise<Date | null>;
let unmuteAiAgent: (phone: string) => Promise<void>;

describe("«الموظف الذكي» — WhatsApp AI agent", () => {
  before(async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    // Short deadline so the hang test doesn't sit for the production 25s.
    process.env.AI_IMAGE_SEND_TIMEOUT_MS = "50";
    ({ runWhatsAppAiTurn, muteAiAgent, unmuteAiAgent } = await import("./whatsapp-ai-agent.service"));
  });

  beforeEach(() => {
    scripted = [];
    apiCalls = [];
    products = [freshProduct()];
    requestedRows = [];
    escalationRows = [];
    recordedErrors = [];
    invoiceRows = [{
      id: "inv-1",
      customerId: "cust-1",
      invoiceNumber: "INV-1",
      createdAt: new Date("2026-09-01T10:00:00Z"),
      items: [{ quantity: 2, unit: "CARTON", productName: "تكتك كبير", product: { name: "تكتك كبير" } }],
    }, {
      id: "inv-2",
      customerId: "cust-1",
      invoiceNumber: "INV-2",
      createdAt: new Date("2026-08-20T10:00:00Z"),
      items: [{ quantity: 1, unit: "CARTON", productName: "اوربيز", product: { name: "اوربيز ناشف" } }],
    }, {
      // Belongs to somebody else — nothing the agent does may ever reach it.
      id: "inv-other",
      customerId: "cust-2",
      invoiceNumber: "INV-999",
      createdAt: new Date("2026-09-05T10:00:00Z"),
      items: [],
    }];
    voucherRows = [{ id: "vou-1", customerId: "cust-1", voucherNumber: "REC-77", type: "RECEIPT", cancelledAt: null, archivedAt: null }];
    sentPdfs = [];
    portalLinksMinted = [];
    invoicePdfImpl = null;
    memoryRows = [];
    settingsRow = { aiAgentMuteMinutes: 60, aiUpsetAlertPhone: "9647800000000" };
    aiChatRow = null;
    sentTexts = [];
    sentImages = [];
    sendImageImpl = null;
  });

  it("plain greeting: replies with generated text, no tools needed", async () => {
    scripted = [textReply("وعليكم السلام 👋 امرك؟")];
    const handled = await runWhatsAppAiTurn({ phone: "9647700000000", text: "سلام عليكم", customer: null });
    assert.equal(handled, "replied");
    assert.equal(sentTexts.length, 1);
    assert.equal(sentTexts[0].text, "وعليكم السلام 👋 امرك؟");
  });

  it("product question: search tool sees the item and never exposes a price", async () => {
    scripted = [toolCall("search_products", { query: "اوربيز" }), textReply("إي موجود، الكارتون بيه ٢٤ قطعة")];
    const handled = await runWhatsAppAiTurn({ phone: "9647700000000", text: "شكو عدكم اوربيز؟", customer: null });
    assert.equal(handled, "replied");

    // The tool result handed to the model is the contract that protects prices.
    const toolMessages = toolResultsOf(apiCalls[1]);
    assert.equal(toolMessages.length, 1);
    const payload = JSON.parse((toolMessages[0] as any).content);
    assert.equal(payload.products[0].name, "اوربيز ناشف");
    assert.equal(payload.products[0].pcsPerCarton, 24);
    assert.equal(payload.products[0].available, true);
    assert.equal("price" in payload.products[0], false, "no price may ever reach the model");
    assert.equal("salePrice" in payload.products[0], false);
  });

  it("colloquial wording finds the shop's descriptive name (سلاح كبريت → بندقية طلق كبريت جنطة)", async () => {
    // The shop's real complaint: the strict shared scorer required EVERY word,
    // so "سلاح كبريت" scored 0 against "بندقية طلق كبريت جنطة" and the agent
    // told a customer it didn't exist.
    products = [freshProduct({ id: "gun-1", name: "بندقية طلق كبريت جنطة", itemNumber: "2001" })];
    scripted = [toolCall("search_products", { query: "سلاح كبريت" }), textReply("تقصد بندقية طلق كبريت جنطة؟ موجودة")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "اريد سلاح كبريت", customer: null });

    const payload = JSON.parse(toolResultsOf(apiCalls[1])[0].content);
    assert.equal(payload.found, 1, "a partial word match must still surface the product");
    assert.equal(payload.products[0].name, "بندقية طلق كبريت جنطة");
    assert.ok(payload.hint, "a partial match must warn the model to verify, not assume");
  });

  it("plural and feminine forms match the singular/masculine name (حلقات ايرانية → حلق ايراني)", async () => {
    // Live failure: the shop stocks «حلق كبير ايراني» and «حلق صغير ايراني»,
    // a customer asked «متوفر حلقات ايرانية بمختلف احجام», and the agent said
    // there were none. `includes` only matched when the CUSTOMER's word was
    // the shorter one, and here it was the longer inflected form.
    products = [
      freshProduct({ id: "ring-big", name: "حلق كبير ايراني", itemNumber: "3001", category: null }),
      freshProduct({ id: "ring-small", name: "حلق صغير ايراني", itemNumber: "3002", category: "اولاد" }),
    ];
    scripted = [toolCall("search_products", { query: "حلقات ايرانية" }), textReply("عدنا حلق ايراني كبير وصغير")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "متوفر حلقات ايرانية بمختلف احجام", customer: null });

    const payload = JSON.parse(toolResultsOf(apiCalls[1])[0].content);
    assert.equal(payload.found, 2, "both sizes must come back, not zero results");
    const names = payload.products.map((p: any) => p.name).sort();
    assert.deepEqual(names, ["حلق صغير ايراني", "حلق كبير ايراني"]);
    assert.equal(payload.hint, undefined, "a full word match is not a weak match");
  });

  it("the definite article doesn't break matching (الحلقات → حلق)", async () => {
    products = [freshProduct({ name: "حلق كبير ايراني", itemNumber: "3001" })];
    scripted = [toolCall("search_products", { query: "الحلقات" }), textReply("عدنا")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "عدكم الحلقات؟", customer: null });
    assert.equal(JSON.parse(toolResultsOf(apiCalls[1])[0].content).found, 1);
  });

  it("no match at all hands back the shop's own category words instead of giving up", async () => {
    products = [freshProduct({ name: "بندقية طلق كبريت جنطة", category: "أسلحة أطفال", categoryTags: ["العاب"], typeTags: ["كبريت"] })];
    scripted = [toolCall("search_products", { query: "دراجة هوائية" }), textReply("ما لكيت، تريد أبلغ الإدارة؟")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "عدكم دراجة هوائية؟", customer: null });

    const payload = JSON.parse(toolResultsOf(apiCalls[1])[0].content);
    assert.equal(payload.found, 0);
    assert.ok(Array.isArray(payload.shopCategories), "the model needs the shop's vocabulary to retry with");
    assert.ok(payload.shopCategories.includes("أسلحة أطفال"));
  });

  it("a concept word matches through category/tags even when the name never uses it", async () => {
    products = [freshProduct({ name: "بندقية طلق كبريت جنطة", category: "أسلحة أطفال", categoryTags: [], typeTags: [] })];
    scripted = [toolCall("search_products", { query: "أسلحة" }), textReply("عدنا هاي")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "شنو عدكم بالاسلحة؟", customer: null });

    const payload = JSON.parse(toolResultsOf(apiCalls[1])[0].content);
    assert.equal(payload.found, 1, "category text must be searchable, not just the name");
  });

  it("out-of-stock product still reports availability honestly", async () => {
    products = [freshProduct({ openingBalancePcs: 0, cartonsAvailable: 0 })];
    scripted = [toolCall("search_products", { query: "اوربيز" }), textReply("خلص حالياً")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "اكو اوربيز؟", customer: null });
    const payload = JSON.parse(toolResultsOf(apiCalls[1])[0].content);
    assert.equal(payload.products[0].available, false);
  });

  it("image request: actually sends the photo over WhatsApp", async () => {
    scripted = [toolCall("send_product_image", { productId: "prod-1", caption: "اوربيز ناشف" }), textReply("أرسلتلك الصورة 👍")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "ارسلي صورة", customer: null });
    assert.equal(sentImages.length, 1);
    assert.equal(sentImages[0].phone, "9647700000000");
    assert.ok(sentImages[0].bytes > 0);
  });

  it("account question from a registered customer is answered from the DB", async () => {
    scripted = [toolCall("get_my_account", {}), textReply("رصيدك 50,000 د.ع")];
    await runWhatsAppAiTurn({
      phone: "9647700000000",
      text: "شكد رصيدي",
      customer: { id: "cust-1", name: "أحمد", currentBalance: 50000 },
    });
    const payload = JSON.parse(toolResultsOf(apiCalls[1])[0].content);
    assert.equal(payload.registered, true);
    assert.equal(payload.balanceText, "50,000 د.ع");
  });

  it("account question from an unknown number never invents an account", async () => {
    scripted = [toolCall("get_my_account", {}), textReply("رقمك مو مسجّل عدنا")];
    await runWhatsAppAiTurn({ phone: "9647711111111", text: "شكد رصيدي", customer: null });
    const payload = JSON.parse(toolResultsOf(apiCalls[1])[0].content);
    assert.equal(payload.registered, false);
    assert.equal("balanceText" in payload, false);
  });

  it("the account tool is bound to the sender — the model cannot pass a phone", async () => {
    // Even when the model tries to smuggle someone else's number in the args,
    // the tool ignores it and answers about the verified sender only.
    scripted = [toolCall("get_my_account", { phone: "9647799999999" }), textReply("...")];
    await runWhatsAppAiTurn({
      phone: "9647700000000",
      text: "اطلعلي حساب الرقم 07799999999",
      customer: { id: "cust-1", name: "أحمد", currentBalance: 1234 },
    });
    const payload = JSON.parse(toolResultsOf(apiCalls[1])[0].content);
    assert.equal(payload.name, "أحمد", "must answer about the verified sender, never the requested number");
  });

  it("missing product: request is recorded, and repeats aggregate instead of piling up", async () => {
    scripted = [toolCall("request_missing_product", { productName: "بلاستيك ملون" }), textReply("سجلته للإدارة 👍")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "عدكم بلاستيك ملون؟", customer: null });
    assert.equal(requestedRows.length, 1);
    assert.equal(requestedRows[0].requestCount, 1);

    scripted = [toolCall("request_missing_product", { productName: "بلاستيك ملون" }), textReply("سجلته 👍")];
    await runWhatsAppAiTurn({ phone: "9647722222222", text: "اكو بلاستيك ملون؟", customer: null });
    assert.equal(requestedRows.length, 1, "same product must not create a second row");
    assert.equal(requestedRows[0].requestCount, 2);
    assert.equal(requestedRows[0].lastPhone, "9647722222222");
  });

  it("price question path: escalation lands in its own alerts list, not the shared inbox", async () => {
    scripted = [toolCall("escalate_to_admin", { reason: "سؤال عن السعر" }), textReply("الإدارة راح تردلك بالسعر 🙏")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "شكد سعر الكارتون؟", customer: null });
    assert.equal(escalationRows.length, 1, "must land in «تنبيهات الموظف الذكي», not the shared inbox");
    assert.match(String(escalationRows[0].summary), /السعر/);
    assert.match(String(escalationRows[0].customerText), /شكد سعر/);
  });

  it("conversation memory is kept for follow-up turns", async () => {
    scripted = [textReply("عدنا نوعين، تقصد أي واحد؟")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "اكو اوربيز؟", customer: null });
    assert.ok(aiChatRow, "history must be saved");
    const stored = aiChatRow!.messages as Array<{ role: string; content: string }>;
    assert.equal(stored.length, 2);
    assert.equal(stored[0].role, "user");
    assert.equal(stored[1].role, "assistant");

    scripted = [textReply("تمام، الناشف موجود")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "الناشف", customer: null });
    // The second call must have carried the earlier turns into the prompt.
    // (system is a top-level parameter on this API, not a message.)
    const roles = apiCalls[1].messages.map((m: any) => m.role);
    assert.deepEqual(roles, ["user", "assistant", "user"]);
    assert.match(apiCalls[1].system ?? "", /موظف/, "the persona must be sent as the system parameter");
  });

  it("stale history is dropped rather than replayed days later", async () => {
    aiChatRow = {
      phone: "9647700000000",
      messages: [{ role: "user", content: "قديم" }],
      updatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    };
    scripted = [textReply("هلا")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "سلام", customer: null });
    const roles = apiCalls[0].messages.map((m: any) => m.role);
    assert.deepEqual(roles, ["user"], "yesterday's conversation is not context");
  });

  it("knows where it works: shop facts reach the system prompt, no tool needed", async () => {
    scripted = [textReply("محلنا بكربلاء شارع العباس، الدوام 7 صباحاً لـ12 ليلاً")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "وين محلكم وشنو الدوام؟", customer: null });

    const system = String(apiCalls[0].system ?? "");
    assert.match(system, /كربلاء شارع العباس/, "the address must be in the prompt");
    assert.match(system, /جميع المحافظات/, "delivery areas too");
    assert.match(system, /mahdi\.mazbwoni\.com\/catalog/, "and the catalog link");
    assert.match(system, /الوقت الحالي/, "and today's Baghdad date/time");
    assert.equal(apiCalls.length, 1, "shop questions must not cost a tool round");
  });

  it("«نفس الطلبية الماضية»: recent orders come back with quantities and no prices", async () => {
    scripted = [toolCall("get_my_recent_orders", {}), textReply("آخر طلبية كانت ٢ كارتون تكتك")];
    await runWhatsAppAiTurn({
      phone: "9647700000000",
      text: "شنو اخذت المرة الفاتت؟",
      customer: { id: "cust-1", name: "أحمد", currentBalance: 0 },
    });

    const payload = JSON.parse(toolResultsOf(apiCalls[1])[0].content);
    assert.equal(payload.registered, true);
    assert.equal(payload.orders[0].items[0].product, "تكتك كبير");
    assert.equal(payload.orders[0].items[0].quantity, 2);
    assert.equal(JSON.stringify(payload).includes("unitPrice"), false, "no price may reach the model");
  });

  it("recent orders for an unknown number never invent a history", async () => {
    scripted = [toolCall("get_my_recent_orders", {}), textReply("رقمك مو مسجّل عدنا")];
    await runWhatsAppAiTurn({ phone: "9647711111111", text: "شنو طلبياتي؟", customer: null });
    const payload = JSON.parse(toolResultsOf(apiCalls[1])[0].content);
    assert.equal(payload.registered, false);
    assert.equal("orders" in payload, false);
  });

  it("stock is reported in cartons — the unit a wholesale customer buys in", async () => {
    products = [freshProduct({ openingBalancePcs: 100, pcsPerCarton: 24 })];
    scripted = [toolCall("search_products", { query: "اوربيز" }), textReply("عدنا ٤ كراتين")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "شكد عدك اوربيز؟", customer: null });
    const payload = JSON.parse(toolResultsOf(apiCalls[1])[0].content);
    assert.equal(payload.products[0].cartonsAvailable, 4, "100 pieces ÷ 24 per carton");
  });

  it("a typo still finds the product (اوربيس → اوربيز)", async () => {
    scripted = [toolCall("search_products", { query: "اوربيس" }), textReply("تقصد اوربيز؟ موجود")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "عدكم اوربيس؟", customer: null });
    assert.equal(JSON.parse(toolResultsOf(apiCalls[1])[0].content).found, 1);
  });

  it("«شنو الجديد عدكم؟» browses without a product name, in-stock only", async () => {
    products = [
      freshProduct({ id: "new-1", name: "لعبة جديدة", isNewArrival: true }),
      freshProduct({ id: "old-1", name: "لعبة قديمة", isNewArrival: false }),
      freshProduct({ id: "new-empty", name: "جديدة بس خالصة", isNewArrival: true, openingBalancePcs: 0 }),
    ];
    scripted = [toolCall("browse_products", { onlyNew: true }), textReply("وصلنا لعبة جديدة")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "شنو الجديد عدكم؟", customer: null });

    const payload = JSON.parse(toolResultsOf(apiCalls[1])[0].content);
    assert.equal(payload.found, 1, "only new arrivals that are actually in stock");
    assert.equal(payload.products[0].name, "لعبة جديدة");
  });

  it("browsing by category works even when the name says nothing about it", async () => {
    products = [
      freshProduct({ id: "g-1", name: "دبدوب صغير", category: "بنات" }),
      freshProduct({ id: "b-1", name: "سيارة حديد", category: "اولاد" }),
    ];
    scripted = [toolCall("browse_products", { category: "بنات" }), textReply("عدنا دبدوب صغير")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "شنو عدكم بالبنات؟", customer: null });

    const payload = JSON.parse(toolResultsOf(apiCalls[1])[0].content);
    assert.equal(payload.found, 1);
    assert.equal(payload.products[0].name, "دبدوب صغير");
  });

  it("a bare dot never reaches the model — the shop's daily window-keeper is free", async () => {
    // «ليش اصرف فلوس على امور تافهه؟» — the shop sends a "." from their own
    // phone every day to hold the 24h window open. It must cost nothing.
    for (const trivial of [".", "..", "؟", "🙂", "👍", "ok", "تم", "وك", "شكرا", "تم شكرا", "ا"]) {
      scripted = [];
      apiCalls = [];
      const outcome = await runWhatsAppAiTurn({ phone: "9647700000000", text: trivial, customer: null });
      assert.equal(outcome, "skipped", `"${trivial}" should be skipped`);
      assert.equal(apiCalls.length, 0, `"${trivial}" must not reach the model`);
      assert.equal(sentTexts.length, 0, `"${trivial}" must not get a reply`);
    }
  });

  it("a real question is never mistaken for a trivial one", async () => {
    for (const real of ["عدكم اوربيز؟", "شكد رصيدي", "هلا شلونك", "بندقية"]) {
      scripted = [textReply("جواب")];
      apiCalls = [];
      const outcome = await runWhatsAppAiTurn({ phone: "9647700000000", text: real, customer: null });
      assert.equal(outcome, "replied", `"${real}" must be answered`);
    }
  });

  it("daily cap stops a chatter, and the shop is never muted by a DB hiccup", async () => {
    aiChatRow = { phone: "9647700000000", messages: [], updatedAt: new Date(), repliesToday: 25, todayKey: baghdadToday() };
    const outcome = await runWhatsAppAiTurn({ phone: "9647700000000", text: "سولفني شوية", customer: null });
    assert.equal(outcome, "skipped");
    assert.equal(apiCalls.length, 0, "over the cap, nothing is paid for");
  });

  it("yesterday's count doesn't carry into today", async () => {
    aiChatRow = { phone: "9647700000000", messages: [], updatedAt: new Date(), repliesToday: 25, todayKey: "2020-01-01" };
    scripted = [textReply("هلا بيك")];
    const outcome = await runWhatsAppAiTurn({ phone: "9647700000000", text: "عدكم اوربيز؟", customer: null });
    assert.equal(outcome, "replied", "a new Baghdad day resets the ceiling");
  });

  it("a stalled image upload can no longer swallow the whole turn", async () => {
    // The live failure: a customer asked «اريد صورة» and got nothing at all —
    // no photo, no text, no error row. Meta's media upload has no timeout, so
    // the turn hung on it forever. The tool must fail, not hang.
    let released: (() => void) | null = null;
    sendImageImpl = () => new Promise((resolve) => { released = () => resolve(undefined); });

    scripted = [
      toolCall("send_product_image", { productId: "prod-1" }),
      textReply("ما كدرت أدزها، تريد اسمها مكتوب؟"),
    ];
    const outcome = await runWhatsAppAiTurn({ phone: "9647700000000", text: "اريد صورة", customer: null });
    released?.();

    assert.equal(outcome, "replied", "the customer must still get an answer");
    const payload = JSON.parse(toolResultsOf(apiCalls[1])[0].content);
    assert.equal(payload.sent, false, "the hung send is reported as failed, not awaited forever");
    assert.equal(sentTexts.length, 1, "and the model's apology actually goes out");
  });

  it("sends the smaller medium image, not the full-size one", async () => {
    scripted = [toolCall("send_product_image", { productId: "prod-1" }), textReply("دزيتها")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "دزلي صورة", customer: null });
    assert.equal(sentImages.length, 1);
    assert.equal(sentImages[0].bytes, Buffer.from("smaller").length, "mediumUrl is ~5x smaller than imageUrl");
  });

  it("a broken turn is recorded where the shop can still read it tomorrow", async () => {
    scripted = []; // any call throws
    const outcome = await runWhatsAppAiTurn({ phone: "9647700000000", text: "عدكم اوربيز؟", customer: null });
    assert.equal(outcome, "unavailable");
    assert.equal(recordedErrors.length, 1, "must reach «صحة النظام والأخطاء», not just the log buffer");
    assert.equal(recordedErrors[0].code, "AI_AGENT_TURN_FAILED");
    assert.equal(sentTexts.length, 0, "the apology is the caller's job, so nobody gets two messages");
  });

  it("model failure returns false so the caller falls back to the keyword bot", async () => {
    scripted = []; // any call throws
    const handled = await runWhatsAppAiTurn({ phone: "9647700000000", text: "سلام عليكم شلونكم", customer: null });
    assert.equal(handled, "unavailable", "the keyword bot must get a chance to answer");
    assert.equal(sentTexts.length, 0, "a broken agent must not send anything");
  });

  it("a runaway tool loop escalates to a human instead of spinning", async () => {
    scripted = [
      toolCall("search_products", { query: "أ" }, "c1"),
      toolCall("search_products", { query: "ب" }, "c2"),
      toolCall("search_products", { query: "ت" }, "c3"),
      toolCall("search_products", { query: "ث" }, "c4"),
      toolCall("search_products", { query: "ج" }, "c5"),
    ];
    const handled = await runWhatsAppAiTurn({ phone: "9647700000000", text: "دوّرلي على شي ما موجود", customer: null });
    assert.equal(handled, "replied");
    assert.equal(escalationRows.length, 1, "must hand off to a human");
    assert.equal(sentTexts.length, 1);
  });

  // ── Documents the customer asks for by name ───────────────────────────────
  // «ارسل لي اخر فاتورة» / «اخر فاتورتين» / برقم الفاتورة / رابط الكشف / سند قبض.

  const CUSTOMER = { id: "cust-1", name: "أبو علي", currentBalance: 250000 };

  it("sends the customer's last invoice as a PDF", async () => {
    scripted = [toolCall("send_my_invoices", {}), textReply("دزيتلك الفاتورة 👍")];
    const handled = await runWhatsAppAiTurn({ phone: "9647700000000", text: "ارسل لي اخر فاتورة", customer: CUSTOMER });
    assert.equal(handled, "replied");
    assert.deepEqual(sentPdfs.map((d) => d.filename), ["INV-1.pdf"]);
    assert.equal(sentPdfs[0].phone, "9647700000000");
  });

  it("«اخر فاتورتين» sends exactly two, newest first", async () => {
    scripted = [toolCall("send_my_invoices", { count: 2 }), textReply("دزيتلك الثنتين")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "ارسل لي اخر فاتورتين", customer: CUSTOMER });
    assert.deepEqual(sentPdfs.map((d) => d.filename), ["INV-1.pdf", "INV-2.pdf"]);
  });

  it("caps a greedy count at three invoices", async () => {
    invoiceRows = Array.from({ length: 6 }, (_, i) => ({
      id: `inv-${i}`, customerId: "cust-1", invoiceNumber: `INV-${i}`, createdAt: new Date(), items: [],
    }));
    scripted = [toolCall("send_my_invoices", { count: 50 }), textReply("تفضل")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "دزلي كل فواتيري", customer: CUSTOMER });
    assert.equal(sentPdfs.length, 3);
  });

  it("sends a specific invoice by number when it belongs to the sender", async () => {
    scripted = [toolCall("send_my_invoices", { invoiceNumber: "INV-2" }), textReply("تفضل")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "دزلي فاتورة INV-2", customer: CUSTOMER });
    assert.deepEqual(sentPdfs.map((d) => d.filename), ["INV-2.pdf"]);
  });

  it("never sends another customer's invoice, and does not confirm it exists", async () => {
    scripted = [toolCall("send_my_invoices", { invoiceNumber: "INV-999" }), textReply("ما لكيت فاتورة بهذا الرقم")];
    const handled = await runWhatsAppAiTurn({ phone: "9647700000000", text: "دزلي فاتورة INV-999", customer: CUSTOMER });
    assert.equal(handled, "replied");
    assert.equal(sentPdfs.length, 0);
    const result = JSON.parse(String(toolResultsOf(apiCalls[1])[0].content));
    assert.equal(result.sent, false);
    assert.match(result.error, /ما لكيت فاتورة بهذا الرقم/);
    // Same wording as a number that exists nowhere — no existence leak.
    assert.ok(!JSON.stringify(result).includes("INV-999"));
  });

  it("an unregistered number gets no documents at all", async () => {
    scripted = [toolCall("send_my_invoices", {}), textReply("رقمك مو مسجّل عدنا")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "ارسل لي اخر فاتورة", customer: null });
    assert.equal(sentPdfs.length, 0);
    const result = JSON.parse(String(toolResultsOf(apiCalls[1])[0].content));
    assert.equal(result.registered, false);
  });

  it("a failed PDF render tells the model to apologise instead of claiming a send", async () => {
    invoicePdfImpl = async () => { throw new Error("render died"); };
    scripted = [toolCall("send_my_invoices", {}), textReply("اعتذر، الإدارة راح تدزهالك")];
    const handled = await runWhatsAppAiTurn({ phone: "9647700000000", text: "ارسل لي اخر فاتورة", customer: CUSTOMER });
    assert.equal(handled, "replied");
    assert.equal(sentPdfs.length, 0);
    const result = JSON.parse(String(toolResultsOf(apiCalls[1])[0].content));
    assert.equal(result.sent, false);
  });

  it("sends a statement link built from the public frontend URL", async () => {
    scripted = [toolCall("send_my_statement_link", {}), textReply("دزيتلك الرابط")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "ارسل لي رابط الكشف مالتي", customer: CUSTOMER });
    assert.deepEqual(portalLinksMinted, ["cust-1"]);
    const link = sentTexts.find((t) => t.text.includes("/client/cpl_test"));
    assert.ok(link, "statement link was not sent");
    assert.ok(link!.text.includes("https://mahdi.mazbwoni.com/client/cpl_test"));
  });

  it("sends the customer's last receipt voucher", async () => {
    scripted = [toolCall("send_my_last_voucher", {}), textReply("دزيتلك السند")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "ارسلي اخر سند قبض", customer: CUSTOMER });
    assert.deepEqual(sentPdfs.map((d) => d.filename), ["REC-77.pdf"]);
  });

  it("says there is no voucher rather than inventing one", async () => {
    voucherRows = [];
    scripted = [toolCall("send_my_last_voucher", {}), textReply("ماكو سند قبض مسجّل الك")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "ارسلي اخر سند قبض", customer: CUSTOMER });
    assert.equal(sentPdfs.length, 0);
    const result = JSON.parse(String(toolResultsOf(apiCalls[1])[0].content));
    assert.equal(result.sent, false);
  });

  // ── The agent stands down when a human steps in ───────────────────────────

  it("a human reply silences the agent on that number", async () => {
    await muteAiAgent("07700000000");
    scripted = [textReply("ما لازم يوصل")];
    const handled = await runWhatsAppAiTurn({ phone: "9647700000000", text: "عدكم اوربيز؟", customer: null });
    assert.equal(handled, "skipped");
    assert.equal(apiCalls.length, 0, "a muted number must not cost a token");
    assert.equal(sentTexts.length, 0);
  });

  it("the agent comes back when the quiet window passes", async () => {
    await muteAiAgent("9647700000000", 1);
    aiChatRow!.aiMutedUntil = new Date(Date.now() - 1000); // window already over
    scripted = [textReply("هلا بيك")];
    const handled = await runWhatsAppAiTurn({ phone: "9647700000000", text: "عدكم اوربيز؟", customer: null });
    assert.equal(handled, "replied");
  });

  it("«رجّع الموظف الذكي» clears the mute at once", async () => {
    await muteAiAgent("9647700000000");
    await unmuteAiAgent("9647700000000");
    scripted = [textReply("رجعت 👋")];
    assert.equal(await runWhatsAppAiTurn({ phone: "9647700000000", text: "عدكم اوربيز؟", customer: null }), "replied");
  });

  it("a shop that set the mute to zero is never silenced", async () => {
    settingsRow = { aiAgentMuteMinutes: 0 };
    assert.equal(await muteAiAgent("9647700000000"), null);
    scripted = [textReply("هلا")];
    assert.equal(await runWhatsAppAiTurn({ phone: "9647700000000", text: "عدكم اوربيز؟", customer: null }), "replied");
  });

  // ── Long-term memory ──────────────────────────────────────────────────────

  it("remembers a durable fact and knows it on the next conversation", async () => {
    scripted = [toolCall("remember_about_customer", { fact: "عنده محل العاب بالكاظمية ويشتري اوربيز كل اسبوع" }), textReply("تمام 👍")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "اني صاحب محل العاب بالكاظمية", customer: null });
    assert.equal(memoryRows.length, 1);

    apiCalls = [];
    scripted = [textReply("هلا بصاحب محل الالعاب")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "شلونك", customer: null });
    assert.match(String(apiCalls[0].system), /محل العاب بالكاظمية/);
  });

  it("the same fact written twice is stored once", async () => {
    scripted = [toolCall("remember_about_customer", { fact: "يحب التوصيل الصبح" }), textReply("تمام")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "وصلولي الصبح", customer: null });
    scripted = [toolCall("remember_about_customer", { fact: "يحب التوصيل الصبح" }), textReply("تمام")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "دائما الصبح", customer: null });
    assert.equal(memoryRows.length, 1);
  });

  it("memory is capped — the oldest fact falls off, the newest survives", async () => {
    for (let i = 0; i < 14; i++) {
      scripted = [toolCall("remember_about_customer", { fact: `معلومة رقم ${i} عن الزبون` }), textReply("ok")];
      await runWhatsAppAiTurn({ phone: "9647700000000", text: `خبر ${i}`, customer: null });
    }
    assert.equal(memoryRows.length, 12);
    assert.ok(!memoryRows.some((r) => r.fact.includes("رقم 0")));
    assert.ok(memoryRows.some((r) => r.fact.includes("رقم 13")));
  });

  it("an empty scrap is not worth remembering", async () => {
    scripted = [toolCall("remember_about_customer", { fact: "اه" }), textReply("تمام")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "عدكم اوربيز لو لا؟", customer: null });
    assert.equal(memoryRows.length, 0);
    const result = JSON.parse(String(toolResultsOf(apiCalls[1])[0].content));
    assert.equal(result.saved, false);
  });

  // ── Photos ────────────────────────────────────────────────────────────────

  it("a photo reaches the model as an image, not as an apology", async () => {
    scripted = [textReply("شكله نفس نوع الاوربيز مالتنا")];
    const handled = await runWhatsAppAiTurn({ phone: "9647700000000", text: "", images: [TINY_PNG], customer: null });
    assert.equal(handled, "replied");
    const content = apiCalls[0].messages.at(-1).content;
    assert.ok(Array.isArray(content));
    assert.equal(content[0].type, "image");
    assert.equal(content[0].source.media_type, "image/jpeg", "photos are re-encoded before they are paid for");
  });

  it("a photo with no caption is never dismissed as a trivial message", async () => {
    scripted = [textReply("شفت الصورة")];
    assert.equal(
      await runWhatsAppAiTurn({ phone: "9647700000000", text: "👍", images: [TINY_PNG], customer: null }),
      "replied",
    );
  });

  it("tomorrow's turn does not re-upload today's photo", async () => {
    scripted = [textReply("شفتها")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "شنو هذا؟", images: [TINY_PNG], customer: null });
    const stored = aiChatRow!.messages as Array<{ role: string; content: string }>;
    assert.match(stored[0].content, /^\[صورة\]/);
  });

  it("photos have their own daily ceiling", async () => {
    aiChatRow = {
      phone: "9647700000000",
      messages: [],
      updatedAt: new Date(),
      repliesToday: 0,
      todayKey: baghdadToday(),
      imagesToday: 99,
    } as any;
    scripted = [textReply("ما اكدر اشوف صور اليوم بعد")];
    // No caption either — the worst case, and the one that used to break.
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "", images: [TINY_PNG], customer: null });
    const content = apiCalls[0].messages.at(-1).content;
    assert.ok(!content.some((b: any) => b.type === "image"), "over the cap, no image is paid for");
    // And the turn must still carry something to say. A bare photo over the
    // ceiling used to leave an empty text block, which the API refuses — the
    // customer got the generic apology instead of an answer.
    const text = content.find((b: any) => b.type === "text");
    assert.ok(text && text.text.trim().length > 0, "an empty text block would be rejected by the API");
  });

  // ── The upset customer ────────────────────────────────────────────────────

  it("an upset customer texts the owner's phone immediately", async () => {
    scripted = [toolCall("alert_upset_customer", { reason: "الطلبية تأخرت ثلاث ايام وزعلان" }), textReply("اعتذرلك، صاحب المحل راح يتواصل وياك")];
    const handled = await runWhatsAppAiTurn({
      phone: "9647700000000",
      text: "شنو هالتأخير! خلص ما اريد اتعامل وياكم",
      customer: { id: "cust-1", name: "أبو علي", currentBalance: 0 },
    });
    assert.equal(handled, "replied");
    const alert = sentTexts.find((t) => t.phone === "9647800000000");
    assert.ok(alert, "the owner was not texted");
    assert.match(alert!.text, /زبون منزعج/);
    assert.match(alert!.text, /أبو علي/);
    assert.match(alert!.text, /wa\.me\/9647700000000/);
    assert.equal(escalationRows[0].kind, "UPSET");
    assert.ok(escalationRows[0].alertedAt, "the alert was not recorded as sent");
  });

  it("the agent stands down after alerting, so the shop answers alone", async () => {
    scripted = [toolCall("alert_upset_customer", { reason: "زبون زعلان" }), textReply("اعتذرلك")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "خلص تعبت منكم", customer: null });
    apiCalls = [];
    scripted = [textReply("ما لازم يوصل")];
    assert.equal(await runWhatsAppAiTurn({ phone: "9647700000000", text: "هاه؟", customer: null }), "skipped");
    assert.equal(apiCalls.length, 0);
  });

  it("one angry conversation is one alert, not twenty", async () => {
    scripted = [toolCall("alert_upset_customer", { reason: "زعلان" }), textReply("اعتذر")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "زعلان", customer: null });
    await unmuteAiAgent("9647700000000");
    const first = sentTexts.filter((t) => t.phone === "9647800000000").length;
    scripted = [toolCall("alert_upset_customer", { reason: "بعده زعلان" }), textReply("اعتذر")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "بعدني زعلان", customer: null });
    assert.equal(sentTexts.filter((t) => t.phone === "9647800000000").length, first, "the owner was texted twice");
    assert.equal(escalationRows.length, 2, "but both are still recorded for the list");
  });

  it("with no alert number configured the escalation is still written", async () => {
    settingsRow = { aiAgentMuteMinutes: 60 };
    scripted = [toolCall("alert_upset_customer", { reason: "زعلان" }), textReply("اعتذر")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "زعلان", customer: null });
    assert.equal(escalationRows.length, 1);
    assert.equal(escalationRows[0].kind, "UPSET");
  });

  // ── Statement as a file ───────────────────────────────────────────────────

  it("sends the account statement as a PDF", async () => {
    scripted = [toolCall("send_my_statement_pdf", {}), textReply("دزيتلك الكشف")];
    await runWhatsAppAiTurn({
      phone: "9647700000000",
      text: "دزلي كشف حسابي PDF",
      customer: { id: "cust-1", name: "أبو علي", currentBalance: 250000 },
    });
    assert.equal(sentPdfs.length, 1);
    assert.match(sentPdfs[0].filename, /^statement-/);
  });

  it("an unregistered number gets no statement file", async () => {
    scripted = [toolCall("send_my_statement_pdf", {}), textReply("رقمك مو مسجّل")];
    await runWhatsAppAiTurn({ phone: "9647700000000", text: "دزلي كشف حسابي", customer: null });
    assert.equal(sentPdfs.length, 0);
  });
});
