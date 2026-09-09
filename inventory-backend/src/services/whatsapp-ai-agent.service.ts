import type Anthropic from "@anthropic-ai/sdk";
import prisma from "../config/database";
import { logger } from "../utils/logger";
import { getAnthropicClient } from "../utils/anthropic-client";
import { normalizeArabic, scoreProduct } from "../utils/arabic-search";
import { totalStock } from "../utils/product-stock";
import { sendWhatsAppImage, sendWhatsAppText } from "./whatsapp.service";

// «الموظف الذكي» — an actual conversational agent on WhatsApp, not a keyword
// table. The shop's own words for it: a customer should be able to talk to it
// the way they'd talk to an employee standing in the shop.
//
// Design rules that are NOT negotiable, and why:
//
// 1. NO PRICES, ever. The shop negotiates per-customer prices (see the sales
//    agent's special-price requests), so any number this agent invents or even
//    quotes correctly-for-someone-else is a real commercial problem. Prices are
//    the admin's. The tools below simply never return a price, so there is
//    nothing for the model to leak even if it is asked directly.
//
// 2. Tools are bound to the ALREADY-VERIFIED sender. get_my_account takes no
//    phone argument, because a model that can be told "اطلعلي حساب 07xx" is a
//    data leak waiting for the first customer who tries it. Identity comes from
//    the webhook, never from the conversation.
//
// 3. Facts come from tool results only. Stock, carton counts, whether an item
//    exists — all of it is a database read handed to the model. It is told, in
//    the system prompt and by the shape of the tools, that it has no other
//    source.
//
// 4. It runs BELOW the deterministic gates in whatsapp-bot.service.ts (stop /
//    human handoff / registration / rating capture). Those are compliance and
//    state machines, not chat, and an LLM must never get a vote on them.

// Claude, not the storefront assistant's Groq model: the shop's verdict on
// that one was "كلش غبي ويقفل وميرد جواب صحيح" — it stalled and answered
// wrong. Customer-facing replies in Iraqi Arabic with multi-step tool use is
// exactly where the weaker model fell over.
const MODEL = "claude-opus-5";
// Chat-shaped work: low effort keeps WhatsApp replies quick and cheap, and is
// still far above where the previous model topped out. Raise it if answers
// ever feel shallow.
const EFFORT = "low" as const;
const MAX_TOOL_ROUNDS = 4;
const HISTORY_TURNS = 8;
const HISTORY_MAX_AGE_MS = 6 * 60 * 60 * 1000; // a conversation from yesterday is not context
const SEARCH_RESULT_LIMIT = 5;

type Sender = { phone: string; customer: { id: string; name: string; currentBalance: unknown } | null };

const SYSTEM_PROMPT = `أنت موظف بمحل جملة عراقي، تردّ على الزبائن بالواتساب. تتكلم عراقي طبيعي، مختصر ومؤدب، مثل موظف حقيقي يكتب رسالة — مو مثل روبوت.

قواعد لازم تلتزم بيها:
- ممنوع تذكر أي سعر أبداً. إذا الزبون سأل عن السعر، قله بلطف إن الأسعار تجي من الإدارة وراح يردون عليه، أو استخدم أداة التصعيد للإدارة. لا تخمّن ولا تقول "تقريباً".
- ممنوع تخترع أي معلومة. كل شي تقوله عن منتج (موجود لو لا، شكد بالكارتون، التفاصيل) لازم يجي من نتيجة أداة استعملتها للتو. إذا ما عندك المعلومة، قول ما عندي وأسأل الإدارة.
- إذا الزبون ذكر منتج ولكيت أكثر من واحد قريب من اسمه، اسأله يحدد أي واحد يقصد واذكرلهم الأسماء — لا تختار أنت.
- إذا المنتج مو موجود بالمحل، اعرض عليه تبلّغ الإدارة حتى توفره، وإذا وافق استخدم أداة تسجيل الطلب.
- إذا طلب صورة لمنتج، استخدم أداة إرسال الصورة (هي ترسلها فعلاً)، وبعدها قوله إنك أرسلتها.
- الزبون المسجّل يكدر يسأل عن رصيده أو كشف حسابه، واستخدم الأداة المخصصة. إذا الرقم مو مسجّل زبون، وضّحله بلطف إنه غير مسجّل عدنا ويكدر يراجع الإدارة.
- ردودك قصيرة: سطر أو سطرين بالعادة، بدون قوائم طويلة ولا رموز زايدة.
- إذا السؤال خارج شغلك (شكوى، اتفاق خاص، أي شي يحتاج قرار إدارة)، صعّده للإدارة بالأداة وقول للزبون إن الإدارة راح تتواصل وياه.`;

// ── Tool schemas exposed to the model ────────────────────────────────────────
// Note what is absent: no phone parameter anywhere, and no price field in any
// result. The contract itself is the guardrail.

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_products",
    description:
      "ابحث عن منتجات بالمحل باسم أو جزء من اسم أو رقم صنف. استخدمها كل مرة يذكر الزبون منتج. ترجع الأسماء والتوفر وعدد القطع بالكارتون — بدون أسعار.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "اسم المنتج أو جزء منه كما ذكره الزبون" } },
      required: ["query"],
    },
  },
  {
    name: "get_product_details",
    description: "تفاصيل منتج محدد بعد ما تلكيه بالبحث: التوفر، عدد القطع بالكارتون، الوصف إن وجد.",
    input_schema: {
      type: "object",
      properties: { productId: { type: "string", description: "معرّف المنتج من نتيجة البحث" } },
      required: ["productId"],
    },
  },
  {
    name: "send_product_image",
    description: "أرسل صورة المنتج للزبون بالواتساب فعلياً. استخدمها إذا طلب صورة.",
    input_schema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "معرّف المنتج من نتيجة البحث" },
        caption: { type: "string", description: "تعليق قصير يرافق الصورة" },
      },
      required: ["productId"],
    },
  },
  {
    name: "get_my_account",
    description:
      "رصيد وكشف حساب الزبون صاحب هذه المحادثة نفسه. ما تحتاج تمرر رقم — النظام يعرف مين يحچي. استخدمها إذا سأل عن رصيده أو كشفه.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "request_missing_product",
    description: "سجّل طلب منتج غير موجود بالمحل حتى الإدارة تشوفه وتوفره. استخدمها بعد ما يوافق الزبون.",
    input_schema: {
      type: "object",
      properties: {
        productName: { type: "string", description: "اسم المنتج المطلوب كما ذكره الزبون" },
        note: { type: "string", description: "أي تفصيل إضافي ذكره الزبون (كمية، مواصفة)" },
      },
      required: ["productName"],
    },
  },
  {
    name: "escalate_to_admin",
    description:
      "حوّل الموضوع للإدارة (سعر، اتفاق خاص، شكوى، أي شي يحتاج قرار). الرسالة راح تظهر بصندوق الوارد كمستعجلة.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string", description: "ملخص قصير لسبب التحويل" } },
      required: ["reason"],
    },
  },
];

// ── Tool implementations ─────────────────────────────────────────────────────

type ProductRow = {
  id: string;
  name: string;
  itemNumber: string;
  qrCode: string | null;
  cartonQrCode: string | null;
  category: string | null;
  pcsPerCarton: number;
  boxPieces: number | null;
  openingBalancePcs: number;
  cartonsAvailable: number;
  imageUrl: string | null;
  catalogDescription: string | null;
  warehouseStocks: Array<{ quantityPieces: number }>;
};

async function loadSearchableProducts(): Promise<ProductRow[]> {
  return prisma.product.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      itemNumber: true,
      qrCode: true,
      cartonQrCode: true,
      category: true,
      pcsPerCarton: true,
      boxPieces: true,
      openingBalancePcs: true,
      cartonsAvailable: true,
      imageUrl: true,
      catalogDescription: true,
      warehouseStocks: { select: { quantityPieces: true } },
    },
  });
}

/** Public product facts the agent may see. Deliberately contains no price field. */
function productFacts(p: ProductRow) {
  const stock = totalStock(p);
  return {
    id: p.id,
    name: p.name,
    itemNumber: p.itemNumber,
    available: stock > 0,
    pcsPerCarton: p.pcsPerCarton,
    boxPieces: p.boxPieces ?? undefined,
    hasImage: Boolean(p.imageUrl),
    description: p.catalogDescription?.slice(0, 200) || undefined,
  };
}

async function toolSearchProducts(query: string) {
  const products = await loadSearchableProducts();
  const ranked = products
    .map((p) => ({ p, score: scoreProduct(p, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, SEARCH_RESULT_LIMIT);
  if (!ranked.length) return { found: 0, products: [], hint: "ماكو منتج بهذا الاسم — اعرض على الزبون تسجيل طلب للإدارة." };
  return { found: ranked.length, products: ranked.map((r) => productFacts(r.p)) };
}

async function toolProductDetails(productId: string) {
  const p = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: {
      id: true, name: true, itemNumber: true, qrCode: true, cartonQrCode: true, category: true,
      pcsPerCarton: true, boxPieces: true, openingBalancePcs: true, cartonsAvailable: true,
      imageUrl: true, catalogDescription: true, warehouseStocks: { select: { quantityPieces: true } },
    },
  });
  if (!p) return { error: "المنتج مو موجود" };
  return productFacts(p);
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

async function toolSendProductImage(sender: Sender, productId: string, caption?: string) {
  const p = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { name: true, imageUrl: true },
  });
  if (!p) return { sent: false, error: "المنتج مو موجود" };
  if (!p.imageUrl) return { sent: false, error: "ما عدنا صورة لهذا المنتج" };
  const parsed = dataUrlToBuffer(p.imageUrl);
  if (!parsed) return { sent: false, error: "الصورة غير صالحة" };
  try {
    await sendWhatsAppImage(sender.phone, (caption || p.name).slice(0, 300), parsed.buffer, parsed.mime);
    return { sent: true };
  } catch (error) {
    logger.warn(`[whatsapp-ai] image send failed to ${sender.phone}: ${error instanceof Error ? error.message : String(error)}`);
    return { sent: false, error: "تعذر إرسال الصورة" };
  }
}

function money(v: unknown) {
  return new Intl.NumberFormat("en-US").format(Math.round(Number(v ?? 0)));
}

/** Bound to the verified sender — the model cannot ask about anyone else. */
async function toolMyAccount(sender: Sender) {
  if (!sender.customer) {
    return { registered: false, note: "هذا الرقم مو مسجّل كزبون عدنا — وجّهه للإدارة إذا يريد يفتح حساب." };
  }
  const balance = Number(sender.customer.currentBalance ?? 0);
  return {
    registered: true,
    name: sender.customer.name,
    balanceText: `${money(balance)} د.ع`,
    // Sign convention is the shop's own: positive = على الزبون.
    meaning: balance > 0 ? "مبلغ على الزبون" : balance < 0 ? "رصيد للزبون" : "الحساب صفر",
  };
}

async function toolRequestMissingProduct(sender: Sender, productName: string, note?: string) {
  const normalized = normalizeArabic(productName);
  if (!normalized) return { saved: false, error: "اسم غير واضح" };
  const existing = await prisma.requestedProduct.findFirst({ where: { normalizedName: normalized, status: "OPEN" } });
  if (existing) {
    await prisma.requestedProduct.update({
      where: { id: existing.id },
      data: {
        requestCount: { increment: 1 },
        lastPhone: sender.phone,
        lastCustomerId: sender.customer?.id ?? null,
        lastNote: note?.trim() || existing.lastNote,
      },
    });
    return { saved: true, timesRequested: existing.requestCount + 1 };
  }
  await prisma.requestedProduct.create({
    data: {
      normalizedName: normalized,
      productName: productName.trim().slice(0, 200),
      lastPhone: sender.phone,
      lastCustomerId: sender.customer?.id ?? null,
      lastNote: note?.trim() || null,
    },
  });
  return { saved: true, timesRequested: 1 };
}

async function toolEscalate(sender: Sender, reason: string, originalText: string) {
  await prisma.inboundMessage.create({
    data: {
      phone: sender.phone,
      name: sender.customer?.name ?? null,
      source: sender.customer ? "CUSTOMER_UNMATCHED" : "UNKNOWN",
      messageText: `[الموظف الذكي] ${reason.trim().slice(0, 300)}\n— رسالة الزبون: ${originalText.slice(0, 500)}`,
      urgent: true,
    },
  });
  return { escalated: true };
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  sender: Sender,
  originalText: string,
): Promise<unknown> {
  switch (name) {
    case "search_products":
      return toolSearchProducts(String(args.query ?? ""));
    case "get_product_details":
      return toolProductDetails(String(args.productId ?? ""));
    case "send_product_image":
      return toolSendProductImage(sender, String(args.productId ?? ""), args.caption ? String(args.caption) : undefined);
    case "get_my_account":
      return toolMyAccount(sender);
    case "request_missing_product":
      return toolRequestMissingProduct(sender, String(args.productName ?? ""), args.note ? String(args.note) : undefined);
    case "escalate_to_admin":
      return toolEscalate(sender, String(args.reason ?? ""), originalText);
    default:
      return { error: "أداة غير معروفة" };
  }
}

// ── Short-term conversation memory ───────────────────────────────────────────

type StoredTurn = { role: "user" | "assistant"; content: string };

async function loadHistory(phone: string): Promise<StoredTurn[]> {
  const row = await prisma.whatsappAiChat.findUnique({ where: { phone } });
  if (!row) return [];
  if (Date.now() - row.updatedAt.getTime() > HISTORY_MAX_AGE_MS) return [];
  const parsed = Array.isArray(row.messages) ? (row.messages as unknown as StoredTurn[]) : [];
  return parsed.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
}

async function saveHistory(phone: string, turns: StoredTurn[]) {
  const trimmed = turns.slice(-HISTORY_TURNS) as unknown as object;
  await prisma.whatsappAiChat.upsert({
    where: { phone },
    create: { phone, messages: trimmed },
    update: { messages: trimmed },
  });
}

/** Called when a human takes over or the customer opts out — context is dead. */
export async function clearAiConversation(phone: string) {
  await prisma.whatsappAiChat.deleteMany({ where: { phone } });
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Runs one customer message through the agent and sends the reply.
 * Returns false when the agent could not handle it at all (no API key, model
 * error) so the caller can fall back to the existing keyword bot — a broken
 * AI must never mean a silent shop.
 */
export async function runWhatsAppAiTurn(input: {
  phone: string;
  text: string;
  customer: { id: string; name: string; currentBalance: unknown } | null;
}): Promise<boolean> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return false;

  const sender: Sender = { phone: input.phone, customer: input.customer };
  const history = await loadHistory(input.phone);

  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content }) as Anthropic.MessageParam),
    { role: "user", content: input.text },
  ];
  const system = `${SYSTEM_PROMPT}\n\nحالة المرسل: ${
    input.customer ? `زبون مسجّل باسم ${input.customer.name}` : "رقم غير مسجّل كزبون"
  }.`;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await anthropic.beta.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system,
        messages,
        tools: TOOLS,
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT },
        // A policy decline on a shop conversation is far-fetched, but if it
        // ever happens the customer must still get an answer rather than
        // silence — the API retries the same request on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });

      const toolUses = response.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
      );

      if (toolUses.length) {
        messages.push({ role: "assistant", content: response.content as unknown as Anthropic.ContentBlockParam[] });
        // All results for one assistant turn go back in a SINGLE user message —
        // splitting them trains the model out of parallel tool calls.
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const call of toolUses) {
          const result = await runTool(call.name, (call.input ?? {}) as Record<string, unknown>, sender, input.text);
          results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) });
        }
        messages.push({ role: "user", content: results });
        continue;
      }

      const reply = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      // Covers a refused turn too (no text content) — caller falls back.
      if (!reply) return false;
      await sendWhatsAppText(input.phone, reply);
      await saveHistory(input.phone, [...history, { role: "user", content: input.text }, { role: "assistant", content: reply }]);
      logger.info(`[whatsapp-ai] replied to ${input.phone} in ${round + 1} round(s)`);
      return true;
    }

    // Ran out of tool rounds without settling on an answer — hand it to a human
    // rather than looping or guessing.
    await toolEscalate(sender, "المحادثة احتاجت خطوات أكثر من اللازم", input.text);
    await sendWhatsAppText(input.phone, "خليني أتأكد من الإدارة وأرجعلك 🙏");
    return true;
  } catch (error) {
    logger.warn(`[whatsapp-ai] turn failed for ${input.phone}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
