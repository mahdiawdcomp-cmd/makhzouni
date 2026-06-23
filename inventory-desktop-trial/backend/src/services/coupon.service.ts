import { DiscountType, Prisma } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";

type CouponInput = {
  code?: string;
  name?: string;
  discountType?: DiscountType;
  discountValue?: number;
  startsAt?: string;
  endsAt?: string;
  maxUses?: number;
  isActive?: boolean;
};

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function serialize(coupon: any) {
  return {
    ...coupon,
    discountValue: toNumber(coupon.discountValue),
    usedCount: coupon._count?.redemptions ?? coupon.usedCount ?? 0,
  };
}

export async function listCoupons() {
  const coupons = await prisma.coupon.findMany({
    include: { _count: { select: { redemptions: true } } },
    orderBy: { createdAt: "desc" },
  });
  return coupons.map(serialize);
}

export async function createCoupon(input: Required<Pick<CouponInput, "code" | "name" | "discountType" | "discountValue">> & CouponInput, userId: string) {
  const coupon = await prisma.coupon.create({
    data: {
      code: input.code.toUpperCase(),
      name: input.name,
      discountType: input.discountType,
      discountValue: input.discountValue,
      startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
      endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
      maxUses: input.maxUses,
      isActive: input.isActive ?? true,
      createdBy: userId,
    },
    include: { _count: { select: { redemptions: true } } },
  });
  return serialize(coupon);
}

export async function updateCoupon(id: string, input: CouponInput) {
  const data: Prisma.CouponUpdateInput = {};
  if (input.code !== undefined) data.code = input.code.toUpperCase();
  if (input.name !== undefined) data.name = input.name;
  if (input.discountType !== undefined) data.discountType = input.discountType;
  if (input.discountValue !== undefined) data.discountValue = input.discountValue;
  if (input.startsAt !== undefined) data.startsAt = input.startsAt ? new Date(input.startsAt) : null;
  if (input.endsAt !== undefined) data.endsAt = input.endsAt ? new Date(input.endsAt) : null;
  if (input.maxUses !== undefined) data.maxUses = input.maxUses;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const coupon = await prisma.coupon.update({
    where: { id },
    data,
    include: { _count: { select: { redemptions: true } } },
  });
  return serialize(coupon);
}

export async function previewCoupon(code: string, subtotal: number) {
  const coupon = await prisma.coupon.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: { _count: { select: { redemptions: true } } },
  });
  const now = new Date();
  if (!coupon || !coupon.isActive) throw new AppError("Coupon is not active", 400, "COUPON_INACTIVE");
  if (coupon.startsAt && coupon.startsAt > now) throw new AppError("Coupon has not started yet", 400, "COUPON_NOT_STARTED");
  if (coupon.endsAt && coupon.endsAt < now) throw new AppError("Coupon has expired", 400, "COUPON_EXPIRED");
  if (coupon.maxUses !== null && coupon._count.redemptions >= coupon.maxUses) {
    throw new AppError("Coupon usage limit reached", 400, "COUPON_LIMIT_REACHED");
  }

  const discount =
    coupon.discountType === "PERCENT"
      ? subtotal * (toNumber(coupon.discountValue) / 100)
      : toNumber(coupon.discountValue);

  return {
    coupon: serialize(coupon),
    discount: Math.min(subtotal, Math.max(0, discount)),
  };
}
