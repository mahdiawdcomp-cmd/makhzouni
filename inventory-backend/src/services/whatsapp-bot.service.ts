import { InboundMessageSource } from "@prisma/client";
import prisma from "../config/database";
import { logger } from "../utils/logger";
import { normalizePhone } from "../utils/phone";
import { getSettings } from "./settings.service";
import { sendWhatsAppText } from "./whatsapp.service";
import { handleIncomingProspectReply } from "./prospect.service";
import { hasFeature } from "../middleware/tenant.middleware";
import { logChatMessage } from "./whatsapp-chat.service";
import { tryCaptureProductReviewReply } from "./product-review.service";
import { DEFAULT_STOP_CONFIRMATION, isStopRequest, optOutOfMarketing } from "./marketing-opt-out.service";
import { handleRegistrationReply, startRegistration } from "./whatsapp-registration.service";
import { normalizeArabic } from "../utils/arabic-search";

// بند ٥ — "أريد أحچي مع موظف" يوقف البوت لهذا الرقم بأي لحظة (حتى وسط
// محادثة تسجيل) ويرفعه لصندوق الوارد بعلامة مستعجل. عبارات متعددة الكلمات
// عمداً لتقليل الإيجابيات الخاطئة (كلمة "موظف" لحالها تنطبق على رسائل عادية).
// مطبَّعة بـnormalizeArabic حتى "أحچي"/"احچي" (بهمزة أو من غيرها) تتطابق —
// اختبار حي كشف إن matchesAny العادية (lowercase فقط) ما تلتقط هذا الفرق.
const HUMAN_HANDOFF_KEYWORDS = [
  "احچي مع موظف",
  "احجي مع موظف",
  "اكلم موظف",
  "اتكلم مع موظف",
  "موظف من فضلك",
  "talk to a human",
  "human agent",
].map(normalizeArabic);

function isHumanHandoffRequest(text: string): boolean {
  const normalized = normalizeArabic(text);
  return HUMAN_HANDOFF_KEYWORDS.some((k) => normalized.includes(k));
}

function money(v: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US").format(Math.round(Number(v ?? 0)));
}

function matchesAny(text: string, keywords: string[] | undefined): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return (keywords ?? []).some((k) => k.trim() && t.includes(k.trim().toLowerCase()));
}

async function logInbound(input: {
  phone: string;
  name?: string | null;
  source: InboundMessageSource;
  messageText: string;
  urgent?: boolean;
}) {
  await prisma.inboundMessage.create({
    data: {
      phone: input.phone,
      name: input.name ?? null,
      source: input.source,
      messageText: input.messageText,
      urgent: input.urgent ?? false,
    },
  });
}

// Single entry point for every incoming WhatsApp message. Routes by sender:
// known customer asking a fixed command -> automatic real-data reply;
// known customer asking anything else -> logged to the inbox, no auto-reply;
// prospect -> tries the group-link auto-reply first, otherwise the generic
// "wait for admin" message + inbox entry; totally unknown number -> same
// generic message + inbox entry.
export async function routeIncomingMessage(
  rawPhone: string,
  text: string,
  waMessageId?: string,
  opts?: { replyToWaMessageId?: string | null },
) {
  const phone = normalizePhone(rawPhone);
  if (!phone || !text?.trim()) return;

  const settings = await getSettings();
  // Visibility log so we can confirm Green API actually reaches the server.
  logger.info(`[WhatsAppBot] incoming from ${phone}: ${text.slice(0, 80)}`);

  // Full conversation log for the WhatsApp chat screen — unconditional, runs
  // regardless of how the bot/inbox logic below ends up handling the message.
  logChatMessage({ phone, direction: "IN", text, waMessageId, replyToWaMessageId: opts?.replyToWaMessageId }).catch(() => {});

  // SaaS entitlement gate — standalone (no TENANT_ID) and tenants with no
  // entitlements configured yet always resolve to true (see hasFeature()),
  // so this only actually blocks a tenant whose Super Admin explicitly
  // disabled the whatsappBot feature.
  const botEntitled = await hasFeature("whatsappBot");
  if (settings.whatsappBotEnabled && !botEntitled) {
    logger.info("[whatsapp-bot] skipped: feature disabled");
  }

  // 0) «توقف» outranks everything, including a pending rating request: the
  // campaign message promises this word works, so it must never be swallowed
  // by another rule or answered with anything but the confirmation.
  if (await isStopRequest(text)) {
    await optOutOfMarketing(phone, { reason: text.trim(), source: "WHATSAPP_REPLY" });
    const confirmation = settings.marketingStopConfirmation?.trim() || DEFAULT_STOP_CONFIRMATION;
    await sendWhatsAppText(phone, confirmation).catch((err) =>
      logger.warn(`[WhatsAppBot] stop confirmation failed to ${phone}: ${err instanceof Error ? err.message : String(err)}`),
    );
    logger.info(`[WhatsAppBot] ${phone} opted out of marketing`);
    return;
  }

  const customer = await prisma.customer.findUnique({ where: { phone } });
  const prospect = customer ? null : await prisma.prospect.findUnique({ where: { phone } });

  // 0.5) بند ٥ — "أريد أحچي مع موظف" outranks the registration conversation
  // and any numeric funnel trigger: a prospect must be able to bail out to a
  // human at any point. Scoped to non-customers — this is the registration
  // funnel's escape hatch, not a general customer-service feature.
  if (!customer && isHumanHandoffRequest(text)) {
    await prisma.whatsappBotChat.deleteMany({ where: { phone } });
    await sendWhatsAppText(phone, "تمام 👍 موظف راح يتواصل معك قريباً.").catch((err) =>
      logger.warn(`[WhatsAppBot] handoff ack failed to ${phone}: ${err instanceof Error ? err.message : String(err)}`),
    );
    await logInbound({
      phone,
      name: prospect?.name ?? null,
      source: prospect ? "PROSPECT" : "UNKNOWN",
      messageText: text,
      urgent: true,
    });
    return;
  }

  // 0.6) بند ٥ — continue an in-progress registration conversation before any
  // other rule decides what a bare "1"/free-text reply means. Returns false
  // (falls through) when there's no conversation, or it just expired.
  if (!customer) {
    const handledAsRegistration = await handleRegistrationReply(phone, text).catch(() => false);
    if (handledAsRegistration) return;
  }

  // 0) A pending product-rating request always wins over every other rule —
  // checked first and BEFORE any keyword matching so a bare "5" never gets
  // misread as an unrelated bot command. No-op (returns false) for the
  // overwhelming majority of messages where no rating request is pending, so
  // every other branch below is completely unaffected.
  if (customer) {
    const captured = await tryCaptureProductReviewReply(customer.id, text).catch(() => false);
    if (captured) {
      await sendWhatsAppText(phone, "شكراً لتقييمك! 🙏").catch(() => {});
      return;
    }
  }

  // 1) Known customer + customer-service bot enabled → try a command auto-reply.
  if (customer && settings.whatsappBotEnabled && botEntitled) {
    const reply = await composeCustomerReply(customer, text, settings);
    if (reply) {
      await sendWhatsAppText(phone, reply).catch((err) =>
        logger.warn(`[WhatsAppBot] reply failed to ${phone}: ${err instanceof Error ? err.message : String(err)}`)
      );
      return;
    }
    // Matched no rule — fall through to log it for a manual reply.
  }

  // 2) Not a customer → بند ٥ numeric funnel trigger ("1" = buy → start the
  // registration conversation), only for a known prospect (a campaign reply,
  // not a random unrelated "1" from an unknown number). Then the existing
  // prospect group-link auto-reply — "2" (the campaign's "join the group"
  // option) always matches it too, regardless of configured keywords.
  if (!customer && prospect && normalizeArabic(text) === "1") {
    await startRegistration(phone);
    return;
  }
  if (!customer) {
    const handledAsProspect = await handleIncomingProspectReply(phone, text).catch(() => false);
    if (handledAsProspect) return;
  }

  // 3) Fallback: always log to the inbox so the owner can reply by hand —
  // regardless of whether the bot is enabled. Only auto-send the "unknown"
  // message when the bot is actually enabled.
  const source: InboundMessageSource = customer ? "CUSTOMER_UNMATCHED" : prospect ? "PROSPECT" : "UNKNOWN";
  const name = customer?.name ?? prospect?.name ?? null;

  // Send the generic "wait for admin" reply only on the FIRST contact from this
  // number — otherwise a chatty sender gets the same message on every message.
  const priorMessages = await prisma.inboundMessage.count({ where: { phone } });
  if (settings.whatsappBotEnabled && botEntitled && priorMessages === 0) {
    const unknownMsg = settings.botUnknownMessage?.trim() || "هلا، استلمنا رسالتك، الإدارة رح ترد عليك قريباً.";
    await sendWhatsAppText(phone, unknownMsg).catch((err) =>
      logger.warn(`[WhatsAppBot] unknown-reply failed to ${phone}: ${err instanceof Error ? err.message : String(err)}`)
    );
  }
  await logInbound({ phone, name, source, messageText: text });
}

// Rules are checked in order; the first keyword match wins. Built-in rule
// types (STATEMENT/BALANCE/CATALOG_LINK) pull real account data — everything
// else is a plain owner-written TEXT reply (unlimited custom rules, e.g.
// "سلام عليكم" -> "وعليكم السلام").
async function composeCustomerReply(
  customer: { name: string; phone: string; currentBalance: unknown },
  text: string,
  settings: Awaited<ReturnType<typeof getSettings>>
): Promise<string | null> {
  for (const rule of settings.botRules ?? []) {
    if (!matchesAny(text, rule.keywords)) continue;

    if (rule.replyType === "STATEMENT") {
      const tpl =
        settings.statementTemplate ||
        "كشف حساب {{customerName}}\nالرصيد الحالي: {{currentBalance}} {{currency}}\nمن {{storeName}}.";
      return tpl
        .replace(/\{\{\s*customerName\s*\}\}/g, customer.name)
        .replace(/\{\{\s*currentBalance\s*\}\}/g, money(customer.currentBalance as number))
        .replace(/\{\{\s*currency\s*\}\}/g, settings.currency || "د.ع")
        .replace(/\{\{\s*storeName\s*\}\}/g, settings.storeName || "")
        .replace(/\{\{\s*date\s*\}\}/g, new Date().toLocaleDateString("ar-IQ"));
    }

    if (rule.replyType === "BALANCE") {
      return `رصيدك الحالي: ${money(customer.currentBalance as number)} ${settings.currency || "د.ع"}`;
    }

    if (rule.replyType === "CATALOG_LINK") {
      const link = settings.catalogPublicUrl?.trim();
      return link ? `🗂️ هذا رابط الكاتلوج:\n${link}` : "الكاتلوك غير متوفر حالياً.";
    }

    // TEXT
    if (rule.replyText?.trim()) return rule.replyText.trim();
  }

  return null;
}
