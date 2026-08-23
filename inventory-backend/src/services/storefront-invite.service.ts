import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
import { normalizePhone } from "../utils/phone";
import { getSettings } from "./settings.service";
import { isOptedOut } from "./marketing-opt-out.service";
import { sendTextWithTemplateFallback, type WhatsAppSendChannel } from "./whatsapp.service";
import { prepareCustomerCode, prepareVisitorCode } from "./customer-login.service";
import { sendStorefrontCredentials } from "./storefront-credentials.service";
import { listCredentialTargets, type BulkTarget, type TargetGroup } from "./storefront-credentials.service";

/* ══════════════════════════════════════════════════════════════════════
   «دعوة الحساب» — inviting a customer to ask for their storefront login.

   Meta refuses to approve any template carrying a login code, and this
   account has no authentication templates available at all, so credentials
   cannot be pushed to a cold number: outside the 24-hour window free text
   is dropped and every template that would carry the code is rejected.

   What IS allowed is the reverse direction. A plain marketing template with
   a quick-reply button opens the 24-hour window the moment the customer
   taps it, and inside that window free text carries the username, the code
   and the link with no template involved. So the invite goes out cold, and
   the credentials go out as a reply.

   The cost is honest and worth stating: only the people who actually reply
   get an account. Nobody else is reachable by any compliant route.
══════════════════════════════════════════════════════════════════════ */

export const DEFAULT_INVITE_TEMPLATE =
  "مرحباً {{customerName}} 👋\n" +
  "هذا متجر {{storeName}} الإلكتروني — تكدر تتصفح كل المنتجات والأسعار منه.\n\n" +
  "حتى نفتحلك حسابك، رد على هذي الرسالة بكلمة:\n" +
  "حسابي\n\n" +
  "ونرسللك اسم الدخول والرمز فوراً.";

/**
 * What a shopper replies to ask for their account.
 *
 * Exact match after trimming, same rule as the stop keywords and for the
 * same reason: the invite text itself contains the word, so a customer
 * quoting it back inside a longer sentence must not silently rotate their
 * code. The quick-reply button sends its own label as the message body, so
 * whatever label the merchant puts on the button belongs in this list.
 */
export const DEFAULT_INVITE_KEYWORDS = [
  "حسابي",
  "اريد حسابي",
  "أريد حسابي",
  "نعم اريد حسابي",
  "نعم أريد حسابي",
  "اريد حساب",
  "أريد حساب",
];

/**
 * How many invites one press of the button may send.
 *
 * Meta caps a number at its messaging tier (250 unique customers per rolling
 * 24 hours on the starting tier), and a tight loop of hundreds of identical
 * cold messages is exactly the pattern that drops a number's quality rating.
 * A list bigger than this belongs in the campaign system, which paces sends,
 * respects working hours and carries its own daily cap.
 */
const MAX_INVITES_PER_RUN = 50;

/** Randomized so the send pattern does not look mechanical to Meta. */
const MIN_GAP_MS = 1500;
const MAX_GAP_MS = 3500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Re-issuing rotates the code, so a double tap must not lock anyone out. */
const REISSUE_COOLDOWN_MS = 2 * 60 * 1000;

function normalizeKeyword(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    // Punctuation is dropped everywhere, not just at the ends: a quick-reply
    // button label like «نعم، أريد حسابي» carries a comma in the MIDDLE, and
    // trimming only the edges left it there and missed the match — which
    // silently broke the whole flow for every button the merchant styled with
    // a comma. Dropping punctuation does not weaken the exact-match rule that
    // keeps a quoted keyword inside a sentence from counting.
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Arabic writes the same word with and without diacritics/hamza forms;
    // matching would otherwise depend on which keyboard the shopper used.
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ً-ْ]/g, "");
}

/** Pure matcher — split out from the DB lookup so it can be tested directly. */
export function matchesInviteKeyword(text: string, keywords: string[]): boolean {
  const normalized = normalizeKeyword(text);
  if (!normalized) return false;
  return keywords.map(normalizeKeyword).filter(Boolean).includes(normalized);
}

export async function isInviteRequest(text: string): Promise<boolean> {
  const settings = await getSettings().catch(() => null);
  const custom = settings?.storefrontInviteKeywords ?? [];
  return matchesInviteKeyword(text, custom.length ? custom : DEFAULT_INVITE_KEYWORDS);
}

function renderInvite(template: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce(
    (out, [key, value]) => out.replaceAll(`{{${key}}}`, value),
    template,
  );
}

/* ── Outbound: the cold invite ─────────────────────────────────────── */

/**
 * Send one invite. Marketing by nature, so «توقف» is honoured here — unlike
 * the credentials themselves, which answer a request the shopper just made.
 */
export async function sendStorefrontInvite(target: BulkTarget, channel?: string) {
  const phone = normalizePhone(target.phone ?? "");
  if (!phone) throw new AppError("رقم هاتف غير صالح", 400, "PHONE_INVALID");
  if (await isOptedOut(phone)) throw new AppError("الرقم موقوف عن الرسائل التسويقية", 400, "OPTED_OUT");

  const settings = await getSettings();
  const name = target.id
    ? (await prisma.customer.findUnique({ where: { id: target.id }, select: { name: true } }))?.name ?? ""
    : "";

  const message = renderInvite(settings.storefrontInviteMessage?.trim() || DEFAULT_INVITE_TEMPLATE, {
    customerName: name || "زبوننا العزيز",
    storeName: settings.storeName || "متجرنا",
  });

  await sendTextWithTemplateFallback(
    phone,
    settings.storefrontInviteTemplateName,
    "ar",
    message,
    // Only what the merchant's template actually declares. Meta rejects a
    // send whose parameter count does not match the template exactly, and a
    // plain no-variable paragraph is the common case — so default to none.
    (settings.storefrontInviteTemplateParams ?? []).map((param) =>
      renderInvite(param, {
        customerName: name || "زبوننا العزيز",
        storeName: settings.storeName || "متجرنا",
      }),
    ),
    channel as WhatsAppSendChannel | undefined,
  );
  return { phone, sent: true };
}

/**
 * Invite many. One failure never aborts the run — an opted-out number or a
 * WhatsApp hiccup must not stop the rest of the list, so every recipient is
 * reported individually.
 */
export async function sendStorefrontInvitesBulk(targets: BulkTarget[], channel?: string) {
  const results: Array<{ phone: string; ok: boolean; error?: string }> = [];
  const batch = targets.slice(0, MAX_INVITES_PER_RUN);
  const remaining = targets.length - batch.length;

  for (const [index, target] of batch.entries()) {
    const phone = target.phone ?? "";
    // Paced, not blasted — see MAX_INVITES_PER_RUN.
    if (index > 0) await sleep(MIN_GAP_MS + Math.floor(Math.random() * (MAX_GAP_MS - MIN_GAP_MS)));
    try {
      await sendStorefrontInvite(target, channel);
      results.push({ phone, ok: true });
    } catch (error) {
      results.push({
        phone,
        ok: false,
        error: error instanceof Error ? error.message : "فشل الإرسال",
      });
    }
  }

  if (remaining > 0) {
    logger.info(`[StorefrontInvite] stopped at ${batch.length}; ${remaining} recipients not contacted this run`);
  }

  return {
    total: results.length,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    // Never silently truncate: the caller reports what was left out, so a
    // partial run cannot read as "everyone was reached".
    remaining,
    results,
  };
}

export async function sendInvitesToGroup(group: TargetGroup, channel?: string) {
  const targets = await listCredentialTargets(group);
  if (targets.length === 0) throw new AppError("لا يوجد مستلمون", 400, "NO_TARGETS");
  return sendStorefrontInvitesBulk(targets, channel);
}

/* ── Inbound: the reply that earns the credentials ─────────────────── */

/**
 * Answer a shopper who asked for their account.
 *
 * Returns false when the text is not an invite reply, so the caller falls
 * through to the rest of the routing untouched.
 */
export async function handleStorefrontInviteReply(rawPhone: string, text: string): Promise<boolean> {
  if (!(await isInviteRequest(text))) return false;

  const phone = normalizePhone(rawPhone);
  if (!phone) return false;

  const customer = await prisma.customer.findFirst({
    where: { phone, deletedAt: null },
    select: { id: true, accessCodeSetAt: true },
  });
  const visitor = customer
    ? null
    : await prisma.catalogVisitor.findUnique({ where: { phone }, select: { accessCodeSetAt: true } });

  // Every tap rotates the code and invalidates the previous one, so a double
  // tap would otherwise hand the shopper two codes and leave them guessing
  // which one still works.
  const lastIssued = customer?.accessCodeSetAt ?? visitor?.accessCodeSetAt ?? null;
  if (lastIssued && Date.now() - lastIssued.getTime() < REISSUE_COOLDOWN_MS) {
    logger.info(`[StorefrontInvite] ${phone} asked again within the cooldown`);
    return true;
  }

  try {
    const issued = customer
      ? await prepareCustomerCode(customer.id)
      : await prepareVisitorCode(phone);
    // The shopper just messaged us, so the 24-hour window is open and this
    // goes out as plain text — no template, nothing for Meta to reject.
    await sendStorefrontCredentials(issued);
    logger.info(`[StorefrontInvite] credentials sent to ${phone}`);
  } catch (err) {
    logger.warn(
      `[StorefrontInvite] could not send credentials to ${phone}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // Handled either way: falling through would answer a credentials request
  // with the generic "wait for the admin" reply.
  return true;
}
