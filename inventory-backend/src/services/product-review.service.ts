import prisma from "../config/database";
import { InvoiceStatus, InvoiceType } from "@prisma/client";
import { sendWhatsAppText } from "./whatsapp.service";
import { getSettings } from "./settings.service";

// A phone that's all zeros (or empty) is the shared "walk-in" sentinel used
// across the app (POS/InvoiceCreatePage) — never a real WhatsApp number.
function hasRealPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, "");
  return digits.length > 0 && !/^0+$/.test(digits);
}

const RATING_REQUEST_DELAY_DAYS = 2;

// Daily cron: every ACTIVE sale invoice at least RATING_REQUEST_DELAY_DAYS old
// that hasn't had a rating request sent yet gets one WhatsApp message asking
// the customer to rate their purchase. One-shot per invoice — guarded by
// ratingRequestedAt, not a repeating dedupe like the debt reminders (a
// customer who never replies isn't re-pinged daily).
export async function runRatingRequestJob() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RATING_REQUEST_DELAY_DAYS);

  const invoices = await prisma.invoice.findMany({
    where: {
      type: InvoiceType.SALE,
      status: InvoiceStatus.ACTIVE,
      archivedAt: null,
      date: { lte: cutoff },
      ratingRequestedAt: null,
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      items: { select: { productName: true }, take: 5 },
    },
    take: 200, // safety cap — a very large backlog spreads across subsequent daily runs
  });

  if (invoices.length === 0) return { checked: 0, sent: 0 };

  const settings = await getSettings();
  const storeName = settings.storeName?.trim() || "المحل";
  let sent = 0;

  for (const invoice of invoices) {
    if (!hasRealPhone(invoice.customer.phone)) {
      // No real phone to message — mark as requested anyway so this invoice
      // isn't re-scanned by the cron every day forever.
      await prisma.invoice.update({ where: { id: invoice.id }, data: { ratingRequestedAt: new Date() } });
      continue;
    }

    const productList = invoice.items.map((i) => i.productName).join("، ");
    const message =
      `مرحبا ${invoice.customer.name}، شكراً لتسوقك من ${storeName}! ` +
      `شلون تقيّم المواد اللي اشتريتها (${productList})؟ ` +
      `رد برقم من 1 إلى 5 (5 = ممتاز).`;

    try {
      await sendWhatsAppText(invoice.customer.phone, message);
      sent += 1;
    } catch {
      // WhatsApp send failure must never block marking ratingRequestedAt below —
      // otherwise a persistently-failing number would be retried forever.
    }
    await prisma.invoice.update({ where: { id: invoice.id }, data: { ratingRequestedAt: new Date() } });
  }

  return { checked: invoices.length, sent };
}

// Called from whatsapp-bot.service.ts's routeIncomingMessage BEFORE the
// generic bot/inbox handling — narrowly scoped so it only ever fires when a
// real pending rating request exists for this customer; otherwise it's a
// no-op and the caller falls through to existing behavior unchanged.
//
// IMPORTANT: a pending request can stay open for up to 14 days — during that
// window this customer's NEXT message must still reach the normal bot/inbox
// unless it actually looks like a rating reply. Without the shape check below,
// literally any message (a question, "شكراً", anything) would get silently
// swallowed into a fake review instead of reaching the owner. So this checks
// the message SHAPE first (cheap, no DB hit) and only queries for a pending
// invoice when the text plausibly is a rating.
export async function tryCaptureProductReviewReply(customerId: string, text: string): Promise<boolean> {
  const trimmed = text.trim();
  // A short reply starting with a digit 1-5 (optionally followed by more text,
  // e.g. "5 ممتاز") or a run of star characters. Anything else — a normal
  // question, greeting, unrelated message — is left alone.
  const digitMatch = trimmed.match(/^([1-5])\b/);
  const starsOnly = /^[⭐★]{1,5}$/.test(trimmed);
  if (!digitMatch && !starsOnly) return false;

  const pending = await prisma.invoice.findFirst({
    where: {
      customerId,
      type: InvoiceType.SALE,
      status: InvoiceStatus.ACTIVE,
      archivedAt: null,
      ratingRequestedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
      productReview: null,
    },
    orderBy: { ratingRequestedAt: "desc" },
    select: { id: true },
  });
  if (!pending) return false;

  const rating = digitMatch ? Number(digitMatch[1]) : starsOnly ? trimmed.length : null;

  await prisma.productReview.create({
    data: {
      invoiceId: pending.id,
      customerId,
      rating,
      comment: trimmed.slice(0, 1000),
    },
  });

  return true;
}

export interface ListProductReviewsQuery {
  page: number;
  limit: number;
}

export async function listProductReviews(query: ListProductReviewsQuery) {
  const skip = (query.page - 1) * query.limit;
  const [total, reviews] = await Promise.all([
    prisma.productReview.count(),
    prisma.productReview.findMany({
      orderBy: { createdAt: "desc" },
      skip,
      take: query.limit,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        invoice: { select: { id: true, invoiceNumber: true, date: true } },
      },
    }),
  ]);

  return {
    data: reviews,
    pagination: { total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) },
  };
}
