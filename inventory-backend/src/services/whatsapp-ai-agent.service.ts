import type Anthropic from "@anthropic-ai/sdk";
import prisma from "../config/database";
import { logger } from "../utils/logger";
import { getAnthropicClient } from "../utils/anthropic-client";
import { getSettings } from "./settings.service";
import { normalizeArabic } from "../utils/arabic-search";
import { totalStock } from "../utils/product-stock";
import { sendWhatsAppImage, sendWhatsAppText } from "./whatsapp.service";
import { recordError } from "./error-log.service";
import { ErrorLogSource } from "@prisma/client";

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
//
// Sonnet over Opus by the shop's own call: this runs on every inbound
// WhatsApp message, and Sonnet is plenty for short shop conversations at
// half the cost.
const MODEL = "claude-sonnet-5";
// Raised from "low" after the shop's early tests: a customer conversation that
// needs two or three searches with different wording before answering is not
// the trivial chat "low" is meant for. Latency stays fine on WhatsApp.
const EFFORT = "medium" as const;
const MAX_TOOL_ROUNDS = 5;
const HISTORY_TURNS = 8;
const HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000; // same-day follow-ups keep context; older is a new conversation
// 8, not 5: a loose query like «سلاح كبريت» legitimately has many candidates
// and the model is the one filtering — a truncated list hides the right answer.
const SEARCH_RESULT_LIMIT = 8;
const RECENT_ORDERS_LIMIT = 5;
// Meta's media upload has no timeout of its own; without this a stalled upload
// hangs the entire turn and the customer gets nothing at all.
const IMAGE_SEND_TIMEOUT_MS = Number(process.env.AI_IMAGE_SEND_TIMEOUT_MS) || 25_000;
/** Said once, deterministically, when a turn breaks — costs nothing to send. */
export const AGENT_FALLBACK_REPLY =
  "عذراً، صارت عندنا مشكلة تقنية بالرد 🙏 الإدارة راح تتواصل وياك، أو تكدر تعيد سؤالك.";

/** Rejects if the promise outlives the deadline. The work is abandoned, not cancelled. */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      timer.unref?.();
    }),
  ]);
}

type Sender = { phone: string; customer: { id: string; name: string; currentBalance: unknown } | null };

// ── Cost guards: decided BEFORE any API call, so a skip costs nothing ───────
//
// The shop's rule, in their words: «ليش اصرف فلوس على امور تافهه؟» They send a
// daily "." from their own phone to hold the 24-hour window open, and a
// message with no content in it should never reach a paid model.

/** Acknowledgements that need no answer — replying to these is pure spend. */
const ACK_WORDS = new Set(
  [
    "تم", "وك", "اوك", "ok", "okay", "k", "تمام", "زين", "ماشي", "خلص", "شكرا", "شكراً",
    "مشكور", "مشكوره", "تسلم", "ثانكس", "thanks", "thx", "ty", "👍", "🙏", "❤️",
  ].map((w) => normalizeArabic(w)),
);

/**
 * True when a message carries nothing to answer: punctuation only, a bare
 * emoji, one or two characters, or a plain acknowledgement. Deliberately
 * conservative — anything with real words in it goes to the model.
 */
export function isLowValueMessage(text: string): boolean {
  const raw = text.trim();
  if (!raw) return true;

  // Strip emoji, punctuation and symbols; what's left is actual language.
  const letters = raw.replace(/[\p{Extended_Pictographic}\p{P}\p{S}\p{M}\s‍️]/gu, "");
  if (!letters) return true; // "." / "؟" / "🙂" / "..."
  if (letters.length <= 2) return true; // a stray letter or two

  const normalized = normalizeArabic(raw);
  if (ACK_WORDS.has(normalized)) return true;
  // "تم شكرا" — two acks and nothing else.
  const words = normalized.split(" ").filter(Boolean);
  if (words.length <= 2 && words.every((w) => ACK_WORDS.has(w))) return true;

  return false;
}

/**
 * Per-number daily ceiling on paid replies. A real buying conversation is a
 * handful of messages; this only ever bites someone who just wants to chat,
 * and it fails open on a bad clock/day boundary rather than muting the shop.
 */
const MAX_AI_REPLIES_PER_DAY = 25;

/**
 * "replied"     — the customer got an answer.
 * "skipped"     — deliberately not answered (no content, or over the daily
 *                 cap). The caller must stop: this is not a failure and must
 *                 not fall through to the keyword bot or the inbox.
 * "unavailable" — the agent could not run at all, so the old keyword bot
 *                 should answer instead. Never a silent shop.
 */
export type AiTurnResult = "replied" | "skipped" | "unavailable";

function baghdadDayKey(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * What an employee would simply know: where the shop is, when it opens, where
 * it delivers, the catalog link. All of it already lives in settings and was
 * being withheld from the agent, so «وين محلكم؟» and «توصلون للبصرة؟» — the
 * most ordinary questions a customer asks — had no answer.
 *
 * Read fresh each turn: the shop edits these from the settings screen and a
 * cached copy would answer with yesterday's opening hours.
 */
async function shopFacts(): Promise<string> {
  const s = await getSettings();
  const lines: string[] = [];
  const add = (label: string, value?: string | null) => {
    const v = typeof value === "string" ? value.trim() : "";
    if (v) lines.push(`- ${label}: ${v}`);
  };
  add("اسم المحل", s.storeName);
  add("العنوان", s.catalogDesignFooterAddress);
  add("الدوام", s.catalogDesignFooterHours);
  add("هاتف المحل", s.catalogDesignFooterPhone);
  add("مناطق التوصيل", s.catalogDesignFooterDeliveryAreas);
  add("مدة التوصيل", s.catalogDesignFooterDeliveryTime);
  add("أقل مبلغ طلبية", s.catalogDesignFooterMinOrder);
  if (s.catalogDesignFooterCashOnDelivery) lines.push("- الدفع عند الاستلام: متوفر");
  add("رابط الكتلوك", s.catalogPublicUrl);
  add("نبذة عن المحل", s.catalogDesignFooterAbout);
  return lines.length ? lines.join("\n") : "- (ما مضبوطة معلومات المحل بالإعدادات بعد)";
}

/** Baghdad wall-clock, so «اليوم» and «الدوام هسه» mean something. */
function baghdadNowText(): string {
  return new Date().toLocaleString("ar-IQ", {
    timeZone: "Asia/Baghdad",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SYSTEM_PROMPT = `أنت موظف بمحل جملة عراقي، تردّ على الزبائن بالواتساب. إنت إنسان مو روبوت: تحچي عراقي دارج، ودود، وتعرف تسولف وتضحك وية الزبون.

شخصيتك:
- سولف طبيعي. إذا الزبون سلّم ردّ عليه بحرارة، وإذا سأل «شلونك» جاوبه وارجع اسأله. مو كل رسالة لازم تكون شغل.
- تهزر خفيف ومحترم لمن الجو يسمح — نكتة قصيرة، تعليق ظريف، ترحيب دافئ. زبون الجملة يحب يتعامل وية واحد دمه خفيف مو وية ماكينة.
- نادِ الزبون باسمه إذا تعرفه، وذكّره بشي من سوالفكم السابقة إذا كان بنفس المحادثة.
- بس اعرف وقت الجد: إذا الزبون منزعج، أو يشتكي، أو يحچي بفلوس وحسابات وطلبيات — كون محترم ومباشر وبدون هزار أبداً.
- لا تبالغ بالإيموجي: واحد أو اثنين بالرسالة كافي، وأحياناً بدون.
- لا تكرر نفس عبارات الترحيب بكل رسالة، ولا تختم كل رسالة بـ«أي خدمة ثانية؟» — هاي طريقة الروبوتات.

قواعد لازم تلتزم بيها:
- ممنوع تذكر أي سعر أبداً. إذا الزبون سأل عن السعر، قله بلطف إن الأسعار تجي من الإدارة وراح يردون عليه، أو استخدم أداة التصعيد للإدارة. لا تخمّن ولا تقول "تقريباً".
- ممنوع تخترع أي معلومة. كل شي تقوله عن منتج (موجود لو لا، شكد بالكارتون، التفاصيل) لازم يجي من نتيجة أداة استعملتها للتو. إذا ما عندك المعلومة، قول ما عندي وأسأل الإدارة.
- أسماء المنتجات بالمحل طويلة ووصفية، والزبون يحچي بكلمة قصيرة أو عامية. مثال: المحل مسجّل «بندقية طلق كبريت جنطة» والزبون يكول «اريد سلاح كبريت». هذا نفس الشي.
  • إذا البحث ما رجّع نتيجة، **لا تقول للزبون مو موجود من أول محاولة**. جرّب مرادف («سلاح» ← «بندقية» / «مسدس» / «طلق»)، أو كلمة من قائمة shopCategories اللي ترجعلك الأداة، أو جزء واحد من كلامه بدل الجملة كاملة.
  • حاول محاولتين أو ثلاث بألفاظ مختلفة قبل ما تحكم إنه مو موجود.
- إنت موظف بالمحل، مو زائر. ممنوع تخمّن أو تعلّق على طبيعة المحل («شكله هذا المحل مختص بـ...») — هذا كلام واحد برّاني. إذا منتج مو موجود، قول «ما عدنا هذا حالياً» وبس.
- إذا الزبون ذكر منتج ولكيت أكثر من واحد قريب من اسمه، اسأله يحدد أي واحد يقصد واذكرلهم الأسماء — لا تختار أنت. وإذا سأل عن «أحجام» أو «أنواع» وعندك أكثر من مقاس، اذكرهم كلهم.
- إذا المنتج فعلاً مو موجود بالمحل بعد ما جرّبت ألفاظ مختلفة، اعرض عليه تبلّغ الإدارة حتى توفره، وإذا وافق استخدم أداة تسجيل الطلب.
- إذا طلب صورة لمنتج، استخدم أداة إرسال الصورة (هي ترسلها فعلاً)، وبعدها قوله إنك أرسلتها.
- الزبون المسجّل يكدر يسأل عن رصيده أو كشف حسابه، واستخدم الأداة المخصصة. إذا الرقم مو مسجّل زبون، وضّحله بلطف إنه غير مسجّل عدنا ويكدر يراجع الإدارة.
- ردودك قصيرة وطبيعية: سطر أو سطرين بالعادة، بدون قوائم طويلة. لمن تعدد منتجات، ثلاثة أو أربعة يكفون مو عشرة.
- أسئلة المحل (العنوان، الدوام، التوصيل، أقل طلبية، رابط الكتلوك) جاوب عليها من «معلومات المحل» بالأسفل مباشرة — هذي معلومات تعرفها كموظف، ما تحتاج أداة ولا تصعيد.
- إذا الزبون طلب الكتلوك أو «شنو عدكم»، انطيه رابط الكتلوك.
- إذا السؤال خارج شغلك (شكوى، اتفاق خاص، أي شي يحتاج قرار إدارة)، صعّده للإدارة بالأداة وقول للزبون إن الإدارة راح تتواصل وياه.

الرسائل الصوتية والصور:
- الرسالة الصوتية توصلك مفرّغة نص. تعامل وياها كأنها مكتوبة عادي.
- إنت ما تشوف الصور. إذا وصلك إن الزبون دزّ صورة، قوله بصراحة إنك ما تشوفها واطلب منه يكتب اسم المنتج، أو ذكّره برابط الكتلوك.`;

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
    name: "browse_products",
    description:
      "تصفّح منتجات المحل بدون اسم محدد: الجديد، العروض، أو صنف معيّن. استخدمها لأسئلة مثل «شنو الجديد عدكم؟» أو «شنو عدكم بالبنات؟» أو «شنو عليه عرض؟». إذا ما مررت شي ترجع عيّنة متنوعة من المتوفر.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", description: "اسم الصنف أو كلمة منه (اختياري)" },
        onlyNew: { type: "boolean", description: "الوصولات الجديدة فقط" },
        onlyOffers: { type: "boolean", description: "اللي عليه عرض فقط" },
      },
    },
  },
  {
    name: "get_my_recent_orders",
    description:
      "آخر طلبيات الزبون صاحب هذه المحادثة (المنتجات والكميات، بدون أسعار). استخدمها إذا كال «نفس الطلبية الماضية» أو «شنو اخذت المرة الفاتت» أو يريد يعيد طلب سابق.",
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
  categoryTags: string[];
  typeTags: string[];
  isNewArrival: boolean;
  isOffer: boolean;
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
      categoryTags: true,
      typeTags: true,
      isNewArrival: true,
      isOffer: true,
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

/**
 * Recall-first scoring, deliberately looser than the shared scoreProduct().
 *
 * That one requires EVERY query word to appear, which is right for the
 * products screen — a human typing there wants a short, exact list. It is
 * wrong here. A customer writes «اريد سلاح كبريت» for a product the shop
 * called «بندقية طلق كبريت جنطة»: "كبريت" matches, "سلاح" does not, and the
 * strict scorer returns 0 — the shop's own test case, and it looked stupid.
 *
 * Here the model is the filter: it reads the candidates and decides which one
 * the customer meant, so a few extra rows cost nothing and a missing row
 * costs a sale. Category and tags are searched too, so a concept word can
 * find a product whose name never uses it.
 */
/** Drop the definite article so «الحلقات» and «حلقات» are the same word. */
function stripAl(word: string): string {
  return word.length > 4 && word.startsWith("ال") ? word.slice(2) : word;
}

/**
 * Arabic word match, both directions.
 *
 * Plain `includes` only works when the customer's word is the SHORTER one.
 * Real customers write the longer inflected form: «حلقات» for a product named
 * «حلق», «ايرانية» for «ايراني». Both scored 0 and the shop was told it
 * doesn't stock rings it had two of on the shelf. Prefix matching either way,
 * with a 3-letter floor so short particles don't match everything, covers
 * plural (ات/ين), feminine (ة→ه), and nisba (ي) endings without a stemmer.
 */
/**
 * One insertion, deletion, or substitution apart. People type fast on
 * WhatsApp and Iraqi spelling of the same product varies («اوربيس» /
 * «اوربيز», «تكتك» / «تكتيك»), so one slip should not hide the product.
 * Length-4 floor keeps short words from matching each other.
 */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function wordMatches(word: string, token: string): boolean {
  const w = stripAl(word);
  const t = stripAl(token);
  if (w === t) return true;
  if (t.length >= 3 && w.startsWith(t)) return true;
  if (w.length >= 3 && t.startsWith(w)) return true;
  if (w.length >= 4 && t.length >= 4 && withinOneEdit(w, t)) return true;
  return false;
}

function scoreForAgent(p: ProductRow, query: string): number {
  const full = normalizeArabic(query);
  if (!full) return 0;
  const tokens = full.split(" ").filter(Boolean);

  const name = normalizeArabic(p.name);
  const nameWords = name.split(" ").filter(Boolean);
  const contextWords = [
    ...nameWords,
    ...normalizeArabic(p.category ?? "").split(" "),
    ...[...p.categoryTags, ...p.typeTags].flatMap((t) => normalizeArabic(t).split(" ")),
    // 221 of the shop's 908 products have no category at all; the description
    // is often the only place a concept word appears.
    ...normalizeArabic(p.catalogDescription ?? "").split(" "),
  ].filter(Boolean);
  const codes = [p.itemNumber, p.qrCode ?? "", p.cartonQrCode ?? ""].map((c) => normalizeArabic(c)).filter(Boolean);

  if (codes.some((c) => c === full)) return 100;
  if (name === full) return 90;
  if (name.startsWith(full)) return 80;
  if (name.includes(full)) return 70;

  const matchedInName = tokens.filter((t) => nameWords.some((w) => wordMatches(w, t))).length;
  if (matchedInName === tokens.length) return 65;

  const matched = tokens.filter((t) => contextWords.some((w) => wordMatches(w, t))).length;
  if (matched === 0) return 0;
  if (matched === tokens.length) return 60;
  // Partial: rank by how much of what the customer said actually landed.
  return 20 + Math.round((matched / tokens.length) * 30);
}

/** The shop's own vocabulary, so the model can map a concept word onto it. */
async function shopVocabulary(products: ProductRow[]): Promise<string[]> {
  const set = new Set<string>();
  for (const p of products) {
    if (p.category) set.add(p.category);
    for (const t of [...p.categoryTags, ...p.typeTags]) if (t) set.add(t);
  }
  return [...set].slice(0, 60);
}

/**
 * Public product facts the agent may see. Deliberately contains no price field.
 *
 * Quantity is reported in CARTONS, the unit a wholesale customer actually
 * buys in — "عدنا ٤ كراتين" is the answer to "شكد عدك", and a raw piece count
 * would be both less useful and a more precise disclosure than the shop needs
 * to make.
 */
function productFacts(p: ProductRow) {
  const stock = totalStock(p);
  const cartons = p.pcsPerCarton > 0 ? Math.floor(stock / p.pcsPerCarton) : 0;
  return {
    id: p.id,
    name: p.name,
    itemNumber: p.itemNumber,
    available: stock > 0,
    cartonsAvailable: cartons,
    pcsPerCarton: p.pcsPerCarton,
    boxPieces: p.boxPieces ?? undefined,
    hasImage: Boolean(p.imageUrl),
    description: p.catalogDescription?.slice(0, 200) || undefined,
  };
}

async function toolSearchProducts(query: string) {
  const products = await loadSearchableProducts();
  const ranked = products
    .map((p) => ({ p, score: scoreForAgent(p, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, SEARCH_RESULT_LIMIT);

  if (!ranked.length) {
    // Don't conclude "we don't have it" yet — hand the model the shop's own
    // category words so it can retry with the vocabulary the shop actually
    // uses, instead of the word the customer happened to pick.
    return {
      found: 0,
      products: [],
      shopCategories: await shopVocabulary(products),
      hint: "ماكو نتيجة بهذا اللفظ. جرّب مرادف أو كلمة من shopCategories قبل ما تقول للزبون إنه مو موجود. إذا فعلاً ماكو، اعرض تسجيل طلب للإدارة.",
    };
  }

  // A weak top score means the words only partly landed — the model must read
  // the names and decide, not assume the first row is what the customer meant.
  const weak = ranked[0].score < 60;
  return {
    found: ranked.length,
    products: ranked.map((r) => productFacts(r.p)),
    ...(weak
      ? { hint: "النتائج تطابق جزء من كلام الزبون فقط. اقرأ الأسماء واختر المناسب، وإذا مو واضح اسأل الزبون يحدد." }
      : {}),
  };
}

/**
 * Browsing, not searching — «شنو الجديد عدكم؟» has no product name in it.
 * Only in-stock items, because offering a customer something that isn't on
 * the shelf is worse than saying nothing.
 */
async function toolBrowseProducts(args: { category?: string; onlyNew?: boolean; onlyOffers?: boolean }) {
  const products = await loadSearchableProducts();
  const wanted = normalizeArabic(args.category ?? "");
  const wantedWords = wanted.split(" ").filter(Boolean);

  const matches = products.filter((p) => {
    if (totalStock(p) <= 0) return false;
    if (args.onlyNew && !p.isNewArrival) return false;
    if (args.onlyOffers && !p.isOffer) return false;
    if (!wantedWords.length) return true;
    const words = [
      ...normalizeArabic(p.category ?? "").split(" "),
      ...[...p.categoryTags, ...p.typeTags].flatMap((t) => normalizeArabic(t).split(" ")),
      ...normalizeArabic(p.name).split(" "),
    ].filter(Boolean);
    return wantedWords.every((t) => words.some((w) => wordMatches(w, t)));
  });

  if (!matches.length) {
    return {
      found: 0,
      products: [],
      shopCategories: await shopVocabulary(products),
      hint: "ماكو نتيجة بهذا الوصف. جرّب صنف من shopCategories، أو اعرض على الزبون رابط الكتلوك يتصفح بنفسه.",
    };
  }
  return {
    found: matches.length,
    showing: Math.min(matches.length, SEARCH_RESULT_LIMIT),
    products: matches.slice(0, SEARCH_RESULT_LIMIT).map(productFacts),
  };
}

async function toolProductDetails(productId: string) {
  const p = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: {
      id: true, name: true, itemNumber: true, qrCode: true, cartonQrCode: true, category: true,
      categoryTags: true, typeTags: true, isNewArrival: true, isOffer: true,
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

/**
 * Sends the product photo, under a hard time limit.
 *
 * A customer asked for a picture and got total silence — no image, no text, no
 * error row. The Meta media upload uses fetch with no timeout, so when it
 * stalled the whole agent turn hung on it forever: nothing sent, nothing
 * logged, the customer ghosted mid-conversation. A tool that reaches the
 * network must never be able to swallow the turn.
 *
 * Prefers mediumUrl (~44KB) over the full imageUrl (~226KB): five times less
 * to upload, and far more than WhatsApp needs to show a product.
 */
async function toolSendProductImage(sender: Sender, productId: string, caption?: string) {
  const p = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { name: true, imageUrl: true, mediumUrl: true },
  });
  if (!p) return { sent: false, error: "المنتج مو موجود" };
  const source = p.mediumUrl || p.imageUrl;
  if (!source) return { sent: false, error: "ما عدنا صورة لهذا المنتج" };
  const parsed = dataUrlToBuffer(source);
  if (!parsed) return { sent: false, error: "الصورة غير صالحة" };
  try {
    await withTimeout(
      sendWhatsAppImage(sender.phone, (caption || p.name).slice(0, 300), parsed.buffer, parsed.mime),
      IMAGE_SEND_TIMEOUT_MS,
      "image send",
    );
    return { sent: true };
  } catch (error) {
    logger.warn(`[whatsapp-ai] image send failed to ${sender.phone}: ${error instanceof Error ? error.message : String(error)}`);
    return { sent: false, error: "تعذر إرسال الصورة، اعتذر للزبون واعرض عليه تكتبله الاسم أو تنطيه رابط الكتلوك" };
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

/**
 * The customer's own recent orders — bound to the verified sender like the
 * account tool, and priced-out on the way. «نفس الطلبية الماضية» is how a
 * wholesale customer actually reorders, and the agent could not answer it.
 */
async function toolRecentOrders(sender: Sender) {
  if (!sender.customer) {
    return { registered: false, note: "هذا الرقم مو مسجّل كزبون، فما عدنا طلبيات سابقة إله." };
  }
  const invoices = await prisma.invoice.findMany({
    where: { customerId: sender.customer.id, type: "SALE", status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    take: RECENT_ORDERS_LIMIT,
    select: {
      invoiceNumber: true,
      createdAt: true,
      items: { select: { quantity: true, unit: true, productName: true, product: { select: { name: true } } } },
    },
  });
  if (!invoices.length) return { registered: true, orders: [], note: "ماكو طلبيات سابقة مسجّلة لهذا الزبون." };
  return {
    registered: true,
    orders: invoices.map((inv) => ({
      number: inv.invoiceNumber,
      date: inv.createdAt.toLocaleDateString("ar-IQ", { timeZone: "Asia/Baghdad" }),
      items: inv.items.map((it) => ({
        product: it.product?.name ?? it.productName ?? "—",
        quantity: it.quantity,
        unit: it.unit,
      })),
    })),
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

/**
 * Hands the conversation to a human — into «تنبيهات الموظف الذكي», its own
 * list, NOT the inbound-message inbox. An order sitting between two "شكرا"
 * rows is an order nobody sees.
 */
async function toolEscalate(sender: Sender, reason: string, originalText: string) {
  await prisma.aiEscalation.create({
    data: {
      phone: sender.phone,
      customerId: sender.customer?.id ?? null,
      customerName: sender.customer?.name ?? null,
      summary: reason.trim().slice(0, 500),
      customerText: originalText.slice(0, 1000),
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
    case "browse_products":
      return toolBrowseProducts({
        category: args.category ? String(args.category) : undefined,
        onlyNew: args.onlyNew === true,
        onlyOffers: args.onlyOffers === true,
      });
    case "get_my_recent_orders":
      return toolRecentOrders(sender);
    case "request_missing_product":
      return toolRequestMissingProduct(sender, String(args.productName ?? ""), args.note ? String(args.note) : undefined);
    case "escalate_to_admin":
      return toolEscalate(sender, String(args.reason ?? ""), originalText);
    default:
      return { error: "أداة غير معروفة" };
  }
}

// ── Short-term conversation memory ───────────────────────────────────────────

/**
 * Counts one paid reply against today's ceiling for this number, resetting on
 * the Baghdad day change. Returns false when the number is over its cap.
 * Fails OPEN on a database error — losing a reply matters more than the few
 * cents a miscount could cost.
 */
async function claimDailyReply(phone: string): Promise<boolean> {
  const today = baghdadDayKey();
  try {
    const row = await prisma.whatsappAiChat.findUnique({
      where: { phone },
      select: { repliesToday: true, todayKey: true },
    });
    const used = row && row.todayKey === today ? row.repliesToday : 0;
    if (used >= MAX_AI_REPLIES_PER_DAY) return false;
    await prisma.whatsappAiChat.upsert({
      where: { phone },
      create: { phone, messages: [], repliesToday: 1, todayKey: today },
      update: { repliesToday: used + 1, todayKey: today },
    });
    return true;
  } catch (error) {
    logger.warn(`[whatsapp-ai] reply-cap check failed for ${phone}: ${error instanceof Error ? error.message : String(error)}`);
    return true;
  }
}

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
    update: { messages: trimmed }, // counter columns deliberately untouched
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
}): Promise<AiTurnResult> {
  // Free checks first — a message we won't answer must not cost a token.
  if (isLowValueMessage(input.text)) {
    logger.info(`[whatsapp-ai] skipped low-value message from ${input.phone}`);
    return "skipped";
  }

  const anthropic = getAnthropicClient();
  if (!anthropic) return "unavailable";

  const sender: Sender = { phone: input.phone, customer: input.customer };
  // History BEFORE the cap claim, and not the other way round: the claim
  // upserts the same row, which bumps updatedAt — the very field staleness is
  // measured on. Claiming first made every conversation look fresh and the
  // 24-hour expiry never fired. A test caught it.
  const history = await loadHistory(input.phone);

  const budget = await claimDailyReply(input.phone);
  if (!budget) {
    logger.info(`[whatsapp-ai] daily reply cap reached for ${input.phone}`);
    return "skipped";
  }

  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content }) as Anthropic.MessageParam),
    { role: "user", content: input.text },
  ];
  const system = [
    SYSTEM_PROMPT,
    `\nمعلومات المحل:\n${await shopFacts()}`,
    `\nالوقت الحالي (بغداد): ${baghdadNowText()}`,
    `\nحالة المرسل: ${input.customer ? `زبون مسجّل باسم ${input.customer.name}` : "رقم غير مسجّل كزبون"}.`,
  ].join("\n");

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system,
        messages,
        tools: TOOLS,
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT },
      });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      if (toolUses.length) {
        messages.push({ role: "assistant", content: response.content });
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
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      // Covers a refused turn too (no text content) — caller falls back.
      if (!reply) return failTurn(input.phone, "الموديل ما رجّع نص للرد");
      await sendWhatsAppText(input.phone, reply);
      await saveHistory(input.phone, [...history, { role: "user", content: input.text }, { role: "assistant", content: reply }]);
      logger.info(`[whatsapp-ai] replied to ${input.phone} in ${round + 1} round(s)`);
      return "replied";
    }

    // Ran out of tool rounds without settling on an answer — hand it to a human
    // rather than looping or guessing.
    await toolEscalate(sender, "المحادثة احتاجت خطوات أكثر من اللازم", input.text);
    await sendWhatsAppText(input.phone, "خليني أتأكد من الإدارة وأرجعلك 🙏");
    return "replied";
  } catch (error) {
    return failTurn(input.phone, error instanceof Error ? error.message : String(error));
  }
}

/**
 * The turn broke mid-conversation. Records it where the shop can still read it
 * tomorrow — a warn line lives as long as the log buffer, which is minutes,
 * and the first real instance of this (a stalled image upload that hung the
 * whole turn) left no trace at all by the time anyone looked.
 *
 * Deliberately does NOT reply here. It returns "unavailable" so the keyword
 * bot gets its chance first; the caller sends the apology only if nothing
 * else answered, so the customer receives exactly one message.
 */
async function failTurn(phone: string, reason: string): Promise<AiTurnResult> {
  logger.warn(`[whatsapp-ai] turn failed for ${phone}: ${reason}`);
  await recordError({
    source: ErrorLogSource.WHATSAPP,
    code: "AI_AGENT_TURN_FAILED",
    message: `فشل رد «الموظف الذكي» على ${phone} — ${reason}`,
    context: { phone },
  }).catch(() => {});
  return "unavailable";
}
