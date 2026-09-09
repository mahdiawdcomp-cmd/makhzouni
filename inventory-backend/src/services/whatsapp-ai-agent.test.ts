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
let aiChatRow: { phone: string; messages: unknown; updatedAt: Date } | null;
let sentTexts: Array<{ phone: string; text: string }>;
let sentImages: Array<{ phone: string; caption: string; bytes: number }>;

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
    pcsPerCarton: 24,
    boxPieces: 12,
    openingBalancePcs: 100,
    cartonsAvailable: 0,
    imageUrl: `data:image/jpeg;base64,${Buffer.from("fake-image-bytes").toString("base64")}`,
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
    findMany: async () => invoiceRows,
  },
  aiEscalation: {
    create: async ({ data }: any) => {
      escalationRows.push(data);
      return data;
    },
  },
  whatsappAiChat: {
    findUnique: async ({ where }: any) => (aiChatRow && aiChatRow.phone === where.phone ? { ...aiChatRow } : null),
    upsert: async ({ where, create, update }: any) => {
      aiChatRow = { phone: where.phone, messages: (update.messages ?? create.messages), updatedAt: new Date() };
      return aiChatRow;
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
      sentImages.push({ phone, caption, bytes: image.length });
      return { to: phone };
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

let runWhatsAppAiTurn: (input: {
  phone: string;
  text: string;
  customer: { id: string; name: string; currentBalance: unknown } | null;
}) => Promise<boolean>;

describe("«الموظف الذكي» — WhatsApp AI agent", () => {
  before(async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    ({ runWhatsAppAiTurn } = await import("./whatsapp-ai-agent.service"));
  });

  beforeEach(() => {
    scripted = [];
    apiCalls = [];
    products = [freshProduct()];
    requestedRows = [];
    escalationRows = [];
    invoiceRows = [{
      invoiceNumber: "INV-1",
      createdAt: new Date("2026-09-01T10:00:00Z"),
      items: [{ quantity: 2, unit: "CARTON", productName: "تكتك كبير", product: { name: "تكتك كبير" } }],
    }];
    aiChatRow = null;
    sentTexts = [];
    sentImages = [];
  });

  it("plain greeting: replies with generated text, no tools needed", async () => {
    scripted = [textReply("وعليكم السلام 👋 امرك؟")];
    const handled = await runWhatsAppAiTurn({ phone: "9647700000000", text: "سلام عليكم", customer: null });
    assert.equal(handled, true);
    assert.equal(sentTexts.length, 1);
    assert.equal(sentTexts[0].text, "وعليكم السلام 👋 امرك؟");
  });

  it("product question: search tool sees the item and never exposes a price", async () => {
    scripted = [toolCall("search_products", { query: "اوربيز" }), textReply("إي موجود، الكارتون بيه ٢٤ قطعة")];
    const handled = await runWhatsAppAiTurn({ phone: "9647700000000", text: "شكو عدكم اوربيز؟", customer: null });
    assert.equal(handled, true);

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

  it("model failure returns false so the caller falls back to the keyword bot", async () => {
    scripted = []; // any call throws
    const handled = await runWhatsAppAiTurn({ phone: "9647700000000", text: "سلام", customer: null });
    assert.equal(handled, false);
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
    const handled = await runWhatsAppAiTurn({ phone: "9647700000000", text: "؟؟؟", customer: null });
    assert.equal(handled, true);
    assert.equal(escalationRows.length, 1, "must hand off to a human");
    assert.equal(sentTexts.length, 1);
  });
});
