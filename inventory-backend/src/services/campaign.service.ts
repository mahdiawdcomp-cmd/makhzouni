import { CampaignRecipientStatus, CampaignStatus } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
import { normalizePhone } from "../utils/phone";
import { getSettings } from "./settings.service";
import { sendWhatsAppImage, sendWhatsAppText } from "./whatsapp.service";

const NEW_TAG = "new";

function randInt(min: number, max: number) {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pickRandom<T>(arr: T[]): T | null {
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl.trim());
  if (!match) return null;
  try {
    return { buffer: Buffer.from(match[2], "base64"), mime: match[1] };
  } catch {
    return null;
  }
}

/* ─── CRUD ───────────────────────────────────────────────────────────── */

export async function listCampaigns() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { recipients: true } } },
  });
  // Attach per-status counts so the UI can show progress bars.
  const withStats = await Promise.all(
    campaigns.map(async (c) => {
      const grouped = await prisma.campaignRecipient.groupBy({
        by: ["status"],
        where: { campaignId: c.id },
        _count: { _all: true },
      });
      const counts = { PENDING: 0, SENT: 0, FAILED: 0, SKIPPED: 0 };
      for (const g of grouped) counts[g.status] = g._count._all;
      return { ...c, total: c._count.recipients, counts };
    }),
  );
  return withStats;
}

export async function getCampaign(id: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      recipients: { orderBy: { createdAt: "asc" }, take: 500 },
      _count: { select: { recipients: true } },
    },
  });
  if (!campaign) throw new AppError("Campaign not found", 404, "CAMPAIGN_NOT_FOUND");
  return campaign;
}

export interface CampaignInput {
  name: string;
  messages?: string[];
  productIds?: string[];
  includeCatalogLink?: boolean;
  minDelaySec?: number;
  maxDelaySec?: number;
  dailyMin?: number;
  dailyMax?: number;
  activeStartHour?: number;
  activeEndHour?: number;
}

function sanitize(input: CampaignInput) {
  const messages = (input.messages ?? []).map((m) => m.trim()).filter(Boolean);
  const minDelaySec = Math.max(5, input.minDelaySec ?? 90);
  const maxDelaySec = Math.max(minDelaySec, input.maxDelaySec ?? 240);
  const dailyMin = Math.max(1, input.dailyMin ?? 20);
  const dailyMax = Math.max(dailyMin, input.dailyMax ?? 50);
  const activeStartHour = Math.min(23, Math.max(0, input.activeStartHour ?? 9));
  const activeEndHour = Math.min(24, Math.max(activeStartHour + 1, input.activeEndHour ?? 21));
  return {
    name: input.name.trim(),
    messages,
    productIds: input.productIds ?? [],
    includeCatalogLink: input.includeCatalogLink ?? true,
    minDelaySec,
    maxDelaySec,
    dailyMin,
    dailyMax,
    activeStartHour,
    activeEndHour,
  };
}

export async function createCampaign(input: CampaignInput) {
  if (!input.name?.trim()) throw new AppError("اسم الحملة مطلوب", 400, "CAMPAIGN_NAME_REQUIRED");
  return prisma.campaign.create({ data: sanitize(input) });
}

export async function updateCampaign(id: string, input: CampaignInput) {
  await getCampaign(id);
  return prisma.campaign.update({ where: { id }, data: sanitize(input) });
}

export async function deleteCampaign(id: string) {
  await getCampaign(id);
  await prisma.campaign.delete({ where: { id } });
  return { id };
}

export async function setCampaignStatus(id: string, status: CampaignStatus) {
  const campaign = await getCampaign(id);
  if (status === CampaignStatus.RUNNING && campaign.messages.length === 0) {
    throw new AppError("أضف نص رسالة واحدة على الأقل قبل التشغيل", 400, "CAMPAIGN_NO_MESSAGE");
  }
  // Resume sends immediately (no leftover wait from a previous pause).
  return prisma.campaign.update({
    where: { id },
    data: { status, ...(status === CampaignStatus.RUNNING ? { nextSendAt: null } : {}) },
  });
}

/* ─── Recipients / new-customer import ───────────────────────────────── */

export interface RecipientEntry {
  phone: string;
  name?: string;
}

// Save imported numbers as real customers tagged "new" (so they integrate with
// the catalog / customer system) AND enqueue them as campaign recipients.
export async function importRecipients(campaignId: string, entries: RecipientEntry[]) {
  await getCampaign(campaignId);

  const seen = new Set<string>();
  const clean: RecipientEntry[] = [];
  for (const e of entries) {
    const phone = normalizePhone(String(e.phone ?? ""));
    if (!phone || phone.length < 10 || seen.has(phone)) continue;
    seen.add(phone);
    clean.push({ phone, name: e.name?.trim() || undefined });
  }
  if (clean.length === 0) return { added: 0, duplicates: 0, total: 0 };

  // How many auto-named "new-N" customers already exist (for sequential naming).
  let counter = await prisma.customer.count({ where: { tags: { has: NEW_TAG } } });

  let added = 0;
  let duplicates = 0;
  for (const entry of clean) {
    // Skip phones already queued in THIS campaign.
    const exists = await prisma.campaignRecipient.findFirst({
      where: { campaignId, phone: entry.phone },
      select: { id: true },
    });
    if (exists) {
      duplicates++;
      continue;
    }

    const existingCustomer = await prisma.customer.findUnique({ where: { phone: entry.phone } });
    let name = entry.name;
    if (existingCustomer) {
      // Ensure the "new" tag is present without dropping existing tags.
      if (!existingCustomer.tags.includes(NEW_TAG)) {
        await prisma.customer.update({
          where: { id: existingCustomer.id },
          data: { tags: { set: [...existingCustomer.tags, NEW_TAG] }, deletedAt: null },
        });
      }
      name = name ?? existingCustomer.name;
    } else {
      counter++;
      name = name ?? `costmer-${String(counter).padStart(4, "0")}`;
      await prisma.customer.create({
        data: { name, phone: entry.phone, tags: [NEW_TAG], openingBalance: 0, currentBalance: 0 },
      });
    }

    await prisma.campaignRecipient.create({
      data: { campaignId, phone: entry.phone, name },
    });
    added++;
  }

  return { added, duplicates, total: clean.length };
}

export async function removeRecipient(campaignId: string, recipientId: string) {
  await getCampaign(campaignId);
  await prisma.campaignRecipient.deleteMany({ where: { id: recipientId, campaignId } });
  return { id: recipientId };
}

/* ─── Background worker ──────────────────────────────────────────────── */

async function sendOneMessage(
  campaign: { messages: string[]; productIds: string[]; includeCatalogLink: boolean },
  recipient: { phone: string },
): Promise<string> {
  const message = pickRandom(campaign.messages) ?? "";

  const settings = await getSettings().catch(() => null);
  const catalogLink = campaign.includeCatalogLink
    ? settings?.catalogPublicUrl?.trim() || ""
    : "";

  const productImages =
    campaign.productIds.length > 0
      ? (
          await prisma.product.findMany({
            where: { id: { in: campaign.productIds }, deletedAt: null },
          })
        )
          .map((p) => ({ product: p, image: p.imageUrl ? dataUrlToBuffer(p.imageUrl) : null }))
          .filter((x): x is { product: typeof x.product; image: { buffer: Buffer; mime: string } } => x.image !== null)
      : [];

  if (productImages.length > 0) {
    for (let idx = 0; idx < productImages.length; idx++) {
      const { product, image } = productImages[idx];
      const priceLine = product.retailPrice ? `\n${Number(product.retailPrice)} د.ع` : "";
      let caption = `📦 ${product.name}${priceLine}`;
      if (idx === 0) {
        caption = catalogLink
          ? `${message}\n\n${caption}\n\n🗂️ الكاتلوج: ${catalogLink}`
          : `${message}\n\n${caption}`;
      }
      await sendWhatsAppImage(recipient.phone, caption, image.buffer, image.mime);
      // Small pause between multiple images of the same recipient.
      await new Promise((r) => setTimeout(r, 600));
    }
  } else {
    const body = catalogLink ? `${message}\n\n🗂️ الكاتلوج: ${catalogLink}` : message;
    await sendWhatsAppText(recipient.phone, body);
  }

  return message;
}

// Processes a single campaign step. Called by a per-minute cron tick. At most
// ONE recipient is messaged per tick per campaign, gated by a randomized delay,
// a randomized daily cap, and an active-hours window — so the send pattern looks
// human and avoids WhatsApp bans.
async function processCampaign(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status !== CampaignStatus.RUNNING) return;

  const now = new Date();
  const hour = now.getHours();
  if (hour < campaign.activeStartHour || hour >= campaign.activeEndHour) return;

  // Reset / roll the daily counters at the start of each day with a fresh
  // random cap (so the number of messages per day is never constant).
  let { sentToday, dailyCapToday } = campaign;
  if (!campaign.dayAnchor || !isSameDay(campaign.dayAnchor, now)) {
    sentToday = 0;
    dailyCapToday = randInt(campaign.dailyMin, campaign.dailyMax);
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { dayAnchor: now, sentToday, dailyCapToday },
    });
  }

  if (sentToday >= dailyCapToday) return; // hit today's random cap
  if (campaign.nextSendAt && now < campaign.nextSendAt) return; // still waiting random gap

  const recipient = await prisma.campaignRecipient.findFirst({
    where: { campaignId: campaign.id, status: CampaignRecipientStatus.PENDING },
    orderBy: { createdAt: "asc" },
  });

  if (!recipient) {
    // Nothing left to send — campaign is finished.
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: CampaignStatus.DONE } });
    return;
  }

  const nextGapMs = randInt(campaign.minDelaySec, campaign.maxDelaySec) * 1000;
  try {
    const variant = await sendOneMessage(campaign, recipient);
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: { status: CampaignRecipientStatus.SENT, sentAt: now, variantUsed: variant },
    });
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        sentToday: { increment: 1 },
        lastSentAt: now,
        nextSendAt: new Date(now.getTime() + nextGapMs),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[Campaign ${campaign.name}] send failed to ${recipient.phone}: ${msg}`);
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: { status: CampaignRecipientStatus.FAILED, error: msg.slice(0, 500) },
    });
    // Still advance the gap so a persistent failure doesn't hammer the API.
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { nextSendAt: new Date(now.getTime() + nextGapMs) },
    });
  }
}

let ticking = false;
export async function processCampaignsTick() {
  if (ticking) return; // never overlap ticks
  ticking = true;
  try {
    const running = await prisma.campaign.findMany({
      where: { status: CampaignStatus.RUNNING },
      select: { id: true },
    });
    for (const c of running) {
      await processCampaign(c.id).catch((e) =>
        logger.warn(`[Campaign] tick failed for ${c.id}: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  } finally {
    ticking = false;
  }
}
