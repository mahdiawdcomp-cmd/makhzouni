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
  if (!settings.whatsappBotEnabled) return;

  const customer = await prisma.customer.findUnique({ where: { phone } });
  if (customer) {
    const reply = await composeCustomerReply(customer, text, settings);
    if (reply) {
      await sendWhatsAppText(phone, reply).catch((err) =>
        logger.warn(`[WhatsAppBot] reply failed to ${phone}: ${err instanceof Error ? err.message : String(err)}`)
      );
      return;
    }
    // Known customer, but the message matched none of the 4 commands —
    // log it for a manual reply instead of guessing or staying silent.
    await logInbound({ phone, name: customer.name, source: "CUSTOMER_UNMATCHED", messageText: text });
    return;
  }

  // Not a customer — try the prospect group-link auto-reply (separate
  // feature, keyed off its own keyword list) before falling back.
  const handledAsProspect = await handleIncomingProspectReply(phone, text).catch(() => false);
  if (handledAsProspect) return;

  const prospect = await prisma.prospect.findUnique({ where: { phone } });
  const source: InboundMessageSource = prospect ? "PROSPECT" : "UNKNOWN";
  const unknownMsg = settings.botUnknownMessage?.trim() || "هلا، استلمنا رسالتك، الإدارة رح ترد عليك قريباً.";

  await sendWhatsAppText(phone, unknownMsg).catch((err) =>
    logger.warn(`[WhatsAppBot] unknown-reply failed to ${phone}: ${err instanceof Error ? err.message : String(err)}`)
  );
  await logInbound({ phone, name: prospect?.name ?? null, source, messageText: text });
}

async function composeCustomerReply(
  customer: { name: string; phone: string; currentBalance: unknown },
  text: string,
  settings: Awaited<ReturnType<typeof getSettings>>
): Promise<string | null> {
  if (matchesAny(text, settings.botKeywordsStatement)) {
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

  if (matchesAny(text, settings.botKeywordsBalance)) {
    return `رصيدك الحالي: ${money(customer.currentBalance as number)} ${settings.currency || "د.ع"}`;
  }

  if (matchesAny(text, settings.botKeywordsHowToBuy)) {
    return settings.botHowToBuyMessage?.trim() || "تكدر تطلب عبر الكاتلوج أو تتواصل وينا مباشرة.";
  }

  if (matchesAny(text, settings.botKeywordsCatalog)) {
    const link = settings.catalogPublicUrl?.trim();
    return link ? `🗂️ هذا رابط الكاتلوج:\n${link}` : "الكاتلوك غير متوفر حالياً.";
  }

  return null;
}
