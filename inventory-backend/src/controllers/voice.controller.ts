import Groq from "groq-sdk";
import { PaymentType, Unit, VoucherType } from "@prisma/client";
import prisma from "../config/database";
import { createInvoice } from "../services/invoice.service";
import { createVoucher } from "../services/voucher.service";
import { resolveShopWarehouseId } from "../services/warehouse-stock.service";
import { answerKnownInventoryQuestion } from "./agent.controller";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!process.env.GROQ_API_KEY) throw new AppError("خدمة الصوت غير مفعلة", 503, "GROQ_NOT_CONFIGURED");
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

type ChatMessage = { role: "user" | "assistant"; content: string };

export interface VoicePlanItem {
  productId: string;
  productName: string;
  quantity: number;
  unit: Unit;
  unitPrice: number;
  totalPrice: number;
  warehouseId?: string;
  warehouseName?: string;
}

export interface VoicePlan {
  operation: "INVOICE" | "VOUCHER";
  customerId: string;
  customerName: string;
  items?: VoicePlanItem[];
  totalAmount?: number;
  paymentType?: PaymentType;
  paidAmount?: number;
  amount?: number;
  voucherType?: VoucherType;
}

type ParsedIntent = {
  type: "INVOICE" | "VOUCHER" | "QUESTION" | "CANCEL" | "OUT_OF_SCOPE";
  customerName?: string | null;
  items?: Array<{
    productName?: string | null;
    quantity?: number | null;
    unit?: Unit | null;
    unitPrice?: number | null;
  }>;
  paymentType?: PaymentType | null;
  paidAmount?: number | null;
  amount?: number | null;
  voucherType?: VoucherType | null;
  missing?: string[];
};

type VoiceDraft = {
  type?: "INVOICE" | "VOUCHER";
  customerName?: string | null;
  customerSuggestions?: string[];
  warehouseName?: string | null;
  warehouseSuggestions?: string[];
  productSuggestions?: string[];
  pendingProductName?: string | null;
  items?: Array<{
    productName?: string | null;
    quantity?: number | null;
    unit?: Unit | null;
    unitPrice?: number | null;
  }>;
  paymentType?: PaymentType | null;
  paidAmount?: number | null;
  amount?: number | null;
  voucherType?: VoucherType | null;
};

function sanitizeDraft(input: unknown): VoiceDraft {
  if (!input || typeof input !== "object") return {};
  const value = input as VoiceDraft;
  return {
    type: value.type === "INVOICE" || value.type === "VOUCHER" ? value.type : undefined,
    customerName: typeof value.customerName === "string" ? value.customerName.slice(0, 120) : null,
    customerSuggestions: Array.isArray(value.customerSuggestions)
      ? value.customerSuggestions
          .filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
          .slice(0, 4)
          .map((name) => name.slice(0, 120))
      : [],
    warehouseName: typeof value.warehouseName === "string" ? value.warehouseName.slice(0, 120) : null,
    warehouseSuggestions: Array.isArray(value.warehouseSuggestions)
      ? value.warehouseSuggestions
          .filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
          .slice(0, 6)
          .map((name) => name.slice(0, 120))
      : [],
    productSuggestions: Array.isArray(value.productSuggestions)
      ? value.productSuggestions
          .filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
          .slice(0, 6)
          .map((name) => name.slice(0, 160))
      : [],
    pendingProductName:
      typeof value.pendingProductName === "string" ? value.pendingProductName.slice(0, 160) : null,
    items: Array.isArray(value.items)
      ? value.items.slice(0, 30).map((item) => ({
          productName: typeof item?.productName === "string" ? item.productName.slice(0, 160) : null,
          quantity: Number.isFinite(Number(item?.quantity)) ? Number(item?.quantity) : null,
          unit: Object.values(Unit).includes(item?.unit as Unit) ? item.unit : null,
          unitPrice: Number.isFinite(Number(item?.unitPrice)) ? Number(item?.unitPrice) : null,
        }))
      : [],
    paymentType: Object.values(PaymentType).includes(value.paymentType as PaymentType)
      ? value.paymentType
      : null,
    paidAmount: Number.isFinite(Number(value.paidAmount)) ? Number(value.paidAmount) : null,
    amount: Number.isFinite(Number(value.amount)) ? Number(value.amount) : null,
    voucherType: Object.values(VoucherType).includes(value.voucherType as VoucherType)
      ? value.voucherType
      : null,
  };
}

export function mergeDraftItems(parsed: ParsedIntent, current: VoiceDraft, command = "") {
  if (!parsed.items?.length) return current.items;
  const normalizedCommand = normalizeIraqiText(command);
  const parsedItems = parsed.items.map((item, index) => {
    const previous = current.items?.find(
      (candidate) =>
        candidate.productName &&
        item.productName &&
        normalizeIraqiText(candidate.productName) === normalizeIraqiText(item.productName)
    ) ?? current.items?.[index];
    return {
      productName: item.productName ?? previous?.productName ?? null,
      quantity: item.quantity ?? previous?.quantity ?? null,
      unit: item.unit ?? previous?.unit ?? null,
      unitPrice: item.unitPrice ?? previous?.unitPrice ?? null,
    };
  });

  if (/(ضيف|اضف|زود|وياها|وياه)/.test(normalizedCommand) && current.items?.length) {
    if (parsedItems.length > current.items.length) return parsedItems;
    return [...current.items, ...parsedItems];
  }

  if (/(شيل|احذف|امسح|الغ ماده|الغي ماده)/.test(normalizedCommand) && current.items?.length) {
    const commandNames = parsedItems
      .map((item) => normalizeIraqiText(item.productName ?? ""))
      .filter((name) => name && normalizedCommand.includes(name));
    if (commandNames.length) {
      return current.items.filter((item) => {
        const name = normalizeIraqiText(item.productName ?? "");
        return !commandNames.some((candidate) => name.includes(candidate) || candidate.includes(name));
      });
    }
    if (
      parsedItems.length < current.items.length &&
      parsedItems.every((parsedItem) =>
        current.items?.some(
          (currentItem) =>
            normalizeIraqiText(currentItem.productName ?? "") ===
            normalizeIraqiText(parsedItem.productName ?? "")
        )
      )
    ) {
      return parsedItems;
    }
    const names = parsedItems
      .map((item) => normalizeIraqiText(item.productName ?? ""))
      .filter(Boolean);
    return current.items.filter((item) => {
      const name = normalizeIraqiText(item.productName ?? "");
      return !names.some((candidate) => name.includes(candidate) || candidate.includes(name));
    });
  }

  if (current.items?.length && parsedItems.length === 1 && current.items.length > 1) {
    const incoming = parsedItems[0];
    const targetIndex = current.items.findIndex(
      (item) =>
        item.productName &&
        incoming.productName &&
        normalizeIraqiText(item.productName) === normalizeIraqiText(incoming.productName)
    );
    const index = targetIndex >= 0 ? targetIndex : current.items.length - 1;
    return current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...incoming } : item);
  }

  return parsedItems;
}

function draftFromParsed(
  parsed: ParsedIntent,
  current: VoiceDraft = {},
  customerName?: string,
  warehouseName?: string,
  command = ""
): VoiceDraft {
  return sanitizeDraft({
    type: parsed.type === "INVOICE" || parsed.type === "VOUCHER" ? parsed.type : current.type,
    customerName: customerName ?? parsed.customerName ?? current.customerName,
    customerSuggestions: [],
    warehouseName: warehouseName ?? current.warehouseName,
    warehouseSuggestions: [],
    productSuggestions: [],
    pendingProductName: null,
    items: mergeDraftItems(parsed, current, command),
    paymentType: parsed.paymentType ?? current.paymentType,
    paidAmount: parsed.paidAmount ?? current.paidAmount,
    amount: parsed.amount ?? current.amount,
    voucherType: parsed.voucherType ?? current.voucherType,
  });
}

export function shortReplyHint(command: string, draft: VoiceDraft) {
  if (!draft.type) return "";
  const text = normalizeIraqiText(command);
  if (/^(نقد|نقدا|كاش|واصل|مدفوع)$/.test(text)) {
    return "تعليمات مؤكدة: غيّر paymentType إلى CASH واحتفظ بكل المسودة.";
  }
  if (/^(اجل|دين|بالحساب|حساب)$/.test(text)) {
    return "تعليمات مؤكدة: غيّر paymentType إلى CREDIT واحتفظ بكل المسودة.";
  }
  if (/^(جزئي|دفع جزئي|قسم منه)$/.test(text)) {
    return "تعليمات مؤكدة: غيّر paymentType إلى PARTIAL واحتفظ بكل المسودة، وإذا paidAmount غير معروف ضعه في missing.";
  }
  if (/^(قطعه|قطعة|حبه|حبة)$/.test(text)) {
    return "تعليمات مؤكدة: غيّر وحدة آخر مادة إلى PIECE واحتفظ بكل المسودة.";
  }
  if (/^(كارتون|كارتونه|كرتون|كرتونه)$/.test(text)) {
    return "تعليمات مؤكدة: غيّر وحدة آخر مادة إلى CARTON واحتفظ بكل المسودة.";
  }
  if (/^(درزن|دزينة|دزينه)$/.test(text)) {
    return "تعليمات مؤكدة: غيّر وحدة آخر مادة إلى DOZEN واحتفظ بكل المسودة.";
  }
  if (/^(كمل|استمر|راجع|اعرضها|اعرض المسوده)$/.test(text)) {
    return "تعليمات مؤكدة: احتفظ بكل المسودة الحالية وأرجعها كعملية كاملة جاهزة للمراجعة.";
  }
  return "";
}

export function normalizeIraqiText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[چژ]/g, "ج")
    .replace(/[گڭ]/g, "ك")
    .replace(/پ/g, "ب")
    .replace(/ڤ/g, "ف")
    .replace(/ـ/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function greetingReply(command: string) {
  const text = normalizeIraqiText(command);
  if (/^(هلا|هلو|مرحبا|السلام عليكم|سلام عليكم|شلونك|شلونك حجي|شخبارك|صباح الخير|مساء الخير)$/.test(text)) {
    return "هلا حجي، بخير دامك بخير. آني حاضر، گلي شتريد أسوي بالمخزون أو الفواتير.";
  }
  if (/^(شكرا|مشكور|عاشت ايدك|تسلم|حبيبي)$/.test(text)) {
    return "تدلل حجي، آني حاضر.";
  }
  return null;
}

function levenshtein(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, index) => index);
  for (let j = 1; j <= b.length; j += 1) {
    let previous = rows[0];
    rows[0] = j;
    for (let i = 1; i <= a.length; i += 1) {
      const current = rows[i];
      rows[i] = Math.min(
        rows[i] + 1,
        rows[i - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      previous = current;
    }
  }
  return rows[a.length];
}

export function matchScore(query: string, candidate: string) {
  const q = normalizeIraqiText(query);
  const c = normalizeIraqiText(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (c.includes(q) || q.includes(c)) return 0.92;
  const qTokens = q.split(" ").filter((token) => token.length > 1);
  const cTokens = c.split(" ").filter((token) => token.length > 1);
  const tokenScores = qTokens.map((queryToken) =>
    Math.max(
      0,
      ...cTokens.map((candidateToken) => {
        if (queryToken === candidateToken) return 1;
        if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) return 0.9;
        return 1 - levenshtein(queryToken, candidateToken) /
          Math.max(queryToken.length, candidateToken.length);
      })
    )
  );
  const tokenScore = tokenScores.length
    ? tokenScores.reduce((sum, score) => sum + score, 0) / tokenScores.length
    : 0;
  const distance = levenshtein(q, c);
  const fullScore = Math.max(0, 1 - distance / Math.max(q.length, c.length));
  return Math.max(tokenScore * 0.96, fullScore);
}

function bestMatches<T extends { name: string }>(query: string, rows: T[]) {
  return rows
    .map((row) => ({ row, score: matchScore(query, row.name) }))
    .filter((entry) => entry.score >= 0.48)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

export function chooseMatch<T extends { name: string }>(query: string, rows: T[]) {
  const normalizedQuery = normalizeIraqiText(query);
  const exact = rows.filter((row) => normalizeIraqiText(row.name) === normalizedQuery);
  if (exact.length === 1) {
    return { match: exact[0], suggestions: [exact[0].name] };
  }
  const matches = bestMatches(query, rows);
  if (!matches.length) return { match: null, suggestions: [] as string[] };
  const first = matches[0];
  const second = matches[1];
  const isCertain = first.score >= 0.78 && (!second || first.score - second.score >= 0.08);
  return {
    match: isCertain ? first.row : null,
    suggestions: matches.map((entry) => entry.row.name),
  };
}

export function resolvePendingCustomerSelection(command: string, draft: VoiceDraft) {
  const suggestions = draft.customerSuggestions ?? [];
  if (!suggestions.length) return null;

  const normalized = normalizeIraqiText(command);
  if (/^(اي|اي هو|نعم|هو|تمام|صح|هذا|هذا هو)$/.test(normalized)) {
    return suggestions[0];
  }

  const cleaned = normalized
    .replace(/^(لا\s+)?(فقط|بس|اقصد|قصدي)\s+/, "")
    .replace(/^هو\s+/, "")
    .trim();
  if (!cleaned) return null;

  const exact = suggestions.find((name) => normalizeIraqiText(name) === cleaned);
  if (exact) return exact;

  const ranked = suggestions
    .map((name) => ({ name, score: matchScore(cleaned, name) }))
    .sort((a, b) => b.score - a.score);
  if (ranked[0]?.score >= 0.78 && (!ranked[1] || ranked[0].score - ranked[1].score >= 0.08)) {
    return ranked[0].name;
  }
  return null;
}

export function resolveWarehouseSelection(
  command: string,
  draft: VoiceDraft,
  warehouses: Array<{ name: string }>
) {
  const normalized = normalizeIraqiText(command);
  const pending = draft.warehouseSuggestions ?? [];
  if (pending.length && /^(اي|اي هو|نعم|هو|تمام|صح|هذا|هذا هو)$/.test(normalized)) {
    return pending[0];
  }

  const exactMention = warehouses.find((warehouse) =>
    normalized.includes(normalizeIraqiText(warehouse.name))
  );
  if (exactMention) return exactMention.name;

  const ordinal = normalized.match(/(?:مخزن|المخزن)\s*(الاول|الاولى|الثاني|الثانيه|الثالث|الثالثه)/);
  if (ordinal) {
    const index = /الاول/.test(ordinal[1]) ? 0 : /الثاني/.test(ordinal[1]) ? 1 : 2;
    return warehouses[index]?.name ?? null;
  }

  if (!pending.length) return null;
  const cleaned = normalized.replace(/^(خذ|اخذ|اسحب|من)\s+/, "").replace(/^مخزن\s+/, "").trim();
  const exactPending = pending.find((name) => normalizeIraqiText(name) === cleaned);
  if (exactPending) return exactPending;
  const ranked = pending
    .map((name) => ({ name, score: matchScore(cleaned, name) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 0.72 ? ranked[0].name : null;
}

export function resolvePendingProductSelection(command: string, draft: VoiceDraft) {
  const suggestions = draft.productSuggestions ?? [];
  if (!suggestions.length) return null;
  const normalized = normalizeIraqiText(command);
  if (/^(اي|اي هو|نعم|هو|تمام|صح|هذا|هذا هو)$/.test(normalized)) return suggestions[0];
  const exact = suggestions.find((name) => normalizeIraqiText(name) === normalized);
  if (exact) return exact;
  const ranked = suggestions
    .map((name) => ({ name, score: matchScore(normalized, name) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 0.78 ? ranked[0].name : null;
}

export function applyDeterministicDraftEdits(command: string, draft: VoiceDraft) {
  const normalized = normalizeIraqiText(command);
  const next = sanitizeDraft(draft);
  const items = [...(next.items ?? [])];
  const last = items.at(-1);

  if (/(^|\s)(نقد|كاش)(\s|$)/.test(normalized)) next.paymentType = PaymentType.CASH;
  if (/(^|\s)(اجل|دين|بالحساب)(\s|$)/.test(normalized)) next.paymentType = PaymentType.CREDIT;

  if (last) {
    const priceMatch = normalized.match(
      /(?:بسعر|سعر(?: القطعه| الكارتون| الدزينه)?|غير السعر|خلي السعر)\s*(\d+(?:\.\d+)?)/
    );
    if (priceMatch) last.unitPrice = Number(priceMatch[1]);

    const quantityMatch =
      normalized.match(/(?:العدد|الكميه|غير العدد|خلي العدد|خلي الكميه)\s*(\d+)/) ??
      normalized.match(/(\d+)\s*(?:قطعه|قطع|حبه|حبات|كارتون|كرتون|درزن|دزينه)/);
    if (quantityMatch) last.quantity = Number(quantityMatch[1]);

    if (/(كارتون|كرتون)/.test(normalized)) last.unit = Unit.CARTON;
    else if (/(درزن|دزينه)/.test(normalized)) last.unit = Unit.DOZEN;
    else if (/(قطعه|قطع|حبه|حبات)/.test(normalized)) last.unit = Unit.PIECE;
  }

  next.items = items;
  return sanitizeDraft(next);
}

function parseJson(content: string | null | undefined): ParsedIntent {
  try {
    return JSON.parse(content ?? "{}") as ParsedIntent;
  } catch {
    throw new AppError("ما قدرت أفهم الطلب، حاول تصيغه بطريقة ثانية", 422, "PARSE_ERROR");
  }
}

const domainSystemPrompt = `أنت مساعد نظام مخزون ومحاسبة عراقي. تفهم اللهجة العراقية العامة، لكن مجال كلامك محصور حصراً بعمل النظام: المواد، المخزون، المخازن، الزبائن، الموردين، الفواتير، السندات، المرتجعات، عروض الأسعار، التقارير، الكتالوج والمستخدمين.

ستستلم أحياناً "المسودة الحالية" وفيها ما فُهم من الكلام السابق. حدّث المسودة حسب آخر رسالة ولا تبدأ من الصفر. أرجع دائماً الطلب كاملاً بعد الدمج، بما فيه المعلومات القديمة التي لم يغيرها المستخدم.

صنف آخر رسالة وأرجع JSON فقط بهذا الشكل:
{
  "type": "INVOICE" | "VOUCHER" | "QUESTION" | "CANCEL" | "OUT_OF_SCOPE",
  "customerName": "الاسم أو null",
  "items": [{"productName":"الاسم", "quantity":1, "unit":"PIECE|DOZEN|CARTON", "unitPrice":null}],
  "paymentType": "CASH|CREDIT|PARTIAL|null",
  "paidAmount": null,
  "amount": null,
  "voucherType": "RECEIPT|PAYMENT|null",
  "missing": []
}

قواعد مهمة:
- افهم الرسالة الحالية مع الرسائل السابقة كطلب واحد مستمر. إذا سألت المستخدم عن معلومة ناقصة وجاوب بكلمة أو جملة قصيرة، أكمل نفس العملية ولا تعتبر جوابه سؤالاً جديداً.
- المسودة الحالية هي المصدر الأقوى للسياق. لا تحذف منها معلومة إلا إذا طلب المستخدم حذفها أو استبدالها.
- إذا قال فقط "نقد" أو "آجل" أو "واصل خمسين"، حدّث الدفع واحتفظ بالزبون والمواد.
- إذا قال رقماً فقط بعد سؤال الكمية، حدّث كمية آخر مادة ناقصة أو آخر مادة مذكورة.
- إذا قال "ضيف وياها..." أضف مادة ولا تستبدل المواد السابقة. إذا قال "شيل..." احذف المادة المقصودة.
- إذا صحح المستخدم معلومة سابقة مثل "لا مو محمد، علي" أو "خليها كارتونين" أو "بدل النقد خليها آجل"، عدّل المعلومة المطلوبة واحتفظ ببقية تفاصيل العملية السابقة.
- كلمات التأكيد مثل "إي"، "تمام"، "ثبتها" لا تنشئ عملية جديدة. التنفيذ النهائي يتم من التطبيق بعد عرض الخطة، لذلك أعد نفس الخطة المكتملة للتأكيد.
- كلمات الإلغاء مثل "لا"، "ألغيها"، "اتركها" تعني أن الطلب السابق انتهى؛ أرجع CANCEL ولا تخترع عملية.
- افهم الأمر حتى بدون كلمة فاتورة. مثال: "سجل كارتون طياره على عباس نقد" = INVOICE، عباس زبون، طياره مادة، الكمية 1، الوحدة CARTON، والدفع CASH.
- "على عباس" أو "لعباس" غالباً اسم الزبون. لا تعتبر كلمة نقد أو آجل جزءاً من الاسم.
- كارتون/كارتونة/كارتونة وحدة CARTON، درزن/دزينة DOZEN، حبة/قطعة PIECE.
- نقد/كاش/واصل كامل = CASH. آجل/دين/بالحساب = CREDIT. واصل جزء أو دفع جزء = PARTIAL واستخرج paidAmount.
- سند قبض يعني RECEIPT، وسند دفع يعني PAYMENT.
- إذا ذكر أكثر من مادة ضعها كلها في items.
- افهم الأرقام باللهجة العراقية: نص/نصف، ربع، واحد، اثنين/ثنين، ثلاثة، عشرة، ألف، آلاف، مليون. وحوّل "خمسين ألف" إلى 50000.
- إذا قال "بسعر كذا" فهذا unitPrice للوحدة المذكورة، وليس المبلغ المدفوع.
- لا تفترض الدفع نقداً إذا المستخدم ما ذكر طريقة الدفع؛ ضع paymentType في missing حتى تسأله: نقد لو آجل؟
- QUESTION فقط لسؤال يخص النظام أو التجارة الموجودة داخله.
- أي سياسة، طب، برمجة عامة، طقس، رياضة، أخبار، دردشة عامة أو موضوع خارج النظام = OUT_OF_SCOPE.
- لا تخترع أسماء أو أرقام. ضع الحقول الناقصة فعلاً في missing.`;

export const parseVoiceCommand = asyncHandler(async (req, res) => {
  const { command, history = [] } = req.body as {
    command?: string;
    history?: ChatMessage[];
    draft?: unknown;
  };
  if (!command?.trim()) throw new AppError("اكتب أو احچي طلبك أولاً", 400, "EMPTY_COMMAND");

  const casualReply = greetingReply(command.trim());
  if (casualReply) {
    return void res.json({ type: "answer", text: casualReply, draft: sanitizeDraft(req.body?.draft) });
  }
  const directInventoryReply = await answerKnownInventoryQuestion(command.trim());
  if (directInventoryReply) {
    return void res.json({
      type: "answer",
      text: directInventoryReply,
      draft: sanitizeDraft(req.body?.draft),
    });
  }
  if (!process.env.GROQ_API_KEY) {
    throw new AppError("خدمة المساعد غير مفعلة على السيرفر", 500, "GROQ_NOT_CONFIGURED");
  }

  const safeHistory = history
    .filter((message) => message?.content?.trim())
    .slice(-8)
    .map((message) => ({ role: message.role, content: message.content.slice(0, 600) }));
  const currentDraft = sanitizeDraft(req.body?.draft);
  const pendingCustomerSelection = resolvePendingCustomerSelection(command.trim(), currentDraft);
  const pendingProductSelection = resolvePendingProductSelection(command.trim(), currentDraft);
  const activeWarehouses = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  const pendingWarehouseSelection = resolveWarehouseSelection(
    command.trim(),
    currentDraft,
    activeWarehouses
  );
  const draftContext = Object.keys(currentDraft).length
    ? `المسودة الحالية:\n${JSON.stringify(currentDraft)}`
    : "لا توجد مسودة حالية.";
  const deterministicHint = shortReplyHint(command.trim(), currentDraft);

  const completion = await getGroq().chat.completions.create({
    model: "llama-3.3-70b-versatile",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: domainSystemPrompt },
      { role: "system", content: draftContext },
      ...(deterministicHint ? [{ role: "system" as const, content: deterministicHint }] : []),
      ...safeHistory,
      { role: "user", content: command.trim() },
    ],
  });
  const parsed = parseJson(completion.choices[0]?.message?.content);
  if (pendingCustomerSelection && currentDraft.type) {
    parsed.type = currentDraft.type;
    parsed.customerName = pendingCustomerSelection;
  }
  if (pendingWarehouseSelection && currentDraft.type) {
    parsed.type = currentDraft.type;
  }
  if (pendingProductSelection && currentDraft.type) {
    parsed.type = currentDraft.type;
    parsed.items = (currentDraft.items ?? []).map((item) => ({
      ...item,
      productName:
        normalizeIraqiText(item.productName ?? "") ===
        normalizeIraqiText(currentDraft.pendingProductName ?? "")
          ? pendingProductSelection
          : item.productName,
    }));
  }
  let nextDraft = draftFromParsed(
    parsed,
    currentDraft,
    pendingCustomerSelection ?? undefined,
    pendingWarehouseSelection ?? undefined,
    command.trim()
  );
  nextDraft = applyDeterministicDraftEdits(command.trim(), nextDraft);

  if (
    parsed.type === "CANCEL" &&
    !pendingCustomerSelection &&
    !pendingWarehouseSelection &&
    !pendingProductSelection
  ) {
    return void res.json({
      type: "answer",
      text: "تمام، ألغيت الطلب السابق. احچيلي إذا تريد نسوي عملية ثانية.",
      resetConversation: true,
      draft: {},
    });
  }

  if (parsed.type === "OUT_OF_SCOPE" && !pendingWarehouseSelection && !pendingProductSelection) {
    return void res.json({
      type: "answer",
      text: "هذا الموضوع خارج شغل البرنامج. أگدر أساعدك بالمخزون، الفواتير، الحسابات، الزبائن والتقارير.",
      draft: currentDraft,
    });
  }

  if (parsed.type === "QUESTION" && !pendingWarehouseSelection && !pendingProductSelection) {
    const answer = await getGroq().chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.25,
      messages: [
        {
          role: "system",
          content: "جاوب باختصار وباللهجة العراقية عن استخدام نظام المخزون والمحاسبة فقط. إذا السؤال خارج النظام ارفضه بجملة واحدة. لا تخترع بيانات فعلية غير متاحة إلك.",
        },
        ...safeHistory,
        { role: "user", content: command.trim() },
      ],
    });
    return void res.json({
      type: "answer",
      text: answer.choices[0]?.message?.content?.trim() || "وضح سؤالك عن البرنامج أكثر.",
      draft: currentDraft,
    });
  }

  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 5000,
  });

  const effectiveCustomerName = nextDraft.customerName;
  if (!effectiveCustomerName) {
    return void res.json({ type: "clarify", question: "على اسم منو أسجلها؟", draft: nextDraft });
  }
  const customerResult = chooseMatch(effectiveCustomerName, customers);
  if (!customerResult.match) {
    const suffix = customerResult.suggestions.length
      ? ` تقصد: ${customerResult.suggestions.join("، ")}؟`
      : "";
    return void res.json({
      type: "clarify",
      question: `ما ثبت عندي الزبون «${effectiveCustomerName}».${suffix}`,
      suggestions: customerResult.suggestions,
      draft: { ...nextDraft, customerSuggestions: customerResult.suggestions },
    });
  }
  const customer = customerResult.match;

  if (nextDraft.type === "VOUCHER") {
    if (!nextDraft.amount || nextDraft.amount <= 0) {
      return void res.json({ type: "clarify", question: "شكد مبلغ السند؟", draft: nextDraft });
    }
    const voucherType = nextDraft.voucherType === "PAYMENT" ? VoucherType.PAYMENT : VoucherType.RECEIPT;
    const plan: VoicePlan = {
      operation: "VOUCHER",
      customerId: customer.id,
      customerName: customer.name,
      amount: nextDraft.amount,
      voucherType,
    };
    return void res.json({
      type: "confirm",
      plan,
      confirmText: `راح أسجل سند ${voucherType === VoucherType.PAYMENT ? "دفع" : "قبض"} على ${customer.name} بمبلغ ${nextDraft.amount.toLocaleString("en-US")} د.ع.`,
      draft: nextDraft,
    });
  }

  const parsedItems = (nextDraft.items ?? []).filter((item) => item.productName?.trim());
  if (!parsedItems.length) {
    return void res.json({ type: "clarify", question: "شنو المادة اللي تريد تسجلها؟", draft: nextDraft });
  }
  if (!nextDraft.paymentType) {
    return void res.json({ type: "clarify", question: "الحساب شلون؟ نقد، آجل، لو دفع جزئي؟", draft: nextDraft });
  }
  if (nextDraft.paymentType === PaymentType.PARTIAL && (!nextDraft.paidAmount || nextDraft.paidAmount <= 0)) {
    return void res.json({ type: "clarify", question: "شكد المبلغ الواصل هسه؟", draft: nextDraft });
  }

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      salePrice: true,
      pcsPerCarton: true,
      warehouseStocks: {
        select: {
          warehouseId: true,
          quantityPieces: true,
          warehouse: { select: { name: true } },
        },
      },
    },
    orderBy: { name: "asc" },
    take: 10000,
  });

  const items: VoicePlanItem[] = [];
  const selectedWarehouse = nextDraft.warehouseName
    ? activeWarehouses.find(
        (warehouse) =>
          normalizeIraqiText(warehouse.name) === normalizeIraqiText(nextDraft.warehouseName!)
      )
    : null;
  const shopWarehouseId = await resolveShopWarehouseId(prisma).catch(() => null);
  for (const parsedItem of parsedItems) {
    const productResult = chooseMatch(parsedItem.productName!, products);
    if (!productResult.match) {
      const suffix = productResult.suggestions.length
        ? ` تقصد: ${productResult.suggestions.join("، ")}؟`
        : "";
      return void res.json({
        type: "clarify",
        question: `ما ثبتت مادة «${parsedItem.productName}».${suffix}`,
        suggestions: productResult.suggestions,
        draft: {
          ...nextDraft,
          productSuggestions: productResult.suggestions,
          pendingProductName: parsedItem.productName,
        },
      });
    }
    const product = productResult.match;
    const quantity = Math.max(1, Math.trunc(parsedItem.quantity ?? 1));
    const unit = parsedItem.unit ?? Unit.PIECE;
    const quantityPieces =
      unit === Unit.CARTON ? quantity * product.pcsPerCarton
      : unit === Unit.DOZEN ? quantity * 12
      : quantity;
    const targetWarehouseId = selectedWarehouse?.id ?? shopWarehouseId ?? undefined;
    const targetStock = product.warehouseStocks.find(
      (stock) => stock.warehouseId === targetWarehouseId
    );
    const available = Number(targetStock?.quantityPieces ?? 0);
    if (quantityPieces > available) {
      const alternatives = product.warehouseStocks
        .filter(
          (stock) =>
            stock.warehouseId !== targetWarehouseId &&
            Number(stock.quantityPieces) >= quantityPieces
        )
        .sort((a, b) => Number(b.quantityPieces) - Number(a.quantityPieces));
      if (alternatives.length) {
        const names = alternatives.map((stock) => stock.warehouse.name);
        const currentName = selectedWarehouse?.name ?? targetStock?.warehouse.name ?? "المحل";
        const options = alternatives
          .map((stock) => `${stock.warehouse.name} (${stock.quantityPieces} قطعة)`)
          .join("، ");
        return void res.json({
          type: "clarify",
          question: `${currentName} بيه ${available} قطعة فقط من «${product.name}». موجودة في ${options}. من أي مخزن آخذها؟`,
          suggestions: names,
          draft: { ...nextDraft, warehouseSuggestions: names },
        });
      }
    }
    const basePrice = Number(product.salePrice);
    const unitPrice = parsedItem.unitPrice != null && parsedItem.unitPrice >= 0
      ? parsedItem.unitPrice
      : unit === Unit.CARTON
        ? basePrice * product.pcsPerCarton
        : unit === Unit.DOZEN
          ? basePrice * 12
          : basePrice;
    items.push({
      productId: product.id,
      productName: product.name,
      quantity,
      unit,
      unitPrice,
      totalPrice: unitPrice * quantity,
      warehouseId: targetWarehouseId,
      warehouseName: selectedWarehouse?.name ?? targetStock?.warehouse.name,
    });
  }

  const totalAmount = items.reduce((sum, item) => sum + item.totalPrice, 0);
  const paymentType = nextDraft.paymentType!;
  const paidAmount = paymentType === PaymentType.CASH
    ? totalAmount
    : paymentType === PaymentType.CREDIT
      ? 0
      : Math.max(0, Math.min(totalAmount, nextDraft.paidAmount ?? 0));
  const unitLabels: Record<Unit, string> = {
    PIECE: "قطعة",
    DOZEN: "درزن",
    BOX: "علبة",
    CARTON: "كارتون",
  };
  const itemSummary = items
    .map((item) => `${item.quantity} ${unitLabels[item.unit]} ${item.productName}${item.warehouseName ? ` من ${item.warehouseName}` : ""}`)
    .join("، ");
  const payLabel = paymentType === PaymentType.CASH ? "نقد" : paymentType === PaymentType.CREDIT ? "آجل" : `واصل ${paidAmount.toLocaleString("en-US")}`;
  const plan: VoicePlan = {
    operation: "INVOICE",
    customerId: customer.id,
    customerName: customer.name,
    items,
    totalAmount,
    paymentType,
    paidAmount,
  };

  return void res.json({
    type: "confirm",
    plan,
    confirmText: `فهمت عليك: فاتورة على ${customer.name}، ${itemSummary}، المجموع ${totalAmount.toLocaleString("en-US")} د.ع، ${payLabel}. أثبتها؟`,
    draft: nextDraft,
  });
});

export const executeVoiceCommand = asyncHandler(async (req, res) => {
  const { plan } = req.body as { plan?: VoicePlan };
  if (!plan?.operation || !plan.customerId) {
    throw new AppError("خطة التنفيذ ناقصة", 400, "INVALID_PLAN");
  }
  const userId = req.user!.id;

  if (plan.operation === "VOUCHER") {
    if (!plan.amount || !plan.voucherType) {
      throw new AppError("معلومات السند ناقصة", 400, "INVALID_VOUCHER_PLAN");
    }
    const voucher = await createVoucher(
      {
        customerId: plan.customerId,
        amount: plan.amount,
        type: plan.voucherType,
        notes: "أُنشئ بواسطة المساعد الذكي",
      },
      userId
    );
    return void res.status(201).json({
      success: true,
      message: `تم إنشاء السند ${voucher.voucherNumber}`,
      voucher: {
        id: voucher.id,
        voucherNumber: voucher.voucherNumber,
        customerName: plan.customerName,
        amount: plan.amount,
        type: plan.voucherType,
      },
    });
  }

  if (!plan.items?.length || !plan.paymentType) {
    throw new AppError("معلومات الفاتورة ناقصة", 400, "INVALID_INVOICE_PLAN");
  }
  const invoice = await createInvoice(
    {
      customerId: plan.customerId,
      type: "SALE",
      discount: 0,
      tax: 0,
      paidAmount: plan.paidAmount ?? 0,
      paymentType: plan.paymentType,
      items: plan.items.map((item) => ({
        productId: item.productId,
        warehouseId: item.warehouseId,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    },
    userId
  );
  return void res.status(201).json({
    success: true,
    message: `تم إنشاء الفاتورة ${invoice.invoiceNumber}`,
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerName: plan.customerName,
      items: plan.items,
      productName: plan.items.map((item) => item.productName).join("، "),
      quantity: plan.items.reduce((sum, item) => sum + item.quantity, 0),
      unit: plan.items.length === 1 ? plan.items[0].unit : "PIECE",
      totalAmount: plan.totalAmount,
      paymentType: plan.paymentType,
    },
  });
});
