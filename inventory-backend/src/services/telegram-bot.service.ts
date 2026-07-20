// «بوت تيليگرام» Phase 2 — the interactive ordering bot behind the channel's
// «🛒 اطلب» buttons. Customers browse/search/add-to-cart and confirm an order;
// the order enters the EXACT same pipeline as catalog orders (CATALOG_ORDER
// approval → order preparation → invoice), so admins handle it identically.
// A registered phone links the order to that customer's account; a new phone
// arrives flagged so the order-preparations page can create the account with
// one click. Payment is always cash-on-delivery — no in-Telegram payment.
//
// Updates arrive on POST /api/public/telegram/webhook (registered by
// ensureWebhook in telegram-channel.service). One TelegramBotChat row per
// Telegram user holds the conversation state + cart.
import { Unit } from "@prisma/client";
import prisma from "../config/database";
import { getSettings } from "./settings.service";
import {
  tgCall,
  loadPhotoBlob,
} from "./telegram-channel.service";
import {
  submitTelegramCatalogOrder,
  searchCatalogProductsForBot,
  listCatalogCategoriesForBot,
  listCatalogProductsByCategoryForBot,
} from "./catalog.service";
import { totalStock } from "../utils/product-stock";
import { normalizePhone } from "../utils/phone";
import { createCustomerPortalLink } from "./customer-portal.service";
import { previewCoupon } from "./coupon.service";
import { AppError } from "../utils/app-error";

type BotState = {
  mode?: "idle" | "await_search" | "await_custom_qty" | "await_phone" | "await_address" | "await_coupon";
  pendingProductId?: string;
  pendingUnit?: "PIECE" | "CARTON";
  cart?: CartItem[];
  couponCode?: string;
  couponDiscount?: number;
  // Anti-spam (feature 9) — Baghdad day-key + count, kept in the same JSON
  // blob so no migration is needed.
  ordersToday?: number;
  ordersDate?: string;
  // What we were about to do when we had to stop and ask for a verified
  // phone (see PHONE_SHARE_KEYBOARD) — resumed once the contact arrives.
  pendingIntent?: "checkout" | "statement" | "my_orders";
};

type CartItem = {
  productId: string;
  name: string;
  unit: "PIECE" | "CARTON";
  quantity: number;
  unitPrice: number;
};

type TgUpdate = {
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
    // Populated only when the user taps a request_contact keyboard button —
    // Telegram itself guarantees phone_number is the ACTUAL account owner's
    // verified number when user_id === the sender's own id (see
    // handleMessage's contact branch). This is what makes it trustworthy,
    // unlike a typed-in string.
    contact?: { phone_number: string; user_id?: number };
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string; username?: string };
    message?: { chat: { id: number } };
    data?: string;
  };
};

const CUR = "د.ع";
const DAILY_ORDER_LIMIT = 5;

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

// Atomically claims one of today's DAILY_ORDER_LIMIT slots before submitting
// an order. Two near-simultaneous "confirm" taps both reading the same
// in-memory ordersToday would otherwise both pass a plain if-check (race);
// the `updatedAt` optimistic-lock in the WHERE clause makes only the FIRST
// writer's updateMany actually affect a row — the second sees count === 0
// and is correctly rejected instead of also sneaking through.
async function tryReserveOrderSlot(
  chatId: number,
  currentUpdatedAt: Date,
  state: BotState,
  dayKey: string,
): Promise<boolean> {
  const ordersToday = state.ordersDate === dayKey ? state.ordersToday ?? 0 : 0;
  if (ordersToday >= DAILY_ORDER_LIMIT) return false;
  const result = await prisma.telegramBotChat.updateMany({
    where: { chatId: BigInt(chatId), updatedAt: currentUpdatedAt },
    data: { state: { ...state, ordersToday: ordersToday + 1, ordersDate: dayKey } as object },
  });
  return result.count > 0;
}

// Best-effort compensation if the reserved order actually fails to submit —
// doesn't need the same strict atomicity as the reservation itself (worst
// case on a rare race here is the cap being a touch more generous, not less).
async function releaseOrderSlot(chatId: number, dayKey: string): Promise<void> {
  const chat = await prisma.telegramBotChat.findUnique({ where: { chatId: BigInt(chatId) } });
  const state = (chat?.state ?? {}) as BotState;
  if (state.ordersDate !== dayKey || !state.ordersToday) return;
  await prisma.telegramBotChat
    .update({
      where: { chatId: BigInt(chatId) },
      data: { state: { ...state, ordersToday: Math.max(0, state.ordersToday - 1) } as object },
    })
    .catch(() => undefined);
}

function fmt(n: number) {
  return Math.round(n).toLocaleString("en-US");
}

function normalizePhoneInput(raw: string): string {
  let digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("964")) digits = `0${digits.slice(3)}`;
  if (digits.startsWith("00964")) digits = `0${digits.slice(5)}`;
  return digits;
}

function isValidIraqiPhone(phone: string) {
  return /^07\d{9}$/.test(phone);
}

async function getCreds() {
  const settings = await getSettings();
  const botToken = (settings.telegramChannelBotToken || "").trim();
  return { botToken, settings };
}

// TelegramBotChat.phone is stored in LOCAL 07XXXXXXXXX form (see
// normalizePhoneInput below), while Customer/OrderPreparation phones are
// canonical 964XXXXXXXXXX (utils/phone.ts's normalizePhone). Every lookup
// that crosses between the two must convert explicitly — comparing the raw
// strings silently never matches.
function toLocalPhone(canonical: string): string {
  const digits = canonical.replace(/[^\d]/g, "");
  if (digits.startsWith("964")) return `0${digits.slice(3)}`;
  return digits;
}

export async function findBotChatByPhone(phone: string) {
  const local = toLocalPhone(normalizePhone(phone));
  if (!isValidIraqiPhone(local)) return null;
  return prisma.telegramBotChat.findFirst({ where: { phone: local } });
}

// Fire-and-forget DM to whichever Telegram chat is linked to this phone (if
// any). Never throws — callers must not fail their primary flow just because
// the customer never used the bot.
export async function sendTelegramDmToPhone(phone: string, text: string, keyboard?: unknown): Promise<boolean> {
  try {
    const chat = await findBotChatByPhone(phone);
    if (!chat) return false;
    const { botToken } = await getCreds();
    if (!botToken) return false;
    await send(botToken, Number(chat.chatId), text, keyboard);
    return true;
  } catch (error) {
    console.error("[TelegramBot] DM send failed:", error);
    return false;
  }
}

async function loadChat(chatId: number, from?: { first_name?: string; username?: string }) {
  const existing = await prisma.telegramBotChat.findUnique({ where: { chatId: BigInt(chatId) } });
  if (existing) return existing;
  return prisma.telegramBotChat.create({
    data: {
      chatId: BigInt(chatId),
      firstName: from?.first_name ?? "",
      username: from?.username ?? "",
    },
  });
}

async function saveState(chatId: number, state: BotState, extra?: { phone?: string; customerId?: string | null }) {
  await prisma.telegramBotChat.update({
    where: { chatId: BigInt(chatId) },
    data: {
      state: state as object,
      ...(extra?.phone !== undefined ? { phone: extra.phone } : {}),
      ...(extra?.customerId !== undefined ? { customerId: extra.customerId } : {}),
    },
  });
}

async function send(botToken: string, chatId: number, text: string, keyboard?: unknown) {
  await tgCall(botToken, "sendMessage", {
    chat_id: chatId,
    text,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

const MAIN_MENU = {
  inline_keyboard: [
    [{ text: "🗂️ تصفح الأصناف", callback_data: "browse" }],
    [{ text: "🔍 بحث عن مادة", callback_data: "search" }],
    [{ text: "🛒 سلتي", callback_data: "cart" }],
    [{ text: "📦 طلباتي", callback_data: "my_orders" }, { text: "📄 كشف حسابي", callback_data: "statement" }],
    [{ text: "🏬 كيف أشتري؟", callback_data: "how_to_buy" }],
  ],
};

function backRow() {
  return [{ text: "⬅️ القائمة الرئيسية", callback_data: "menu" }];
}

// Telegram's native "share my contact" — a REPLY keyboard (not inline), sends
// the account's own verified phone number, can't be used to claim someone
// else's number. one_time_keyboard hides it automatically after use.
const PHONE_SHARE_KEYBOARD = {
  keyboard: [[{ text: "📱 مشاركة رقمي بشكل آمن", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

async function showMenu(botToken: string, chatId: number, firstName: string) {
  await send(
    botToken,
    chatId,
    `هلا ${firstName || "بيك"} 👋\nهذا بوت الطلبات — تكدر تتصفح البضاعة وتطلب مباشرة، والدفع عند الاستلام.\nشتحب تسوي؟`,
    MAIN_MENU,
  );
}

/* ── Product card ───────────────────────────────────────────────────────── */

async function showProduct(botToken: string, chatId: number, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    include: { warehouseStocks: { select: { quantityPieces: true } } },
  });
  if (!product || totalStock(product) <= 0) {
    await send(botToken, chatId, "عذراً — هاي المادة خلصت أو ما موجودة حالياً 😔", {
      inline_keyboard: [backRow()],
    });
    return;
  }
  const piece = Number(product.salePrice) || 0;
  const pcs = Math.max(1, product.pcsPerCarton);
  const carton = piece * pcs;
  const caption = [
    `🛍️ ${product.name}`,
    `🔢 رقم المادة: ${product.itemNumber}`,
    `💰 القطعة: ${fmt(piece)} ${CUR}`,
    `📦 الكارتون (${pcs} قطعة): ${fmt(carton)} ${CUR}`,
    "",
    "اختر الوحدة:",
  ].join("\n");
  const keyboard = {
    inline_keyboard: [
      [
        { text: `قطعة — ${fmt(piece)}`, callback_data: `u:${product.id}:PIECE` },
        { text: `كارتون — ${fmt(carton)}`, callback_data: `u:${product.id}:CARTON` },
      ],
      [{ text: "🛒 سلتي", callback_data: "cart" }],
      backRow(),
    ],
  };
  const photo = await loadPhotoBlob(product.id);
  if (photo) {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("photo", photo, `${product.itemNumber}.jpg`);
    form.append("caption", caption.slice(0, 1024));
    form.append("reply_markup", JSON.stringify(keyboard));
    await tgCall(botToken, "sendPhoto", form);
  } else {
    await send(botToken, chatId, caption, keyboard);
  }
}

function qtyKeyboard(productId: string, unit: string) {
  const qty = (n: number) => ({ text: String(n), callback_data: `q:${productId}:${unit}:${n}` });
  return {
    inline_keyboard: [
      [qty(1), qty(2), qty(3)],
      [qty(4), qty(5), { text: "أكثر ✏️", callback_data: `qc:${productId}:${unit}` }],
      backRow(),
    ],
  };
}

/* ── Cart / checkout ────────────────────────────────────────────────────── */

function cartSummary(cart: CartItem[]) {
  const lines = cart.map((item, i) => {
    const unitLabel = item.unit === "CARTON" ? "كارتون" : "قطعة";
    return `${i + 1}. ${item.name} — ${item.quantity} ${unitLabel} × ${fmt(item.unitPrice)} = ${fmt(item.quantity * item.unitPrice)} ${CUR}`;
  });
  const total = cart.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  return { text: lines.join("\n"), total };
}

// Display-only discount preview — the authoritative redemption happens at
// invoice creation via createInvoice's own couponCode/couponDiscount() path
// (order-preparation.service.ts markPrepared()).
function couponDisplayLine(total: number, state: BotState): string {
  if (!state.couponCode || !state.couponDiscount) return "";
  const finalTotal = Math.max(0, total - state.couponDiscount);
  return `🏷️ كوبون ${state.couponCode}: -${fmt(state.couponDiscount)} ${CUR}\nالمجموع بعد الخصم: ${fmt(finalTotal)} ${CUR}`;
}

async function showCart(botToken: string, chatId: number, state: BotState) {
  const cart = state.cart ?? [];
  if (!cart.length) {
    await send(botToken, chatId, "سلتك فارغة 🛒\nتصفح الأصناف أو ادور على مادة وأضفها.", MAIN_MENU);
    return;
  }
  const { text, total } = cartSummary(cart);
  const discountLine = couponDisplayLine(total, state);
  await send(
    botToken,
    chatId,
    `🛒 سلتك:\n${text}\n\nالمجموع: ${fmt(total)} ${CUR}${discountLine ? `\n${discountLine}` : ""}\nالدفع عند الاستلام.`,
    {
      inline_keyboard: [
        [{ text: "✅ تأكيد الطلب", callback_data: "checkout" }],
        [{ text: state.couponCode ? "🏷️ تغيير الكوبون" : "🏷️ عندي كوبون خصم", callback_data: "coupon" }],
        [{ text: "🗑️ تفريغ السلة", callback_data: "clear" }],
        backRow(),
      ],
    },
  );
}

async function addToCart(
  botToken: string,
  chatId: number,
  state: BotState,
  productId: string,
  unit: "PIECE" | "CARTON",
  quantity: number,
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    include: { warehouseStocks: { select: { quantityPieces: true } } },
  });
  if (!product) {
    await send(botToken, chatId, "المادة ما موجودة 😔", { inline_keyboard: [backRow()] });
    return state;
  }
  const piece = Number(product.salePrice) || 0;
  const pcs = Math.max(1, product.pcsPerCarton);
  const unitPrice = unit === "CARTON" ? piece * pcs : piece;
  const requestedPieces = unit === "CARTON" ? quantity * pcs : quantity;
  const available = totalStock(product);
  if (requestedPieces > available) {
    const availCartons = Math.floor(available / pcs);
    await send(
      botToken,
      chatId,
      `الكمية غير متوفرة 😔 — المتوفر حالياً: ${available} قطعة${availCartons > 0 ? ` (~${availCartons} كارتون)` : ""}.\nجرب كمية أقل.`,
      qtyKeyboard(productId, unit),
    );
    return state;
  }
  const cart = [...(state.cart ?? [])];
  const existing = cart.find((item) => item.productId === productId && item.unit === unit);
  if (existing) existing.quantity += quantity;
  else cart.push({ productId, name: product.name, unit, quantity, unitPrice });
  // A coupon discount was computed against the OLD cart total — cart just
  // changed, so it's stale now (wrong amount would show at confirm). Drop it
  // and tell them to re-apply rather than silently show an inaccurate number.
  const hadCoupon = !!state.couponCode;
  const newState: BotState = {
    ...state,
    mode: "idle",
    cart,
    pendingProductId: undefined,
    pendingUnit: undefined,
    couponCode: undefined,
    couponDiscount: undefined,
  };
  await saveState(chatId, newState);
  const unitLabel = unit === "CARTON" ? "كارتون" : "قطعة";
  const couponNote = hadCoupon ? "\n\n🏷️ ملاحظة: الكوبون انلغى لأن السلة تغيرت — أدخله من جديد إذا تريد." : "";
  await send(botToken, chatId, `أضفنا ✔️ ${product.name} — ${quantity} ${unitLabel}${couponNote}`, {
    inline_keyboard: [
      [{ text: "✅ أكمل الطلب", callback_data: "checkout" }],
      [{ text: "🗂️ أضف مواد أخرى", callback_data: "browse" }, { text: "🛒 سلتي", callback_data: "cart" }],
    ],
  });
  return newState;
}

async function startCheckout(botToken: string, chatId: number, chat: { phone: string }, state: BotState) {
  const cart = state.cart ?? [];
  if (!cart.length) {
    await send(botToken, chatId, "سلتك فارغة 🛒", MAIN_MENU);
    return;
  }
  if (chat.phone && isValidIraqiPhone(chat.phone)) {
    await confirmSummary(botToken, chatId, chat.phone, state);
    return;
  }
  await saveState(chatId, { ...state, mode: "await_phone", pendingIntent: "checkout" });
  await send(
    botToken,
    chatId,
    "📱 حتى نسجل الطلب، اضغط الزر تحت لمشاركة رقمك المسجل بتيليگرام (رقمك الحقيقي، ما تكدر تكتبه يدوياً حماية لحسابات الزبائن).\nإذا رقمك مسجل عدنا، الطلب ينحسب على حسابك مباشرة.",
    PHONE_SHARE_KEYBOARD,
  );
}

async function confirmSummary(botToken: string, chatId: number, phone: string, state: BotState) {
  const cart = state.cart ?? [];
  const { text, total } = cartSummary(cart);
  const discountLine = couponDisplayLine(total, state);
  const customer = await prisma.customer.findFirst({
    where: { phone: normalizePhone(phone), deletedAt: null },
    select: { name: true },
  });
  const who = customer
    ? `👤 الحساب: ${customer.name} (رقم مسجل — الطلب على حسابك)`
    : "👤 رقمك جديد عدنا — الإدارة راح تسويلك حساب وتتواصل وياك";
  await saveState(chatId, { ...state, mode: "idle" });
  await send(
    botToken,
    chatId,
    `📋 ملخص طلبك:\n${text}\n\nالمجموع: ${fmt(total)} ${CUR}${discountLine ? `\n${discountLine}` : ""}\n${who}\n💵 الدفع عند الاستلام\n\nنأكد الطلب؟`,
    {
      inline_keyboard: [
        [{ text: "✅ أكد الطلب", callback_data: "confirm" }],
        [{ text: "🗑️ إلغاء", callback_data: "clear" }],
      ],
    },
  );
}

async function submitOrder(
  botToken: string,
  chatId: number,
  chat: { firstName: string; username: string; phone: string; updatedAt: Date },
  state: BotState,
) {
  const cart = state.cart ?? [];
  if (!cart.length) {
    await send(botToken, chatId, "سلتك فارغة 🛒", MAIN_MENU);
    return;
  }
  const today = baghdadDayKey();
  const reservedOrdersToday = (state.ordersDate === today ? state.ordersToday ?? 0 : 0) + 1;
  const reserved = await tryReserveOrderSlot(chatId, chat.updatedAt, state, today);
  if (!reserved) {
    await send(botToken, chatId, `وصلت الحد الأقصى ${DAILY_ORDER_LIMIT} طلبات باليوم — جرب باچر 🙏`, MAIN_MENU);
    return;
  }
  try {
    const result = await submitTelegramCatalogOrder({
      customerName: chat.firstName || chat.username || "زبون تيليگرام",
      phone: chat.phone,
      notes: `طلب من بوت تيليگرام${chat.username ? ` (@${chat.username})` : ""}`,
      items: cart.map((item) => ({
        productId: item.productId,
        unit: item.unit === "CARTON" ? Unit.CARTON : Unit.PIECE,
        quantity: item.quantity,
      })),
      couponCode: state.couponCode,
    });
    // Re-assert the reserved counter — saveState below fully replaces the
    // JSON blob, so it must carry the value tryReserveOrderSlot just wrote
    // or that atomic write would be silently lost.
    await saveState(chatId, { mode: "idle", cart: [], ordersToday: reservedOrdersToday, ordersDate: today });
    const accountLine = result.matchedCustomerName
      ? `انسجل الطلب على حساب: ${result.matchedCustomerName} ✔️`
      : "رقمك جديد — الإدارة راح تسويلك حساب وتتأكد من الطلب ✔️";
    await send(
      botToken,
      chatId,
      `🎉 تم استلام طلبك!\nالمجموع: ${fmt(result.total)} ${CUR}\n${accountLine}\n💵 الدفع عند الاستلام — نتواصل وياك للتوصيل.\nشكراً لك 🌹`,
      MAIN_MENU,
    );
  } catch (error) {
    // The order didn't actually go through — give the daily-cap slot back
    // rather than penalize the customer for a failed attempt.
    await releaseOrderSlot(chatId, today);
    const msg = error instanceof Error ? error.message : "خطأ غير متوقع";
    await send(botToken, chatId, `تعذر تسجيل الطلب: ${msg}\nجرب مرة ثانية أو عدّل سلتك.`, {
      inline_keyboard: [[{ text: "🛒 سلتي", callback_data: "cart" }], backRow()],
    });
  }
}

/* ── Browse / search ────────────────────────────────────────────────────── */

async function showCategories(botToken: string, chatId: number) {
  const categories = await listCatalogCategoriesForBot();
  if (!categories.length) {
    await send(botToken, chatId, "ماكو بضاعة متوفرة حالياً 😔", { inline_keyboard: [backRow()] });
    return;
  }
  const rows = categories
    .slice(0, 20)
    .map((c) => [{ text: `${c.name} (${c.count})`, callback_data: `cat:${c.name.slice(0, 40)}:0` }]);
  rows.push(backRow());
  await send(botToken, chatId, "🗂️ اختر الصنف:", { inline_keyboard: rows });
}

async function showCategoryPage(botToken: string, chatId: number, category: string, page: number) {
  const { total, items } = await listCatalogProductsByCategoryForBot(category, page);
  if (!items.length) {
    await send(botToken, chatId, "ماكو مواد بهذا الصنف حالياً.", { inline_keyboard: [backRow()] });
    return;
  }
  const rows = items.map((p) => [
    { text: `${p.name} — ${fmt(Number(p.salePrice) || 0)} ${CUR}`, callback_data: `p:${p.id}` },
  ]);
  const nav: Array<{ text: string; callback_data: string }> = [];
  if (page > 0) nav.push({ text: "⬅️ السابق", callback_data: `cat:${category}:${page - 1}` });
  if ((page + 1) * 6 < total) nav.push({ text: "التالي ➡️", callback_data: `cat:${category}:${page + 1}` });
  if (nav.length) rows.push(nav);
  rows.push([{ text: "🗂️ الأصناف", callback_data: "browse" }, ...backRow()]);
  await send(botToken, chatId, `${category} — ${total} مادة:`, { inline_keyboard: rows });
}

async function showSearchResults(botToken: string, chatId: number, term: string) {
  const results = await searchCatalogProductsForBot(term);
  if (!results.length) {
    await send(botToken, chatId, `ما لكينا نتائج لـ«${term}» 😔\nجرب اسم ثاني أو رقم المادة.`, {
      inline_keyboard: [[{ text: "🔍 بحث جديد", callback_data: "search" }], backRow()],
    });
    return;
  }
  const rows = results.map((p) => [
    { text: `${p.name} — ${fmt(Number(p.salePrice) || 0)} ${CUR}`, callback_data: `p:${p.id}` },
  ]);
  rows.push(backRow());
  await send(botToken, chatId, `نتائج «${term}»:`, { inline_keyboard: rows });
}

/* ── Statement / how-to-buy / my-orders ─────────────────────────────────── */

function frontendOrigin(settings: { catalogPublicUrl?: string }): string {
  const env = (process.env.FRONTEND_PUBLIC_URL || "").trim().replace(/\/$/, "");
  if (env) return env;
  try {
    return new URL(settings.catalogPublicUrl || "").origin;
  } catch {
    return "";
  }
}

async function showStatement(botToken: string, chatId: number, chat: { phone: string }, state: BotState) {
  if (!chat.phone) {
    await saveState(chatId, { ...state, mode: "await_phone", pendingIntent: "statement" });
    await send(
      botToken,
      chatId,
      "📱 لتشوف كشف حسابك، شارك رقمك الأول (رقمك الحقيقي بتيليگرام، ما تكتبه يدوياً):",
      PHONE_SHARE_KEYBOARD,
    );
    return;
  }
  const phone = normalizePhone(chat.phone);
  const customer = await prisma.customer.findFirst({ where: { phone, deletedAt: null }, select: { id: true } });
  if (!customer) {
    await send(
      botToken,
      chatId,
      "ماعندك كشف حساب لأنك مو زبون مسجل — تحب تصير زبون؟\nدز أول طلب من البوت وبنسويلك حساب تلقائياً.",
      { inline_keyboard: [[{ text: "🗂️ تصفح الأصناف", callback_data: "browse" }], backRow()] },
    );
    return;
  }
  try {
    const { settings } = await getCreds();
    const link = await createCustomerPortalLink(customer.id);
    const origin = frontendOrigin(settings);
    const url = origin ? `${origin}${link.urlPath}` : link.urlPath;
    await send(botToken, chatId, `📄 هذا رابط كشف حسابك (فواتير وسندات وكل حركاتك):\n${url}`, {
      inline_keyboard: [backRow()],
    });
  } catch (error) {
    console.error("[TelegramBot] statement link failed:", error);
    await send(botToken, chatId, "صار خطأ بجلب كشف الحساب — جرب مرة ثانية 🙏", { inline_keyboard: [backRow()] });
  }
}

async function showHowToBuy(botToken: string, chatId: number) {
  const { settings } = await getCreds();
  const lines = ["🏬 كيف أشتري؟", ""];
  if (settings.telegramBotStoreAddress) lines.push(`📍 العنوان: ${settings.telegramBotStoreAddress}`);
  if (settings.telegramBotWorkingHours) lines.push(`🕐 أوقات الدوام: ${settings.telegramBotWorkingHours}`);
  if (settings.telegramBotContactPhone) lines.push(`📞 للتواصل: ${settings.telegramBotContactPhone}`);
  lines.push("", "تكدر تطلب بأكثر من طريقة:", "🛒 مباشرة من هذا البوت");
  if (settings.catalogPublicUrl) lines.push(`🌐 من موقع الكتلوك: ${settings.catalogPublicUrl}`);
  lines.push("📢 أو من قناتنا بتيليگرام");
  await send(botToken, chatId, lines.join("\n"), { inline_keyboard: [backRow()] });
}

async function showMyOrders(botToken: string, chatId: number, chat: { phone: string }, state: BotState) {
  if (!chat.phone) {
    await saveState(chatId, { ...state, mode: "await_phone", pendingIntent: "my_orders" });
    await send(
      botToken,
      chatId,
      "📱 لتشوف طلباتك، شارك رقمك الأول (رقمك الحقيقي بتيليگرام، ما تكتبه يدوياً):",
      PHONE_SHARE_KEYBOARD,
    );
    return;
  }
  const phone = normalizePhone(chat.phone);
  const orders = await prisma.orderPreparation.findMany({
    where: { customerPhone: phone },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { invoice: { select: { invoiceNumber: true, totalAmount: true } } },
  });
  if (!orders.length) {
    await send(botToken, chatId, "ماكو طلبات سابقة إلك.", { inline_keyboard: [backRow()] });
    return;
  }
  const statusAr: Record<string, string> = { PENDING: "قيد التجهيز", PREPARED: "جهز", CANCELLED: "ملغى" };
  const lines = orders.map((o, i) => {
    const d = o.createdAt.toLocaleDateString("ar-IQ");
    const status = statusAr[o.status] ?? o.status;
    const invoiceLine = o.invoice
      ? ` — فاتورة ${o.invoice.invoiceNumber} (${fmt(Number(o.invoice.totalAmount))} ${CUR})`
      : "";
    return `${i + 1}. ${d} — ${status}${invoiceLine}`;
  });
  await send(botToken, chatId, `📦 آخر طلباتك:\n${lines.join("\n")}`, { inline_keyboard: [backRow()] });
}

/* ── Update dispatcher ──────────────────────────────────────────────────── */

export async function handleTelegramUpdate(update: TgUpdate): Promise<void> {
  const { botToken, settings } = await getCreds();
  if (!botToken) return;

  const chatId = update.callback_query?.message?.chat.id ?? update.message?.chat.id;
  if (chatId && (settings.telegramBotBannedChatIds ?? []).includes(String(chatId))) {
    return; // silently dropped — no reply, per anti-spam design
  }

  try {
    if (update.callback_query) {
      await handleCallback(botToken, update.callback_query);
    } else if ((update.message?.text || update.message?.contact) && update.message.chat.type === "private") {
      await handleMessage(botToken, update.message);
    }
  } catch (error) {
    console.error("[TelegramBot] update failed:", error);
    const chatId = update.callback_query?.message?.chat.id ?? update.message?.chat.id;
    if (chatId) {
      await send(botToken, chatId, "صار خطأ مؤقت — جرب مرة ثانية 🙏", MAIN_MENU).catch(() => undefined);
    }
  }
}

async function handleMessage(
  botToken: string,
  message: NonNullable<TgUpdate["message"]>,
) {
  const chatId = message.chat.id;
  const text = (message.text ?? "").trim();
  const chat = await loadChat(chatId, message.from);
  const state = (chat.state ?? {}) as BotState;

  // /start (optionally with a product deep link from the channel button)
  if (text.startsWith("/start")) {
    const payload = text.split(/\s+/)[1] ?? "";
    if (payload.startsWith("p_")) {
      await saveState(chatId, { ...state, mode: "idle" });
      await showProduct(botToken, chatId, payload.slice(2));
    } else {
      await saveState(chatId, { ...state, mode: "idle" });
      await showMenu(botToken, chatId, chat.firstName);
    }
    return;
  }

  if (message.contact) {
    const contact = message.contact;
    // Telegram only fills user_id when the contact came from the sender's
    // own "share my contact" tap — that's what makes phone_number trustworthy.
    // A forwarded contact card (someone else's number) has a different/absent
    // user_id and must be rejected, not linked to this chat.
    if (contact.user_id && message.from?.id && contact.user_id !== message.from.id) {
      await send(botToken, chatId, "لازم تشارك رقمك انت (مو رقم شخص ثاني) 🙏", { inline_keyboard: [backRow()] });
      return;
    }
    const phone = normalizePhoneInput(contact.phone_number);
    if (!isValidIraqiPhone(phone)) {
      await send(botToken, chatId, "الرقم المشارك مو رقم عراقي صحيح 😔", { inline_keyboard: [backRow()] });
      return;
    }
    const customer = await prisma.customer.findFirst({
      where: { phone: normalizePhone(phone), deletedAt: null },
      select: { id: true, name: true },
    });
    const intent = state.mode === "await_phone" ? state.pendingIntent : undefined;
    const clearedState: BotState = { ...state, mode: "idle", pendingIntent: undefined };
    await saveState(chatId, clearedState, { phone, customerId: customer?.id ?? null });
    if (intent === "statement") {
      await showStatement(botToken, chatId, { phone }, clearedState);
    } else if (intent === "my_orders") {
      await showMyOrders(botToken, chatId, { phone }, clearedState);
    } else if (intent === "checkout") {
      await confirmSummary(botToken, chatId, phone, clearedState);
    } else {
      // Unsolicited/unexpected contact share (not mid any flow) — just
      // acknowledge, don't jump into a checkout the user never started.
      await send(botToken, chatId, "تم حفظ رقمك ✔️", MAIN_MENU);
    }
    return;
  }

  if (state.mode === "await_search") {
    await saveState(chatId, { ...state, mode: "idle" });
    await showSearchResults(botToken, chatId, text.slice(0, 60));
    return;
  }

  if (state.mode === "await_custom_qty" && state.pendingProductId && state.pendingUnit) {
    const n = parseInt(text.replace(/[^\d]/g, ""), 10);
    if (!n || n <= 0 || n > 10000) {
      await send(botToken, chatId, "اكتب رقم صحيح (مثال: 12)");
      return;
    }
    await addToCart(botToken, chatId, state, state.pendingProductId, state.pendingUnit, n);
    return;
  }

  if (state.mode === "await_coupon") {
    const cart = state.cart ?? [];
    const { total } = cartSummary(cart);
    try {
      const { coupon, discount } = await previewCoupon(text.trim(), total);
      const newState: BotState = {
        ...state,
        mode: "idle",
        couponCode: String((coupon as { code?: string }).code ?? text.trim().toUpperCase()),
        couponDiscount: discount,
      };
      await saveState(chatId, newState);
      await showCart(botToken, chatId, newState);
    } catch (error) {
      const code = error instanceof AppError ? error.code : undefined;
      const msgByCode: Record<string, string> = {
        COUPON_INACTIVE: "الكود غير فعّال 😔",
        COUPON_NOT_STARTED: "الكود لسا ما بدأ 😔",
        COUPON_EXPIRED: "الكود منتهي الصلاحية 😔",
        COUPON_LIMIT_REACHED: "الكود وصل الحد الأقصى للاستخدام 😔",
      };
      await saveState(chatId, { ...state, mode: "idle" });
      await send(botToken, chatId, msgByCode[code ?? ""] ?? "كود غير صحيح 😔", {
        inline_keyboard: [[{ text: "🛒 سلتي", callback_data: "cart" }], backRow()],
      });
    }
    return;
  }

  if (state.mode === "await_phone") {
    // They typed instead of tapping the share button — remind them, don't
    // fall through to search (which would be confusing mid-checkout).
    await send(botToken, chatId, "📱 اضغط الزر تحت لمشاركة رقمك (ما نكدر نقبل رقم مكتوب يدوياً):", PHONE_SHARE_KEYBOARD);
    return;
  }

  // Free text outside a flow → treat as search (most natural for shoppers).
  await showSearchResults(botToken, chatId, text.slice(0, 60));
}

async function handleCallback(
  botToken: string,
  cb: NonNullable<TgUpdate["callback_query"]>,
) {
  const chatId = cb.message?.chat.id ?? cb.from.id;
  const data = cb.data ?? "";
  // Ack immediately so the button spinner stops.
  await tgCall(botToken, "answerCallbackQuery", { callback_query_id: cb.id }).catch(() => undefined);

  const chat = await loadChat(chatId, cb.from);
  const state = (chat.state ?? {}) as BotState;

  if (data === "menu") {
    await saveState(chatId, { ...state, mode: "idle" });
    await showMenu(botToken, chatId, chat.firstName);
  } else if (data === "browse") {
    await showCategories(botToken, chatId);
  } else if (data === "search") {
    await saveState(chatId, { ...state, mode: "await_search" });
    await send(botToken, chatId, "🔍 اكتب اسم المادة أو رقمها:");
  } else if (data === "cart") {
    await showCart(botToken, chatId, state);
  } else if (data === "clear") {
    await saveState(chatId, { ...state, mode: "idle", cart: [], couponCode: undefined, couponDiscount: undefined });
    await send(botToken, chatId, "تم تفريغ السلة 🗑️", MAIN_MENU);
  } else if (data === "coupon") {
    await saveState(chatId, { ...state, mode: "await_coupon" });
    await send(botToken, chatId, "🏷️ اكتب كود الخصم:");
  } else if (data === "checkout") {
    await startCheckout(botToken, chatId, chat, state);
  } else if (data === "statement") {
    await showStatement(botToken, chatId, chat, state);
  } else if (data === "how_to_buy") {
    await showHowToBuy(botToken, chatId);
  } else if (data === "my_orders") {
    await showMyOrders(botToken, chatId, chat, state);
  } else if (data === "confirm") {
    await submitOrder(botToken, chatId, chat, state);
  } else if (data.startsWith("cat:")) {
    const [, category, pageStr] = data.split(":");
    await showCategoryPage(botToken, chatId, category, parseInt(pageStr, 10) || 0);
  } else if (data.startsWith("p:")) {
    await showProduct(botToken, chatId, data.slice(2));
  } else if (data.startsWith("u:")) {
    const [, productId, unit] = data.split(":");
    if (unit === "PIECE" || unit === "CARTON") {
      await send(botToken, chatId, "كم الكمية؟", qtyKeyboard(productId, unit));
    }
  } else if (data.startsWith("qc:")) {
    const [, productId, unit] = data.split(":");
    if (unit === "PIECE" || unit === "CARTON") {
      await saveState(chatId, { ...state, mode: "await_custom_qty", pendingProductId: productId, pendingUnit: unit });
      await send(botToken, chatId, "✏️ اكتب الكمية اللي تريدها (رقم فقط):");
    }
  } else if (data.startsWith("q:")) {
    const [, productId, unit, nStr] = data.split(":");
    const n = parseInt(nStr, 10);
    if ((unit === "PIECE" || unit === "CARTON") && n > 0) {
      await addToCart(botToken, chatId, state, productId, unit, n);
    }
  }
}
