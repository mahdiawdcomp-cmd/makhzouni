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

type BotState = {
  mode?: "idle" | "await_search" | "await_custom_qty" | "await_phone" | "await_address";
  pendingProductId?: string;
  pendingUnit?: "PIECE" | "CARTON";
  cart?: CartItem[];
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
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string; username?: string };
    message?: { chat: { id: number } };
    data?: string;
  };
};

const CUR = "د.ع";

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
  ],
};

function backRow() {
  return [{ text: "⬅️ القائمة الرئيسية", callback_data: "menu" }];
}

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

async function showCart(botToken: string, chatId: number, state: BotState) {
  const cart = state.cart ?? [];
  if (!cart.length) {
    await send(botToken, chatId, "سلتك فارغة 🛒\nتصفح الأصناف أو ادور على مادة وأضفها.", MAIN_MENU);
    return;
  }
  const { text, total } = cartSummary(cart);
  await send(botToken, chatId, `🛒 سلتك:\n${text}\n\nالمجموع: ${fmt(total)} ${CUR}\nالدفع عند الاستلام.`, {
    inline_keyboard: [
      [{ text: "✅ تأكيد الطلب", callback_data: "checkout" }],
      [{ text: "🗑️ تفريغ السلة", callback_data: "clear" }],
      backRow(),
    ],
  });
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
  const newState: BotState = { ...state, mode: "idle", cart, pendingProductId: undefined, pendingUnit: undefined };
  await saveState(chatId, newState);
  const unitLabel = unit === "CARTON" ? "كارتون" : "قطعة";
  await send(botToken, chatId, `أضفنا ✔️ ${product.name} — ${quantity} ${unitLabel}`, {
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
  await saveState(chatId, { ...state, mode: "await_phone" });
  await send(
    botToken,
    chatId,
    "📱 دزلي رقم هاتفك حتى نسجل الطلب (مثال: 07701234567)\nإذا رقمك مسجل عدنا، الطلب ينحسب على حسابك مباشرة.",
  );
}

async function confirmSummary(botToken: string, chatId: number, phone: string, state: BotState) {
  const cart = state.cart ?? [];
  const { text, total } = cartSummary(cart);
  const customer = await prisma.customer.findFirst({
    where: { phone, deletedAt: null },
    select: { name: true },
  });
  const who = customer
    ? `👤 الحساب: ${customer.name} (رقم مسجل — الطلب على حسابك)`
    : "👤 رقمك جديد عدنا — الإدارة راح تسويلك حساب وتتواصل وياك";
  await saveState(chatId, { ...state, mode: "idle" });
  await send(
    botToken,
    chatId,
    `📋 ملخص طلبك:\n${text}\n\nالمجموع: ${fmt(total)} ${CUR}\n${who}\n💵 الدفع عند الاستلام\n\nنأكد الطلب؟`,
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
  chat: { firstName: string; username: string; phone: string },
  state: BotState,
) {
  const cart = state.cart ?? [];
  if (!cart.length) {
    await send(botToken, chatId, "سلتك فارغة 🛒", MAIN_MENU);
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
    });
    await saveState(chatId, { mode: "idle", cart: [] });
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

/* ── Update dispatcher ──────────────────────────────────────────────────── */

export async function handleTelegramUpdate(update: TgUpdate): Promise<void> {
  const { botToken } = await getCreds();
  if (!botToken) return;

  try {
    if (update.callback_query) {
      await handleCallback(botToken, update.callback_query);
    } else if (update.message?.text && update.message.chat.type === "private") {
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

  if (state.mode === "await_phone") {
    const phone = normalizePhoneInput(text);
    if (!isValidIraqiPhone(phone)) {
      await send(botToken, chatId, "الرقم غير صحيح — اكتبه بصيغة 07XXXXXXXXX (11 رقم)");
      return;
    }
    const customer = await prisma.customer.findFirst({
      where: { phone, deletedAt: null },
      select: { id: true, name: true },
    });
    await saveState(chatId, { ...state, mode: "idle" }, { phone, customerId: customer?.id ?? null });
    await confirmSummary(botToken, chatId, phone, state);
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
    await saveState(chatId, { ...state, mode: "idle", cart: [] });
    await send(botToken, chatId, "تم تفريغ السلة 🗑️", MAIN_MENU);
  } else if (data === "checkout") {
    await startCheckout(botToken, chatId, chat, state);
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
