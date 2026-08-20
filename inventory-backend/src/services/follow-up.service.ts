// بند ٨ من خطة قمع الواتساب — ثلاث متابعات تلقائية مستقلة، كل وحدة بمفتاح
// ومدة خاصين، إرسال فعلي تلقائي (بقرار المستخدم صراحة، بنفس نمط طلب
// التقييم runRatingRequestJob: عداد يومي محدود + علامة عدم-تكرار دائمة).
import prisma from "../config/database";
import { logger } from "../utils/logger";
import { getSettings } from "./settings.service";
import { sendTextWithTemplateFallback } from "./whatsapp.service";
import { isOptedOut } from "./marketing-opt-out.service";
import { assistantTimezone } from "./daily-assistant.service";

const RUN_CAP = 30; // سقف أمان بكل تشغيلة — يحمي الرقم من دفعة كبيرة دفعة وحدة
const DAY_MS = 24 * 60 * 60 * 1000;

function currentHourInShopTz(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: assistantTimezone(),
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
  // "24" شكل ساعة منتصف الليل ببعض المتصفحات/محركات — يعادل 0.
  const hour = Number(hourPart) % 24;
  return hour;
}

function withinBusinessHours(settings: { followUpActiveStartHour?: number; followUpActiveEndHour?: number }): boolean {
  const start = settings.followUpActiveStartHour ?? 9;
  const end = settings.followUpActiveEndHour ?? 21;
  const hour = currentHourInShopTz();
  // نافذة عادية (بداية < نهاية): 9-21 مثلاً. نافذة تعبر منتصف الليل (بداية >
  // نهاية، مثل 22-6) كانت تكسر الشرط تماماً — ما فيه ساعة تحقق start<=h<end
  // بيه وقت، فيصير المفتاح مطفي فعلياً بصمت بلا أي خطأ. الاثنان مدعومان هنا.
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

function fillTemplate(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

/* ── ١) "ما ردّ" — Prospect استلم حملة وما ردّ أبداً بعد X أيام ─────────── */
export async function runNoReplyFollowUpJob() {
  const settings = await getSettings().catch(() => null);
  if (!settings?.followUpNoReplyEnabled) return { skipped: "disabled" };
  if (!withinBusinessHours(settings)) return { skipped: "outside business hours" };

  const days = settings.followUpNoReplyDays ?? 3;
  const cutoff = new Date(Date.now() - days * DAY_MS);

  const prospects = await prisma.prospect.findMany({
    where: { status: "NEW", noReplyFollowUpSentAt: null },
    select: { id: true, phone: true, name: true },
    take: 500,
  });
  if (prospects.length === 0) return { checked: 0, sent: 0 };

  const phones = prospects.map((p) => p.phone);
  const recipients = await prisma.campaignRecipient.findMany({
    where: { phone: { in: phones }, sentAt: { not: null } },
    select: { phone: true, sentAt: true },
    orderBy: { sentAt: "desc" },
  });
  // orderBy desc + first-write-wins keeps only the MOST RECENT send per phone.
  const lastSentByPhone = new Map<string, Date>();
  for (const r of recipients) {
    if (!lastSentByPhone.has(r.phone)) lastSentByPhone.set(r.phone, r.sentAt!);
  }

  const eligiblePhones = [...lastSentByPhone.entries()]
    .filter(([, sentAt]) => sentAt <= cutoff)
    .map(([phone]) => phone);
  if (eligiblePhones.length === 0) return { checked: prospects.length, sent: 0 };

  const inbound = await prisma.whatsappMessage.findMany({
    where: { direction: "IN", conversation: { phone: { in: eligiblePhones } } },
    select: { createdAt: true, conversation: { select: { phone: true } } },
  });
  const repliedPhones = new Set<string>();
  for (const msg of inbound) {
    const lastSent = lastSentByPhone.get(msg.conversation.phone);
    if (lastSent && msg.createdAt > lastSent) repliedPhones.add(msg.conversation.phone);
  }

  const targets = prospects
    .filter((p) => eligiblePhones.includes(p.phone) && !repliedPhones.has(p.phone))
    .slice(0, RUN_CAP);

  const link = settings.catalogPublicUrl?.trim() ?? "";
  const template = settings.followUpNoReplyMessage?.trim()
    || "هلا 👋 شفنا ما رديت علينا، بس الفرصة لسه موجودة! تفضل شوف الكتلوك متى ما تريد:\n{{link}}";

  let sent = 0;
  for (const p of targets) {
    if (await isOptedOut(p.phone)) {
      await prisma.prospect.update({ where: { id: p.id }, data: { noReplyFollowUpSentAt: new Date() } });
      continue;
    }
    const message = fillTemplate(template, { link });
    try {
      // متابعة تسويقية نبدأها إحنا، فبدون قالب معتمد ميتا تسقطها بعد ٢٤ ساعة.
      await sendTextWithTemplateFallback(
        p.phone,
        settings.followUpNoReplyTemplateName,
        "ar",
        message,
        [link || "-"],
      );
      sent++;
    } catch (err) {
      logger.warn(`[FollowUp:NoReply] send failed to ${p.phone}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // "مرة وحدة، وبعدها توقف نهائياً" — يُعلَّم بغض النظر عن نجاح الإرسال، حتى
    // فشل مؤقت ما يخلي البوت يعيد المحاولة عليه يومياً للأبد.
    await prisma.prospect.update({ where: { id: p.id }, data: { noReplyFollowUpSentAt: new Date() } });
  }

  return { checked: eligiblePhones.length, sent };
}

/* ── ٢) "سجّل وما طلب" — Customer بلا فاتورة بيع أبداً بعد X أيام ────────── */
async function topProductsFor(phone: string): Promise<string[]> {
  const views = await prisma.catalogVisitorProductView.groupBy({
    by: ["productName"],
    where: { phone },
    _count: { _all: true },
    orderBy: { _count: { productName: "desc" } },
    take: 3,
  });
  if (views.length > 0) return views.map((v) => v.productName);

  // ما تصفّح شي — رجّع الأكثر مبيعاً بالكتلوك كلياً بدل رسالة بلا منتجات.
  const storeWide = await prisma.catalogProductStat.findMany({
    orderBy: { views: "desc" },
    take: 3,
    select: { productId: true },
  });
  if (storeWide.length === 0) return [];
  const products = await prisma.product.findMany({
    where: { id: { in: storeWide.map((s) => s.productId) } },
    select: { name: true },
  });
  return products.map((p) => p.name);
}

export async function runRegisteredNoOrderFollowUpJob() {
  const settings = await getSettings().catch(() => null);
  if (!settings?.followUpRegisteredNoOrderEnabled) return { skipped: "disabled" };
  if (!withinBusinessHours(settings)) return { skipped: "outside business hours" };

  const days = settings.followUpRegisteredNoOrderDays ?? 5;
  const cutoff = new Date(Date.now() - days * DAY_MS);

  const candidates = await prisma.customer.findMany({
    where: { deletedAt: null, registeredNoOrderFollowUpSentAt: null, createdAt: { lte: cutoff } },
    select: { id: true, name: true, phone: true },
    take: 300,
  });
  if (candidates.length === 0) return { checked: 0, sent: 0 };

  const withOrders = await prisma.invoice.findMany({
    where: { customerId: { in: candidates.map((c) => c.id) }, type: "SALE", status: "ACTIVE" },
    select: { customerId: true },
    distinct: ["customerId"],
  });
  const hasOrderSet = new Set(withOrders.map((i) => i.customerId));
  const targets = candidates.filter((c) => !hasOrderSet.has(c.id)).slice(0, RUN_CAP);

  const link = settings.catalogPublicUrl?.trim() ?? "";
  const template = settings.followUpRegisteredNoOrderMessage?.trim()
    || "هلا {{customerName}} 👋 لاحظنا ما كمّلت طلبك لسه. أكثر المواد المطلوبة عندنا:\n{{products}}\n\nادخل الكتلوك واختار اللي يعجبك:\n{{link}}";

  let sent = 0;
  for (const c of targets) {
    if (await isOptedOut(c.phone)) {
      await prisma.customer.update({ where: { id: c.id }, data: { registeredNoOrderFollowUpSentAt: new Date() } });
      continue;
    }
    const products = await topProductsFor(c.phone);
    const message = fillTemplate(template, {
      customerName: c.name,
      products: products.length > 0 ? products.join("، ") : "تشكيلة واسعة من المواد",
      link,
    });
    try {
      await sendTextWithTemplateFallback(
        c.phone,
        settings.followUpNoOrderTemplateName,
        "ar",
        message,
        [c.name, products.length > 0 ? products.join("، ") : "تشكيلة واسعة من المواد", link || "-"],
      );
      sent++;
    } catch (err) {
      logger.warn(`[FollowUp:RegisteredNoOrder] send failed to ${c.phone}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await prisma.customer.update({ where: { id: c.id }, data: { registeredNoOrderFollowUpSentAt: new Date() } });
  }

  return { checked: candidates.length, sent };
}

/* ── ٣) "طلب وانقطع" — Customer عنده فواتير بس صار غايب X يوم ───────────── */
async function pastProductsFor(customerId: string): Promise<string[]> {
  const items = await prisma.invoiceItem.groupBy({
    by: ["productName"],
    where: { invoice: { customerId, type: "SALE", status: "ACTIVE" } },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: 3,
  });
  return items.map((i) => i.productName);
}

export async function runInactiveFollowUpJob() {
  const settings = await getSettings().catch(() => null);
  if (!settings?.followUpInactiveEnabled) return { skipped: "disabled" };
  if (!withinBusinessHours(settings)) return { skipped: "outside business hours" };

  const days = settings.followUpInactiveDays ?? 30;
  const cutoff = new Date(Date.now() - days * DAY_MS);

  const targets = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      inactiveFollowUpSentAt: null,
      // NOT null — a customer with no transaction ever belongs to the
      // "registered, no order" follow-up above, not this one.
      lastTransactionAt: { not: null, lte: cutoff },
    },
    select: { id: true, name: true, phone: true },
    take: RUN_CAP,
  });
  if (targets.length === 0) return { checked: 0, sent: 0 };

  const link = settings.catalogPublicUrl?.trim() ?? "";
  const template = settings.followUpInactiveMessage?.trim()
    || "هلا {{customerName}} 👋 اشتقنالك! آخر مرة طلبت هذي المواد:\n{{products}}\n\nتفضل شوف الجديد بالكتلوك:\n{{link}}";

  let sent = 0;
  for (const c of targets) {
    if (await isOptedOut(c.phone)) {
      await prisma.customer.update({ where: { id: c.id }, data: { inactiveFollowUpSentAt: new Date() } });
      continue;
    }
    const products = await pastProductsFor(c.id);
    const message = fillTemplate(template, {
      customerName: c.name,
      products: products.length > 0 ? products.join("، ") : "منتجاتنا",
      link,
    });
    try {
      await sendTextWithTemplateFallback(
        c.phone,
        settings.followUpInactiveTemplateName,
        "ar",
        message,
        [c.name, products.length > 0 ? products.join("، ") : "منتجاتنا", link || "-"],
      );
      sent++;
    } catch (err) {
      logger.warn(`[FollowUp:Inactive] send failed to ${c.phone}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await prisma.customer.update({ where: { id: c.id }, data: { inactiveFollowUpSentAt: new Date() } });
  }

  return { checked: targets.length, sent };
}
