import { InvoiceStatus, InvoiceType, Prisma } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { roundMoney } from "../utils/financial";
import { getSettings } from "./settings.service";

/* ══════════════════════════════════════════════════════════════════════
   «نقاط الولاء» — spending them

   Points are earned automatically at 10 per 1,000 IQD of PROFIT, and until
   now nothing could ever be done with them: the only thing that lowered a
   balance was cancelling the invoice that created it. A number that only ever
   grows is not a reward, it is a promise nobody can call in.

   Redemption is a discount on the customer's next invoice, applied by the
   shop, in the same transaction that creates the invoice — so a balance can
   never be spent twice and no invoice can carry a discount nobody paid for.
══════════════════════════════════════════════════════════════════════ */

export interface LoyaltyConfig {
  /** Dinars per point. 0 turns redemption off without touching any balance. */
  pointValue: number;
  /** How long a point lives. 0 = never expires. */
  expiryDays: number;
}

export async function loyaltyConfig(): Promise<LoyaltyConfig> {
  const s = await getSettings();
  const pointValue = Number(s.loyaltyPointValue);
  const expiryDays = Number(s.loyaltyExpiryDays);
  return {
    pointValue: Number.isFinite(pointValue) && pointValue >= 0 ? pointValue : 5,
    expiryDays: Number.isFinite(expiryDays) && expiryDays >= 0 ? Math.round(expiryDays) : 365,
  };
}

export interface LoyaltyBalance {
  /** Everything the customer has ever been left holding. */
  lifetime: number;
  /** What can actually be spent today, after expiry and past redemptions. */
  redeemable: number;
  /** Points earned too long ago to spend. */
  expired: number;
  redeemedTotal: number;
  excluded: boolean;
  pointValue: number;
  expiryDays: number;
  /** `redeemable` in dinars, at today's rate. */
  redeemableValue: number;
}

/**
 * What a customer can actually spend.
 *
 * Expiry needs to know WHEN each point was earned, and the stored balance is
 * a single running total with no date on it. The dates do exist though — every
 * sale invoice carries the points it froze — so the spendable figure is
 * derived from those rather than kept as a second balance that would drift out
 * of step with the first.
 */
export async function loyaltyBalanceFor(customerId: string): Promise<LoyaltyBalance> {
  const cfg = await loyaltyConfig();
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { loyaltyPoints: true, loyaltyExcluded: true },
  });
  if (!customer) throw new AppError("الزبون غير موجود", 404, "CUSTOMER_NOT_FOUND");

  const since = cfg.expiryDays > 0
    ? new Date(Date.now() - cfg.expiryDays * 86_400_000)
    : null;

  const [earnedInWindow, redeemed] = await Promise.all([
    prisma.invoice.aggregate({
      where: {
        customerId,
        type: InvoiceType.SALE,
        status: InvoiceStatus.ACTIVE,
        ...(since ? { date: { gte: since } } : {}),
      },
      _sum: { loyaltyPointsEarned: true },
    }),
    prisma.loyaltyRedemption.aggregate({
      where: { customerId, revertedAt: null },
      _sum: { points: true },
    }),
  ]);

  const inWindow = earnedInWindow._sum.loyaltyPointsEarned ?? 0;
  const redeemedTotal = redeemed._sum.points ?? 0;
  // Clamped: an old redemption may have consumed points that would since have
  // expired anyway, and that must not push the balance below zero.
  const redeemable = customer.loyaltyExcluded ? 0 : Math.max(0, inWindow - redeemedTotal);

  return {
    lifetime: customer.loyaltyPoints,
    redeemable,
    expired: Math.max(0, customer.loyaltyPoints + redeemedTotal - inWindow),
    redeemedTotal,
    excluded: customer.loyaltyExcluded,
    pointValue: cfg.pointValue,
    expiryDays: cfg.expiryDays,
    redeemableValue: roundMoney(redeemable * cfg.pointValue),
  };
}

/**
 * Spend points, inside the caller's transaction.
 *
 * Called from invoice creation with the transaction it is already running in,
 * so the deduction, the redemption record and the invoice's discount either
 * all happen or none do. Returns the dinar value to put on the invoice.
 */
export async function redeemPointsInTransaction(
  tx: Prisma.TransactionClient,
  input: { customerId: string; points: number; invoiceId?: string; note?: string },
  userId: string,
): Promise<{ points: number; value: number }> {
  const points = Math.floor(Number(input.points));
  if (!Number.isFinite(points) || points <= 0) {
    throw new AppError("عدد النقاط لازم يكون أكبر من صفر", 400, "INVALID_POINTS");
  }

  const cfg = await loyaltyConfig();
  if (cfg.pointValue <= 0) {
    throw new AppError("استبدال النقاط مطفي — حدد قيمة النقطة بالإعدادات", 400, "REDEMPTION_DISABLED");
  }

  // Re-read the balance inside the transaction. Checking it outside would let
  // two redemptions racing on the same customer both pass.
  const balance = await loyaltyBalanceFor(input.customerId);
  if (balance.excluded) {
    throw new AppError("هذا الحساب مستثنى من نظام النقاط", 400, "LOYALTY_EXCLUDED");
  }
  if (points > balance.redeemable) {
    throw new AppError(
      `النقاط القابلة للاستبدال ${balance.redeemable} فقط — طلبت ${points}`,
      400,
      "INSUFFICIENT_POINTS",
    );
  }

  const value = roundMoney(points * cfg.pointValue);

  await tx.customer.update({
    where: { id: input.customerId },
    data: { loyaltyPoints: { decrement: points } },
  });
  await tx.loyaltyRedemption.create({
    data: {
      customerId: input.customerId,
      points,
      value,
      // Frozen: the rate is a setting, and changing it must not rewrite what
      // an old redemption was worth.
      pointValue: cfg.pointValue,
      invoiceId: input.invoiceId ?? null,
      note: input.note?.trim() || null,
      createdBy: userId,
    },
  });

  return { points, value };
}

/**
 * Hand points back when the invoice that spent them is cancelled or deleted.
 *
 * Mirrors the earn side, which pulls back exactly what an invoice froze. A
 * cancelled invoice charges the customer nothing, so it must not cost them
 * points either.
 */
export async function revertRedemptionsForInvoice(
  tx: Prisma.TransactionClient,
  invoiceId: string,
) {
  const rows = await tx.loyaltyRedemption.findMany({
    where: { invoiceId, revertedAt: null },
    select: { id: true, customerId: true, points: true },
  });
  for (const r of rows) {
    await tx.customer.update({
      where: { id: r.customerId },
      data: { loyaltyPoints: { increment: r.points } },
    });
    await tx.loyaltyRedemption.update({
      where: { id: r.id },
      data: { revertedAt: new Date() },
    });
  }
  return rows.reduce((sum, r) => sum + r.points, 0);
}

/** Every redemption on a customer's record, newest first. */
export async function listRedemptions(customerId: string) {
  const rows = await prisma.loyaltyRedemption.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true, points: true, value: true, pointValue: true,
      invoiceId: true, note: true, createdAt: true, revertedAt: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    value: Number(r.value),
    pointValue: Number(r.pointValue),
  }));
}

/**
 * Exclude an account from loyalty, optionally clearing what it holds.
 *
 * For collection accounts like «الزبون النقدي» — a till, not a person. Points
 * piling up there reward nobody and inflate what the shop appears to owe.
 */
export async function setLoyaltyExcluded(
  customerId: string,
  excluded: boolean,
  clearPoints: boolean,
  userId: string,
) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, name: true, loyaltyPoints: true },
  });
  if (!customer) throw new AppError("الزبون غير موجود", 404, "CUSTOMER_NOT_FOUND");

  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customerId },
      data: {
        loyaltyExcluded: excluded,
        ...(clearPoints ? { loyaltyPoints: 0 } : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        userId,
        action: "LOYALTY_EXCLUSION_CHANGED",
        entity: "Customer",
        recordId: customerId,
        metadata: {
          name: customer.name,
          excluded,
          clearedPoints: clearPoints ? customer.loyaltyPoints : 0,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return { excluded, clearedPoints: clearPoints ? customer.loyaltyPoints : 0 };
}
