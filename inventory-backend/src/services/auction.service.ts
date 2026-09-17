/**
 * «مزاد تصفية الراكد».
 *
 * The merchant picks goods that have sat unsold, the quantity, the unit, a
 * starting price and how each bid steps up. Anyone with the link bids by pressing
 * a button — the SERVER decides the amount, the bidder never types one. A bid in
 * the last five minutes pushes the end an hour later, as many times as it takes.
 * When the time runs out the merchant is told who won, at what price, and how to
 * reach them. Nothing here touches stock or money: the merchant invoices by hand,
 * and the goods are deliberately not reserved (they have been sitting for years).
 */
import { randomBytes } from "crypto";
import { Prisma, Unit } from "@prisma/client";
import prisma from "../config/database";
import { NotificationCategory, NotificationSeverity } from "../constants/notifications";
import { AppError } from "../utils/app-error";
import { normalizePhone } from "../utils/phone";
import { notifyAdmin } from "./app-notification.service";

export const SNIPE_WINDOW_MS = 5 * 60 * 1000;
export const EXTENSION_MS = 60 * 60 * 1000;
/** Percentage steps round UP to this many dinars, and never fall below it. */
export const PERCENT_STEP_ROUNDING = 250;

export type IncrementType = "PERCENT" | "AMOUNT";
export type AuctionStatus = "ACTIVE" | "ENDED" | "CANCELLED";

type PriceState = {
  startPrice: number;
  incrementType: IncrementType;
  incrementValue: number;
  currentPrice: number | null;
  bidCount: number;
};

/** What the next press of «زايد» costs. */
export function nextBidAmount(state: PriceState): number {
  const step = (base: number) =>
    state.incrementType === "AMOUNT"
      ? state.incrementValue
      : Math.max(
          PERCENT_STEP_ROUNDING,
          Math.ceil((base * state.incrementValue) / 100 / PERCENT_STEP_ROUNDING) * PERCENT_STEP_ROUNDING,
        );
  if (state.bidCount === 0 || state.currentPrice == null) {
    // The first bid IS the starting price — unless it starts at zero, where a
    // zero bid would mean nothing.
    return state.startPrice > 0 ? state.startPrice : step(0);
  }
  return state.currentPrice + step(state.currentPrice);
}

/** A bid this close to the end buys everyone else another hour. */
export function extendedEnd(endsAt: Date, bidAt: Date): Date | null {
  const left = endsAt.getTime() - bidAt.getTime();
  return left > 0 && left <= SNIPE_WINDOW_MS ? new Date(endsAt.getTime() + EXTENSION_MS) : null;
}

/** 07701234567 → 0770•••••67 — enough to recognise yourself, not to dial. */
export function maskPhone(phone: string): string {
  const national = toNationalPhone(phone);
  if (national.length < 6) return "•••";
  return `${national.slice(0, 4)}${"•".repeat(Math.max(3, national.length - 6))}${national.slice(-2)}`;
}

export function toNationalPhone(phone: string): string {
  const intl = normalizePhone(phone);
  return intl.startsWith("964") ? `0${intl.slice(3)}` : intl;
}

const num = (value: Prisma.Decimal | number | null | undefined) => (value == null ? null : Number(value));

function priceState(lot: {
  startPrice: Prisma.Decimal; incrementType: string; incrementValue: Prisma.Decimal;
  currentPrice: Prisma.Decimal | null; bidCount: number;
}): PriceState {
  return {
    startPrice: Number(lot.startPrice),
    incrementType: lot.incrementType as IncrementType,
    incrementValue: Number(lot.incrementValue),
    currentPrice: num(lot.currentPrice),
    bidCount: lot.bidCount,
  };
}

const productSelect = {
  id: true, name: true, itemNumber: true, thumbnailUrl: true, pcsPerCarton: true,
} as const;

// ── Merchant side ──────────────────────────────────────────────────────────

export interface CreateAuctionInput {
  productId: string;
  unit: "PIECE" | "CARTON";
  quantity: number;
  startPrice: number;
  incrementType: IncrementType;
  incrementValue: number;
  endsAt: string;
  notes?: string;
}

export async function createAuction(input: CreateAuctionInput, createdBy: string) {
  const endsAt = new Date(input.endsAt);
  if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now() + 60_000) {
    throw new AppError("وقت انتهاء المزاد لازم يكون بالمستقبل", 400, "AUCTION_END_IN_PAST");
  }
  if (input.incrementType === "PERCENT" && input.incrementValue > 100) {
    throw new AppError("نسبة الزيادة لا تتجاوز 100٪", 400, "AUCTION_BAD_INCREMENT");
  }
  const product = await prisma.product.findFirst({ where: { id: input.productId, deletedAt: null }, select: { id: true } });
  if (!product) throw new AppError("المادة غير موجودة", 404, "PRODUCT_NOT_FOUND");

  const lot = await prisma.auctionLot.create({
    data: {
      token: randomBytes(12).toString("base64url"),
      productId: input.productId,
      unit: input.unit as Unit,
      quantity: input.quantity,
      startPrice: input.startPrice,
      incrementType: input.incrementType,
      incrementValue: input.incrementValue,
      endsAt,
      notes: input.notes?.trim() || null,
      createdBy,
    },
  });
  return getAuctionForMerchant(lot.id);
}

function shapeForMerchant(lot: Prisma.AuctionLotGetPayload<{ include: { product: { select: typeof productSelect }; bids: true } }>) {
  const state = priceState(lot);
  const bids = [...lot.bids].sort((a, b) => Number(b.amount) - Number(a.amount) || b.createdAt.getTime() - a.createdAt.getTime());
  const winner = lot.winnerBidId ? bids.find((b) => b.id === lot.winnerBidId) ?? null : null;
  return {
    id: lot.id,
    token: lot.token,
    product: lot.product,
    unit: lot.unit,
    quantity: lot.quantity,
    startPrice: state.startPrice,
    incrementType: state.incrementType,
    incrementValue: state.incrementValue,
    currentPrice: state.currentPrice,
    nextBid: nextBidAmount(state),
    bidCount: lot.bidCount,
    endsAt: lot.endsAt.toISOString(),
    status: lot.status as AuctionStatus,
    notes: lot.notes,
    endedAt: lot.endedAt?.toISOString() ?? null,
    cancelledAt: lot.cancelledAt?.toISOString() ?? null,
    acknowledgedAt: lot.acknowledgedAt?.toISOString() ?? null,
    createdAt: lot.createdAt.toISOString(),
    winner: winner
      ? { name: winner.bidderName, phone: toNationalPhone(winner.bidderPhone), amount: Number(winner.amount), total: Number(winner.amount) * lot.quantity }
      : null,
    // The merchant sees everyone, full numbers, highest first — so if the
    // winner never answers, the runner-up is one call away.
    bids: bids.map((b) => ({
      id: b.id,
      name: b.bidderName,
      phone: toNationalPhone(b.bidderPhone),
      amount: Number(b.amount),
      extendedEnd: b.extendedEnd,
      createdAt: b.createdAt.toISOString(),
    })),
  };
}

export async function getAuctionForMerchant(id: string) {
  const lot = await prisma.auctionLot.findUnique({
    where: { id },
    include: { product: { select: productSelect }, bids: true },
  });
  if (!lot) throw new AppError("المزاد غير موجود", 404, "AUCTION_NOT_FOUND");
  return shapeForMerchant(lot);
}

export async function listAuctions(query: { status?: AuctionStatus }) {
  // Close anything already past its time before answering, so the list never
  // shows a finished auction as still running between cron ticks.
  await closeExpiredAuctions();
  const lots = await prisma.auctionLot.findMany({
    where: query.status ? { status: query.status } : {},
    include: { product: { select: productSelect }, bids: true },
    orderBy: [{ status: "asc" }, { endsAt: "asc" }],
    take: 300,
  });
  return lots.map(shapeForMerchant);
}

/** Finished auctions the merchant has not dismissed yet — the dashboard banner. */
export async function listUnacknowledgedResults() {
  await closeExpiredAuctions();
  const lots = await prisma.auctionLot.findMany({
    where: { status: "ENDED", acknowledgedAt: null },
    include: { product: { select: productSelect }, bids: true },
    orderBy: { endedAt: "desc" },
    take: 20,
  });
  return lots.map(shapeForMerchant);
}

export async function cancelAuction(id: string) {
  const result = await prisma.auctionLot.updateMany({
    where: { id, status: "ACTIVE" },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  if (result.count === 0) {
    throw new AppError("المزاد منتهي أو ملغى مسبقاً", 409, "AUCTION_NOT_ACTIVE");
  }
  return getAuctionForMerchant(id);
}

export async function acknowledgeAuction(id: string) {
  await prisma.auctionLot.updateMany({
    where: { id, status: { not: "ACTIVE" }, acknowledgedAt: null },
    data: { acknowledgedAt: new Date() },
  });
  return getAuctionForMerchant(id);
}

// ── Closing ────────────────────────────────────────────────────────────────

/**
 * Ends every auction whose time is up and tells the merchant. Safe to run from
 * several places at once: each row is claimed with a conditional update, and a
 * bid that extended the end a moment ago makes the claim miss — as it should.
 */
export async function closeExpiredAuctions(now = new Date()) {
  const due = await prisma.auctionLot.findMany({
    where: { status: "ACTIVE", endsAt: { lte: now } },
    select: { id: true },
    take: 100,
  });

  let closed = 0;
  for (const { id } of due) {
    const outcome = await prisma.$transaction(async (tx) => {
      const top = await tx.auctionBid.findFirst({
        where: { auctionId: id },
        orderBy: [{ amount: "desc" }, { createdAt: "asc" }],
      });
      const claim = await tx.auctionLot.updateMany({
        where: { id, status: "ACTIVE", endsAt: { lte: now } },
        data: { status: "ENDED", endedAt: now, winnerBidId: top?.id ?? null },
      });
      if (claim.count === 0) return null;
      const lot = await tx.auctionLot.findUniqueOrThrow({
        where: { id },
        include: { product: { select: { name: true } } },
      });
      return { lot, top };
    });
    if (!outcome) continue;
    closed += 1;

    const { lot, top } = outcome;
    const unitLabel = lot.unit === "CARTON" ? "كارتون" : "قطعة";
    const title = top ? `انتهى مزاد ${lot.product.name}` : `انتهى مزاد ${lot.product.name} بدون مزايدات`;
    const message = top
      ? `وصل السعر ${Number(top.amount).toLocaleString("en-US")} د.ع لل${unitLabel} (${lot.quantity} ${unitLabel}) — الفايز ${top.bidderName}، ${toNationalPhone(top.bidderPhone)}`
      : `ما زايد أحد على ${lot.quantity} ${unitLabel}.`;
    // The banner on the dashboard is the primary signal; the bell is a backup,
    // so a failure here must never undo the close.
    await notifyAdmin({
      type: "AUCTION_ENDED",
      category: NotificationCategory.IMPORTANT,
      severity: NotificationSeverity.IMPORTANT,
      title,
      message,
      entityType: "AUCTION",
      entityId: lot.id,
      actionUrl: "/auctions",
    }).catch((error) => console.warn("[auction] notification failed", error instanceof Error ? error.message : error));
  }
  return closed;
}

// ── Public side ────────────────────────────────────────────────────────────

async function findByToken(token: string) {
  const lot = await prisma.auctionLot.findUnique({
    where: { token },
    include: {
      product: { select: productSelect },
      bids: { orderBy: [{ amount: "desc" }, { createdAt: "asc" }], take: 50 },
    },
  });
  if (!lot) throw new AppError("المزاد غير موجود", 404, "AUCTION_NOT_FOUND");
  return lot;
}

export async function getPublicAuction(token: string, viewerPhone?: string) {
  let lot = await findByToken(token);
  if (lot.status === "ACTIVE" && lot.endsAt.getTime() <= Date.now()) {
    await closeExpiredAuctions();
    lot = await findByToken(token);
  }
  const state = priceState(lot);
  const viewer = viewerPhone ? normalizePhone(viewerPhone) : null;
  const top = lot.bids[0] ?? null;
  return {
    token: lot.token,
    product: { name: lot.product.name, itemNumber: lot.product.itemNumber, thumbnailUrl: lot.product.thumbnailUrl, pcsPerCarton: lot.product.pcsPerCarton },
    unit: lot.unit,
    quantity: lot.quantity,
    startPrice: state.startPrice,
    incrementType: state.incrementType,
    incrementValue: state.incrementValue,
    currentPrice: state.currentPrice,
    nextBid: nextBidAmount(state),
    bidCount: lot.bidCount,
    endsAt: lot.endsAt.toISOString(),
    serverNow: new Date().toISOString(),
    status: lot.status as AuctionStatus,
    notes: lot.notes,
    // Strangers see each other only as a first name and a masked number.
    bids: lot.bids.map((b) => ({
      name: b.bidderName,
      phone: maskPhone(b.bidderPhone),
      amount: Number(b.amount),
      createdAt: b.createdAt.toISOString(),
      mine: viewer !== null && b.bidderPhone === viewer,
    })),
    leading: viewer !== null && top?.bidderPhone === viewer,
    won: lot.status === "ENDED" && viewer !== null && top?.bidderPhone === viewer,
  };
}

export interface PlaceBidInput {
  name: string;
  phone: string;
  /** The amount the bidder's button showed. A different server figure means someone got there first. */
  expectedAmount: number;
}

export async function placeBid(token: string, input: PlaceBidInput) {
  const name = input.name.trim();
  const phone = normalizePhone(input.phone);
  if (name.length < 2) throw new AppError("اكتب اسمك", 400, "AUCTION_NAME_REQUIRED");
  if (!/^9647\d{9}$/.test(phone)) throw new AppError("رقم الهاتف غير صحيح", 400, "AUCTION_BAD_PHONE");

  const lot = await findByToken(token);
  const now = new Date();
  if (lot.status !== "ACTIVE" || lot.endsAt.getTime() <= now.getTime()) {
    throw new AppError("المزاد انتهى", 409, "AUCTION_CLOSED");
  }
  if (lot.bids[0]?.bidderPhone === phone) {
    throw new AppError("أنت صاحب أعلى مزايدة حالياً", 409, "AUCTION_ALREADY_LEADING");
  }

  const amount = nextBidAmount(priceState(lot));
  if (Math.abs(amount - input.expectedAmount) > 0.001) {
    throw new AppError("أحد زايد قبلك — السعر تغيّر، راجع السعر الجديد", 409, "AUCTION_PRICE_CHANGED");
  }

  const newEnd = extendedEnd(lot.endsAt, now);
  await prisma.$transaction(async (tx) => {
    // Optimistic lock on bidCount: two presses of the same price, one wins.
    const claim = await tx.auctionLot.updateMany({
      where: { id: lot.id, status: "ACTIVE", bidCount: lot.bidCount, endsAt: { gt: now } },
      data: {
        currentPrice: amount,
        bidCount: { increment: 1 },
        ...(newEnd ? { endsAt: newEnd } : {}),
      },
    });
    if (claim.count === 0) {
      throw new AppError("أحد زايد قبلك — السعر تغيّر، راجع السعر الجديد", 409, "AUCTION_PRICE_CHANGED");
    }
    await tx.auctionBid.create({
      data: { auctionId: lot.id, bidderName: name.slice(0, 60), bidderPhone: phone, amount, extendedEnd: newEnd !== null },
    });
  });

  return getPublicAuction(token, phone);
}
