// بند ٦ من خطة قمع الواتساب — قياس أي صيغة رسالة تنجح فعلاً. يُحتسب على وقت
// الاستعلام (لا يوجد جدول أحداث منفصل — الحجم صغير أصلاً بحكم وتيرة الحملات
// المتعمَّدة الهادئة، 20-50 رسالة باليوم لكل حملة).
import { InvoiceStatus, InvoiceType } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { normalizeArabic } from "../utils/arabic-search";
import { assistantTimezone, zonedDayRange } from "./daily-assistant.service";

// «ردّ» يُنسب لآخر إرسال لنفس الرقم خلال هذي المدة قبله — حتى رد جاء بعد
// حملتين لاحقتين ما يُنسب لأقدم حملة قديمة.
const ATTRIBUTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface FunnelRecipient {
  id: string;
  phone: string;
  variantUsed: string;
  sentAt: Date;
  campaignId: string;
}

interface VariantStats {
  variant: string;
  // Same wording can legitimately be reused across different campaigns
  // (different audience/date) — their stats are intentionally combined under
  // one row (بند ٦ measures phrasing, not a single campaign run), but that
  // must stay visible instead of silently hidden behind one clean-looking row.
  campaignCount: number;
  sent: number;
  replied: number;
  boughtChoice: number;
  registered: number;
  openedCatalog: number;
  firstOrder: number;
}

export interface CampaignFunnelReport {
  from: string | null;
  to: string | null;
  tag: string | null;
  totals: Omit<VariantStats, "variant" | "campaignCount">;
  byVariant: VariantStats[];
}

/** آخر إرسال لهذا الرقم قبل eventTime بحدود نافذة الإسناد، أو null لو ماكو. */
function attribute(
  phone: string,
  eventTime: Date,
  byPhone: Map<string, FunnelRecipient[]>,
): FunnelRecipient | null {
  const candidates = byPhone.get(phone);
  if (!candidates) return null;
  let best: FunnelRecipient | null = null;
  for (const r of candidates) {
    if (r.sentAt > eventTime) continue;
    if (eventTime.getTime() - r.sentAt.getTime() > ATTRIBUTION_WINDOW_MS) continue;
    if (!best || r.sentAt > best.sentAt) best = r;
  }
  return best;
}

export async function getCampaignFunnelReport(filters: {
  from?: string;
  to?: string;
  tag?: string;
}): Promise<CampaignFunnelReport> {
  const tz = assistantTimezone();
  const sentAtFilter: { gte?: Date; lte?: Date } = {};
  // Malformed values (URL-editing, a stray query param) must 400 cleanly
  // instead of reaching Prisma as an Invalid Date and surfacing as a 500 on
  // a plain admin-facing GET.
  if (filters.from) {
    if (Number.isNaN(Date.parse(filters.from))) {
      throw new AppError("تاريخ البداية غير صالح", 400, "CAMPAIGN_FUNNEL_BAD_FROM");
    }
    sentAtFilter.gte = zonedDayRange(filters.from, tz).start;
  }
  if (filters.to) {
    if (Number.isNaN(Date.parse(filters.to))) {
      throw new AppError("تاريخ النهاية غير صالح", 400, "CAMPAIGN_FUNNEL_BAD_TO");
    }
    sentAtFilter.lte = zonedDayRange(filters.to, tz).end;
  }

  const recipients = await prisma.campaignRecipient.findMany({
    where: { sentAt: { not: null, ...sentAtFilter } },
    select: { id: true, phone: true, variantUsed: true, sentAt: true, campaignId: true },
    orderBy: { sentAt: "asc" },
  });

  const empty = { sent: 0, replied: 0, boughtChoice: 0, registered: 0, openedCatalog: 0, firstOrder: 0 };
  if (recipients.length === 0) {
    return { from: filters.from ?? null, to: filters.to ?? null, tag: filters.tag ?? null, totals: empty, byVariant: [] };
  }

  const funnelRecipients: FunnelRecipient[] = recipients.map((r) => ({
    id: r.id,
    phone: r.phone,
    // A recipient with no recorded variant is grouped under a row scoped to
    // ITS OWN id, not a shared bucket — every current write path sets
    // variantUsed and sentAt together, but a future backfill/manual-send path
    // that sets one without the other must never silently merge unrelated
    // campaigns' stats into one indistinguishable "(بلا صيغة)" row.
    variantUsed: r.variantUsed ?? `(بلا صيغة — ${r.id})`,
    sentAt: r.sentAt!,
    campaignId: r.campaignId,
  }));

  const byPhone = new Map<string, FunnelRecipient[]>();
  for (const r of funnelRecipients) {
    const list = byPhone.get(r.phone) ?? [];
    list.push(r);
    byPhone.set(r.phone, list);
  }

  const phones = [...byPhone.keys()];
  const earliestSend = funnelRecipients[0].sentAt;
  const latestWindowEnd = new Date(
    funnelRecipients.reduce((max, r) => Math.max(max, r.sentAt.getTime()), 0) + ATTRIBUTION_WINDOW_MS,
  );

  const repliedIds = new Set<string>();
  const boughtIds = new Set<string>();
  const registeredIds = new Set<string>();
  const openedIds = new Set<string>();
  const orderedIds = new Set<string>();

  // ── ردّ + اختار الشراء: أي رسالة واردة، ومطابقة "1" مطبَّعة (أرقام عربية
  // تُطوى تلقائياً بـnormalizeArabic) خلال نافذة الإسناد.
  const inbound = await prisma.whatsappMessage.findMany({
    where: {
      direction: "IN",
      createdAt: { gte: earliestSend, lte: latestWindowEnd },
      conversation: { phone: { in: phones } },
    },
    select: { text: true, createdAt: true, conversation: { select: { phone: true } } },
  });
  for (const msg of inbound) {
    const match = attribute(msg.conversation.phone, msg.createdAt, byPhone);
    if (!match) continue;
    repliedIds.add(match.id);
    if (normalizeArabic(msg.text) === "1") boughtIds.add(match.id);
  }

  // ── كمّل التسجيل: طلب CATALOG_ACCESS مصدره تحديداً محادثة الواتساب (بند ٥)،
  // مو طلبات الكتلوك العام المباشرة — تلك مسار مختلف كلياً.
  const approvals = await prisma.pendingApproval.findMany({
    where: { requestType: "CATALOG_ACCESS", createdAt: { gte: earliestSend, lte: latestWindowEnd } },
    select: { requestData: true, createdAt: true },
  });
  for (const a of approvals) {
    const data = a.requestData as { source?: string; phone?: string } | null;
    if (data?.source !== "WHATSAPP_REGISTRATION" || !data.phone) continue;
    const match = attribute(data.phone, a.createdAt, byPhone);
    if (match) registeredIds.add(match.id);
  }

  // ── فتح الكتلوك + أول طلب: يحتاجان زبون فعلي بنفس الرقم أولاً.
  const customers = await prisma.customer.findMany({
    where: { phone: { in: phones } },
    select: { id: true, phone: true, tags: true },
  });
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const customerIds = customers.map((c) => c.id);

  const tagFilter = filters.tag?.trim();
  const passesTag = (custId: string) => !tagFilter || !!customerById.get(custId)?.tags.includes(tagFilter);

  if (customerIds.length > 0) {
    const links = await prisma.catalogAccessLink.findMany({
      where: { customerId: { in: customerIds }, lastViewedAt: { not: null } },
      select: { customerId: true, lastViewedAt: true },
    });
    for (const link of links) {
      if (!passesTag(link.customerId)) continue;
      const cust = customerById.get(link.customerId);
      if (!cust) continue;
      const match = attribute(cust.phone, link.lastViewedAt!, byPhone);
      if (match) openedIds.add(match.id);
    }

    const firstSales = await prisma.invoice.groupBy({
      by: ["customerId"],
      where: { customerId: { in: customerIds }, type: InvoiceType.SALE, status: InvoiceStatus.ACTIVE },
      _min: { date: true },
    });
    for (const sale of firstSales) {
      if (!sale.customerId || !sale._min.date) continue;
      if (!passesTag(sale.customerId)) continue;
      const cust = customerById.get(sale.customerId);
      if (!cust) continue;
      const match = attribute(cust.phone, sale._min.date, byPhone);
      if (match) orderedIds.add(match.id);
    }
  }

  const byVariantMap = new Map<string, VariantStats>();
  const campaignsByVariant = new Map<string, Set<string>>();
  for (const r of funnelRecipients) {
    const stats = byVariantMap.get(r.variantUsed) ?? {
      variant: r.variantUsed,
      campaignCount: 0,
      sent: 0, replied: 0, boughtChoice: 0, registered: 0, openedCatalog: 0, firstOrder: 0,
    };
    stats.sent++;
    if (repliedIds.has(r.id)) stats.replied++;
    if (boughtIds.has(r.id)) stats.boughtChoice++;
    if (registeredIds.has(r.id)) stats.registered++;
    if (openedIds.has(r.id)) stats.openedCatalog++;
    if (orderedIds.has(r.id)) stats.firstOrder++;
    byVariantMap.set(r.variantUsed, stats);

    const campaignSet = campaignsByVariant.get(r.variantUsed) ?? new Set<string>();
    campaignSet.add(r.campaignId);
    campaignsByVariant.set(r.variantUsed, campaignSet);
  }
  for (const [variant, stats] of byVariantMap) {
    stats.campaignCount = campaignsByVariant.get(variant)?.size ?? 1;
  }

  const byVariant = [...byVariantMap.values()].sort((a, b) => b.sent - a.sent);
  const totals = byVariant.reduce(
    (acc, v) => ({
      sent: acc.sent + v.sent,
      replied: acc.replied + v.replied,
      boughtChoice: acc.boughtChoice + v.boughtChoice,
      registered: acc.registered + v.registered,
      openedCatalog: acc.openedCatalog + v.openedCatalog,
      firstOrder: acc.firstOrder + v.firstOrder,
    }),
    { ...empty },
  );

  return { from: filters.from ?? null, to: filters.to ?? null, tag: filters.tag ?? null, totals, byVariant };
}
