import { InboundMessageSource } from "@prisma/client";
import prisma from "../config/database";
import { logger } from "../utils/logger";
import { normalizePhone } from "../utils/phone";
import { getSettings } from "./settings.service";
import { sendWhatsAppText } from "./whatsapp.service";
import { handleIncomingProspectReply } from "./prospect.service";

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
}) {
  await prisma.inboundMessage.create({
    data: {
      phone: input.phone,
      name: input.name ?? null,
      source: input.source,
      messageText: input.messageText,
    },
  });
}

// Single entry point for every incoming WhatsApp message. Routes by sender:
// known customer asking a fixed command -> automatic real-data reply;
// known customer asking anything else -> logged to the inbox, no auto-reply;
// prospect -> tries the group-link auto-reply first, otherwise the generic
// "wait for admin" message + inbox entry; totally unknown number -> same
// generic message + inbox entry.
export async function routeIncomingMessage(rawPhone: string, text: string) {
  const phone = normalizePhone(rawPhone);
  if (!phone || !text?.trim()) return;

  const settings = await getSettings();
  // Visibility log so we can confirm Green API actually reaches the server.
  logger.info(`[WhatsAppBot] incoming from ${phone}: ${text.slice(0, 80)}`);

  const customer = await prisma.customer.findUnique({ where: { phone } });

  // 1) Known customer + customer-service bot enabled → try a command auto-reply.
  if (customer && settings.whatsappBotEnabled) {
    const reply = await composeCustomerReply(customer, text, settings);
    if (reply) {
      await sendWhatsAppText(phone, reply).catch((err) =>
        logger.warn(`[WhatsAppBot] reply failed to ${phone}: ${err instanceof Error ? err.message : String(err)}`)
      );
      return;
    }
    // Matched no rule — fall through to log it for a manual reply.
  }

  // 2) Not a customer → try the prospect group-link auto-reply. This has its OWN
  // toggle (prospectAutoReplyEnabled) and must work even when the bot is off.
  if (!customer) {
    const handledAsProspect = await handleIncomingProspectReply(phone, text).catch(() => false);
    if (handledAsProspect) return;
  }

  // 3) Fallback: always log to the inbox so the owner can reply by hand —
  // regardless of whether the bot is enabled. Only auto-send the "unknown"
  // message when the bot is actually enabled.
  const prospect = customer ? null : await prisma.prospect.findUnique({ where: { phone } });
  const source: InboundMessageSource = customer ? "CUSTOMER_UNMATCHED" : prospect ? "PROSPECT" : "UNKNOWN";
  const name = customer?.name ?? prospect?.name ?? null;

  // Send the generic "wait for admin" reply only on the FIRST contact from this
  // number — otherwise a chatty sender gets the same message on every message.
  const priorMessages = await prisma.inboundMessage.count({ where: { phone } });
  if (settings.whatsappBotEnabled && priorMessages === 0) {
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
