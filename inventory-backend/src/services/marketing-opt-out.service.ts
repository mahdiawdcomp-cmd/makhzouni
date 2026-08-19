import prisma from "../config/database";
import { normalizePhone } from "../utils/phone";
import { getSettings } from "./settings.service";

/* ══════════════════════════════════════════════════════════════════════
   «توقف» — honouring the opt-out line printed in every campaign message.

   Marketing only. Invoices, statements, vouchers and login codes keep
   going out: those answer a transaction the customer started, and a shop
   that stops sending a paying customer their invoice has not respected a
   preference, it has broken its own bookkeeping.
══════════════════════════════════════════════════════════════════════ */

/** Matched case-insensitively; the shop can extend this from settings. */
export const DEFAULT_STOP_KEYWORDS = ["توقف", "ايقاف", "إيقاف", "الغاء", "إلغاء", "stop", "unsubscribe"];

export const DEFAULT_STOP_CONFIRMATION =
  "تم إيقاف الرسائل الإعلانية عن رقمك ✅\n" +
  "ما راح توصلك أي عروض بعد الآن.\n" +
  "تبقى فواتيرك وكشوف حسابك تصلك عادي.\n" +
  "إذا غيّرت رأيك، راسلنا وقت ما تحب.";

async function stopKeywords() {
  const settings = await getSettings().catch(() => null);
  const custom = settings?.marketingStopKeywords ?? [];
  const list = custom.length ? custom : DEFAULT_STOP_KEYWORDS;
  return list.map((k) => k.trim().toLowerCase()).filter(Boolean);
}

/**
 * Whether a reply is a stop request.
 *
 * Deliberately an EXACT match, not "contains": the campaign message itself
 * ends with «رد بكلمة: توقف», so a customer quoting or forwarding it, or
 * writing "ما اريد توقف الرسائل بس ابي اطلب", must not be silently
 * unsubscribed. The instruction asks for one word — honour exactly that.
 */
export async function isStopRequest(text: string): Promise<boolean> {
  const normalized = String(text ?? "")
    .trim()
    .toLowerCase()
    // Strip surrounding punctuation/emoji so "توقف." or "توقف!" still counts.
    .replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "");
  if (!normalized) return false;
  return (await stopKeywords()).includes(normalized);
}

export async function optOutOfMarketing(
  rawPhone: string,
  opts?: { reason?: string; source?: string },
) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;
  return prisma.marketingOptOut.upsert({
    where: { phone },
    update: {},
    create: {
      phone,
      reason: opts?.reason?.slice(0, 200) ?? null,
      source: opts?.source ?? "WHATSAPP_REPLY",
    },
  });
}

export async function resumeMarketing(rawPhone: string) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false };
  await prisma.marketingOptOut.deleteMany({ where: { phone } });
  return { ok: true };
}

export async function isOptedOut(rawPhone: string): Promise<boolean> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return false;
  const row = await prisma.marketingOptOut.findUnique({ where: { phone } });
  return Boolean(row);
}

/**
 * Filter a batch of phones down to those still willing to hear from us.
 *
 * One query for the whole list — campaigns check hundreds of numbers, and a
 * per-number round trip would make the send loop crawl.
 */
export async function filterOptedIn(rawPhones: string[]): Promise<Set<string>> {
  const normalized = rawPhones.map((p) => normalizePhone(p)).filter(Boolean);
  if (normalized.length === 0) return new Set();
  const blocked = await prisma.marketingOptOut.findMany({
    where: { phone: { in: normalized } },
    select: { phone: true },
  });
  const blockedSet = new Set(blocked.map((b) => b.phone));
  return new Set(normalized.filter((p) => !blockedSet.has(p)));
}

export async function listOptOuts(search?: string) {
  const q = search?.trim();
  const rows = await prisma.marketingOptOut.findMany({
    where: q ? { phone: { contains: q } } : {},
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  // Attach a name where we know one, so the list reads as people not digits.
  const phones = rows.map((r) => r.phone);
  const [customers, prospects] = await Promise.all([
    prisma.customer.findMany({ where: { phone: { in: phones } }, select: { phone: true, name: true } }),
    prisma.prospect.findMany({ where: { phone: { in: phones } }, select: { phone: true, name: true } }),
  ]);
  const nameByPhone = new Map<string, string>();
  for (const p of prospects) nameByPhone.set(p.phone, p.name);
  for (const c of customers) nameByPhone.set(c.phone, c.name); // customer wins

  return rows.map((r) => ({
    phone: r.phone,
    name: nameByPhone.get(r.phone) ?? null,
    reason: r.reason,
    source: r.source,
    createdAt: r.createdAt,
  }));
}
