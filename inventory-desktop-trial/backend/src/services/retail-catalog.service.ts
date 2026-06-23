import { DiscountType, Unit } from "@prisma/client";
import { randomBytes } from "crypto";
import prisma, { ensureConnected } from "../config/database";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
import { createInvoice } from "./invoice.service";
import { getSettings } from "./settings.service";
import { sendWhatsAppImage, sendWhatsAppText } from "./whatsapp.service";

// Fixed identity for the auto-generated wholesale customer that owns all
// retail-catalog sales. The real buyer's details go in the invoice notes.
const RETAIL_CUSTOMER_NAME = "زبون كتلوك المفرد";
const RETAIL_CUSTOMER_PHONE = "000000000000";

type ProductStock = {
  openingBalancePcs: number;
  cartonsAvailable: number;
  pcsPerCarton: number;
};

type RetailOrderItemInput = {
  retailItemId: string;
  quantity: number;
};

type SubmitRetailOrderInput = {
  customerName: string;
  phone: string;
  address?: string;
  notes?: string;
  couponCode?: string;
  referralCode?: string;
  warehouseId?: string;
  items: RetailOrderItemInput[];
  isSubscriber?: boolean;
  interests?: string[];
  wishNote?: string;
};

function toNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function stockOf(product: ProductStock) {
  return product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton;
}

// #4 Stock reservation (no extra table): every open retail order (PENDING or
// PROCESSING) reserves its quantities, so the same pieces can't be promised to
// two customers. Cancelling an order auto-releases its hold (it stops being
// counted), and preparing it deducts real stock via the invoice. Returns a map
// of productId -> reserved pieces.
async function getReservedByProduct(): Promise<Map<string, number>> {
  const openOrders = await prisma.retailOrder.findMany({
    where: { status: { in: ["PENDING", "PROCESSING"] } },
    select: { items: true },
  });
  const reserved = new Map<string, number>();
  for (const o of openOrders) {
    const items = (o.items as unknown as Array<{ productId: string; quantity: number }>) ?? [];
    for (const it of items) {
      if (!it?.productId) continue;
      reserved.set(it.productId, (reserved.get(it.productId) ?? 0) + Number(it.quantity ?? 0));
    }
  }
  return reserved;
}

function normalizePhone(input: string) {
  let digits = String(input ?? "").replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("964")) return digits;
  if (digits.startsWith("0")) return `964${digits.slice(1)}`;
  if (digits.startsWith("7")) return `964${digits}`;
  return digits;
}

function money(value: number) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function preparationPhones(settings: Awaited<ReturnType<typeof getSettings>> | null) {
  const raw = settings?.orderPreparationWhatsappNumbers ?? "";
  return raw
    .split(/[\n,،;]+/)
    .map((phone) => phone.trim())
    .filter(Boolean);
}

function adminPhone(settings: Awaited<ReturnType<typeof getSettings>> | null) {
  return settings?.catalogAdminWhatsappNumber?.trim() || settings?.backupWhatsappNumber?.trim() || "";
}

async function safeSendWA(phone: string, message: string) {
  if (!phone) return;
  try {
    await sendWhatsAppText(normalizePhone(phone), message);
    logger.info(`[RetailWA] Sent to ${phone}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[RetailWA] Send failed to ${phone}: ${msg}`);
  }
}

// ── Admin: catalog items ──────────────────────────────────────────────────────

function serializeItem(item: any) {
  const product = item.product;
  const stock = product ? stockOf(product) : 0;
  return {
    id: item.id,
    productId: item.productId,
    productName: product?.name ?? "",
    itemNumber: product?.itemNumber ?? "",
    title: item.title ?? null,
    description: item.description ?? null,
    price: toNumber(item.price),
    oldPrice: item.oldPrice != null ? toNumber(item.oldPrice) : null,
    categories: item.categories ?? [],
    subCategories: item.subCategories ?? [],
    images: Array.isArray(item.images) ? item.images : [],
    sortOrder: item.sortOrder,
    featured: item.featured,
    isBestSeller: item.isBestSeller,
    isNew: item.isNew,
    isOffer: item.isOffer,
    lowStockBadge: item.lowStockBadge,
    isActive: item.isActive,
    currentStock: stock,
    createdAt: item.createdAt,
  };
}

export async function listRetailItems() {
  const items = await prisma.retailCatalogItem.findMany({
    include: {
      product: {
        select: { name: true, itemNumber: true, openingBalancePcs: true, cartonsAvailable: true, pcsPerCarton: true },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return items.map(serializeItem);
}

type RetailItemFields = {
  title?: string;
  description?: string;
  price?: number;
  oldPrice?: number | null;
  category?: string | null;
  subCategory?: string | null;
  categories?: string[];
  subCategories?: string[];
  images?: string[];
  sortOrder?: number;
  featured?: boolean;
  isBestSeller?: boolean;
  isNew?: boolean;
  isOffer?: boolean;
  lowStockBadge?: boolean;
  isActive?: boolean;
};

function normalizeLabels(values: Array<string | null | undefined>) {
  return values.map((s) => String(s ?? "").trim()).filter(Boolean);
}

function retailCategories(input: RetailItemFields) {
  return normalizeLabels(input.categories ?? (input.category ? [input.category] : []));
}

function retailSubCategories(input: RetailItemFields) {
  return normalizeLabels(input.subCategories ?? (input.subCategory ? [input.subCategory] : []));
}

const itemInclude = {
  product: {
    select: { name: true, itemNumber: true, openingBalancePcs: true, cartonsAvailable: true, pcsPerCarton: true },
  },
} as const;

export async function createRetailItem(input: RetailItemFields & { productId: string; price: number }) {
  const product = await prisma.product.findFirst({ where: { id: input.productId, deletedAt: null } });
  if (!product) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");

  const item = await prisma.retailCatalogItem.create({
    data: {
      productId: input.productId,
      title: input.title?.trim() || null,
      description: input.description?.trim() || null,
      price: input.price,
      oldPrice: input.oldPrice ?? null,
      categories: retailCategories(input),
      subCategories: retailSubCategories(input),
      images: (input.images ?? []) as unknown as object,
      sortOrder: input.sortOrder ?? 0,
      featured: input.featured ?? false,
      isBestSeller: input.isBestSeller ?? false,
      isNew: input.isNew ?? false,
      isOffer: input.isOffer ?? false,
      lowStockBadge: input.lowStockBadge ?? false,
      isActive: input.isActive ?? true,
    },
    include: itemInclude,
  });
  return serializeItem(item);
}

export async function updateRetailItem(id: string, patch: RetailItemFields) {
  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = patch.title?.trim() || null;
  if (patch.description !== undefined) data.description = patch.description?.trim() || null;
  if (patch.price !== undefined) data.price = patch.price;
  if (patch.oldPrice !== undefined) data.oldPrice = patch.oldPrice;
  if (patch.categories !== undefined || patch.category !== undefined) data.categories = retailCategories(patch);
  if (patch.subCategories !== undefined || patch.subCategory !== undefined) data.subCategories = retailSubCategories(patch);
  if (patch.images !== undefined) data.images = patch.images as unknown as object;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
  if (patch.featured !== undefined) data.featured = patch.featured;
  if (patch.isBestSeller !== undefined) data.isBestSeller = patch.isBestSeller;
  if (patch.isNew !== undefined) data.isNew = patch.isNew;
  if (patch.isOffer !== undefined) data.isOffer = patch.isOffer;
  if (patch.lowStockBadge !== undefined) data.lowStockBadge = patch.lowStockBadge;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;

  const item = await prisma.retailCatalogItem.update({
    where: { id },
    data,
    include: itemInclude,
  });
  return serializeItem(item);
}

// ── Admin: categories ─────────────────────────────────────────────────────────

export async function listRetailCategories() {
  return prisma.retailCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function createRetailCategory(input: { name: string; subCategories?: string[]; sortOrder?: number }) {
  return prisma.retailCategory.create({
    data: {
      name: input.name.trim(),
      subCategories: (input.subCategories ?? []).map((s) => s.trim()).filter(Boolean),
      sortOrder: input.sortOrder ?? 0,
    },
  });
}

export async function updateRetailCategory(id: string, patch: { name?: string; subCategories?: string[]; sortOrder?: number }) {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.subCategories !== undefined) data.subCategories = patch.subCategories.map((s) => s.trim()).filter(Boolean);
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
  return prisma.retailCategory.update({ where: { id }, data });
}

export async function deleteRetailCategory(id: string) {
  await prisma.retailCategory.delete({ where: { id } });
  return { id };
}

export async function deleteRetailItem(id: string) {
  await prisma.retailCatalogItem.delete({ where: { id } });
  return { id };
}

// ── Admin: coupons ────────────────────────────────────────────────────────────

function serializeCoupon(coupon: any) {
  return {
    ...coupon,
    discountValue: toNumber(coupon.discountValue),
  };
}

export async function listRetailCoupons() {
  const coupons = await prisma.retailCoupon.findMany({ orderBy: { createdAt: "desc" } });
  return coupons.map(serializeCoupon);
}

export async function createRetailCoupon(input: {
  code: string;
  name: string;
  discountType: DiscountType;
  discountValue: number;
  startsAt?: string;
  endsAt?: string;
  maxUses?: number;
  isActive?: boolean;
}) {
  const coupon = await prisma.retailCoupon.create({
    data: {
      code: input.code.trim().toUpperCase(),
      name: input.name,
      discountType: input.discountType,
      discountValue: input.discountValue,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      maxUses: input.maxUses ?? null,
      isActive: input.isActive ?? true,
    },
  });
  return serializeCoupon(coupon);
}

export async function updateRetailCoupon(
  id: string,
  patch: {
    code?: string;
    name?: string;
    discountType?: DiscountType;
    discountValue?: number;
    startsAt?: string | null;
    endsAt?: string | null;
    maxUses?: number | null;
    isActive?: boolean;
  },
) {
  const data: Record<string, unknown> = {};
  if (patch.code !== undefined) data.code = patch.code.trim().toUpperCase();
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.discountType !== undefined) data.discountType = patch.discountType;
  if (patch.discountValue !== undefined) data.discountValue = patch.discountValue;
  if (patch.startsAt !== undefined) data.startsAt = patch.startsAt ? new Date(patch.startsAt) : null;
  if (patch.endsAt !== undefined) data.endsAt = patch.endsAt ? new Date(patch.endsAt) : null;
  if (patch.maxUses !== undefined) data.maxUses = patch.maxUses;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;

  const coupon = await prisma.retailCoupon.update({ where: { id }, data });
  return serializeCoupon(coupon);
}

export async function deleteRetailCoupon(id: string) {
  await prisma.retailCoupon.delete({ where: { id } });
  return { id };
}

// ── Public: storefront ────────────────────────────────────────────────────────

export async function listPublicRetailItems() {
  const items = await prisma.retailCatalogItem.findMany({
    where: { isActive: true },
    include: {
      product: {
        select: { name: true, openingBalancePcs: true, cartonsAvailable: true, pcsPerCarton: true },
      },
    },
    orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
  });

  return items
    .map((item) => {
      const physical = item.product ? stockOf(item.product) : 0;
      return {
        id: item.id,
        title: item.title || item.product?.name || "",
        description: item.description ?? null,
        price: toNumber(item.price),
        oldPrice: item.oldPrice != null ? toNumber(item.oldPrice) : null,
        categories: item.categories ?? [],
        subCategories: item.subCategories ?? [],
        images: Array.isArray(item.images) ? (item.images as string[]) : [],
        featured: item.featured,
        isBestSeller: item.isBestSeller,
        isNew: item.isNew,
        isOffer: item.isOffer,
        lowStockBadge: item.lowStockBadge,
        currentStock: physical,
      };
    })
    .filter((item) => item.currentStock > 0);
}

export async function listPublicRetailCategories() {
  const categories = await prisma.retailCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return categories.map((c) => ({ name: c.name, subCategories: c.subCategories }));
}

function couponIsValidNow(coupon: { isActive: boolean; startsAt: Date | null; endsAt: Date | null; maxUses: number | null; usedCount: number }) {
  const now = new Date();
  if (!coupon.isActive) return false;
  if (coupon.startsAt && coupon.startsAt > now) return false;
  if (coupon.endsAt && coupon.endsAt < now) return false;
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) return false;
  return true;
}

export async function getActiveRetailCoupon() {
  const coupons = await prisma.retailCoupon.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });
  const valid = coupons.find(couponIsValidNow);
  if (!valid) return null;
  return {
    code: valid.code,
    name: valid.name,
    discountType: valid.discountType,
    discountValue: toNumber(valid.discountValue),
    endsAt: valid.endsAt,
  };
}

async function resolveCoupon(code: string | undefined, subtotal: number) {
  if (!code) return { discount: 0, coupon: null as null | { id: string; code: string } };
  const coupon = await prisma.retailCoupon.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!coupon || !couponIsValidNow(coupon)) {
    throw new AppError("الكوبون غير صالح أو منتهي", 400, "RETAIL_COUPON_INVALID");
  }
  const raw =
    coupon.discountType === "PERCENT"
      ? subtotal * (toNumber(coupon.discountValue) / 100)
      : toNumber(coupon.discountValue);
  const discount = Math.min(subtotal, Math.max(0, raw));
  return { discount, coupon: { id: coupon.id, code: coupon.code } };
}

export async function previewRetailCoupon(code: string, subtotal: number) {
  const { discount, coupon } = await resolveCoupon(code, subtotal);
  return { discount, code: coupon?.code ?? code.trim().toUpperCase() };
}

// ── Referral helpers ──────────────────────────────────────────────────────────

const REFERRAL_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateReferralCode(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes).map((b) => REFERRAL_CHARS[b % REFERRAL_CHARS.length]).join("");
}

// Long unguessable token for the private "my orders" link (#5).
async function uniqueOrdersToken(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const candidate = randomBytes(24).toString("base64url");
    const conflict = await prisma.retailCustomer.findUnique({ where: { ordersToken: candidate } });
    if (!conflict) return candidate;
  }
  return randomBytes(24).toString("base64url");
}

export async function getReferralInfo(code: string) {
  const clean = code.trim().toUpperCase();
  const customer = await prisma.retailCustomer.findUnique({
    where: { referralCode: clean },
    select: { id: true, name: true, referralCode: true },
  });
  if (!customer || !customer.referralCode) throw new AppError("كود الإحالة غير صالح", 400, "REFERRAL_INVALID");
  const pct = await getReferralDiscountPercent();
  return { code: customer.referralCode, referrerName: customer.name, discountPercent: pct };
}

async function getReferralDiscountPercent(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: "retailReferralDiscountPercent" } });
  return Math.min(100, Math.max(0, Number(row?.value ?? 10)));
}

export async function getRetailReferralSettings() {
  const pct = await getReferralDiscountPercent();
  return { discountPercent: pct };
}

export async function setRetailReferralSettings(discountPercent: number) {
  const pct = Math.min(100, Math.max(0, Number(discountPercent)));
  await prisma.setting.upsert({
    where: { key: "retailReferralDiscountPercent" },
    update: { value: pct },
    create: { key: "retailReferralDiscountPercent", value: pct },
  });
  return { discountPercent: pct };
}

async function resolveReferral(code: string | undefined, subtotal: number): Promise<{ discount: number; referralCode: string | null }> {
  if (!code) return { discount: 0, referralCode: null };
  const clean = code.trim().toUpperCase();
  const customer = await prisma.retailCustomer.findUnique({ where: { referralCode: clean }, select: { id: true } });
  if (!customer) return { discount: 0, referralCode: null };
  const pct = await getReferralDiscountPercent();
  const discount = Math.round((subtotal * pct) / 100);
  return { discount, referralCode: clean };
}

async function generateRetailOrderNumber() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const counter = await prisma.counter.upsert({
      where: { key: "retail-order" },
      update: { value: { increment: 1 } },
      create: { key: "retail-order", value: 1 },
    });
    const candidate = `MF-${String(counter.value).padStart(4, "0")}`;
    const exists = await prisma.retailOrder.findUnique({ where: { orderNumber: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  throw new AppError("تعذر توليد رقم الطلب", 409, "RETAIL_ORDER_NUMBER_CONFLICT");
}

export async function submitRetailOrder(input: SubmitRetailOrderInput) {
  if (!input.items.length) throw new AppError("السلة فارغة", 400, "RETAIL_EMPTY_CART");

  const retailItemIds = [...new Set(input.items.map((i) => i.retailItemId))];
  const retailItems = await prisma.retailCatalogItem.findMany({
    where: { id: { in: retailItemIds }, isActive: true },
    include: {
      product: {
        select: { id: true, name: true, openingBalancePcs: true, cartonsAvailable: true, pcsPerCarton: true },
      },
    },
  });
  const byId = new Map(retailItems.map((i) => [i.id, i]));

  // Accumulate requested pieces per product (multiple retail items can map to one product)
  const requestedByProduct = new Map<string, number>();
  const orderItems: Array<{
    retailItemId: string;
    productId: string;
    productName: string;
    title: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }> = [];

  for (const line of input.items) {
    const item = byId.get(line.retailItemId);
    if (!item || !item.product) throw new AppError("المادة غير متوفرة", 404, "RETAIL_ITEM_NOT_FOUND");
    if (line.quantity <= 0) throw new AppError("الكمية غير صحيحة", 400, "RETAIL_BAD_QUANTITY");

    const unitPrice = toNumber(item.price);
    const title = item.title || item.product.name;
    requestedByProduct.set(item.product.id, (requestedByProduct.get(item.product.id) ?? 0) + line.quantity);
    orderItems.push({
      retailItemId: item.id,
      productId: item.product.id,
      productName: item.product.name,
      title,
      quantity: line.quantity,
      unitPrice,
      totalPrice: unitPrice * line.quantity,
    });
  }

  // Validate available stock (physical minus what other open orders reserve).
  const reservedByOthers = await getReservedByProduct();
  for (const item of retailItems) {
    if (!item.product) continue;
    const requested = requestedByProduct.get(item.product.id) ?? 0;
    const available = Math.max(0, stockOf(item.product) - (reservedByOthers.get(item.product.id) ?? 0));
    if (requested > available) {
      throw new AppError(`الكمية المطلوبة من "${item.title || item.product.name}" أكبر من المتوفر`, 400, "RETAIL_STOCK_NOT_ENOUGH");
    }
  }

  const subtotal = orderItems.reduce((sum, i) => sum + i.totalPrice, 0);
  const { discount: couponDiscount, coupon } = await resolveCoupon(input.couponCode, subtotal);
  const { discount: referralDiscount, referralCode: usedReferralCode } = await resolveReferral(input.referralCode, subtotal);
  const discount = couponDiscount; // coupon discount goes to "discount" column
  const total = Math.max(0, subtotal - couponDiscount - referralDiscount);

  const orderNumber = await generateRetailOrderNumber();
  const order = await prisma.retailOrder.create({
    data: {
      orderNumber,
      customerName: input.customerName.trim(),
      phone: normalizePhone(input.phone),
      address: input.address?.trim() || null,
      notes: input.notes?.trim() || null,
      items: orderItems as unknown as object,
      warehouseId: input.warehouseId || null,
      subtotal,
      discount,
      referralDiscount,
      total,
      couponCode: coupon?.code ?? null,
      referralCode: usedReferralCode,
    },
  });

  if (coupon) {
    await prisma.retailCoupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } }).catch(() => {});
  }

  // Build/refresh the customer record (interests = main categories of ordered
  // items + any the customer explicitly picked).
  const autoInterests = [...new Set(retailItems.flatMap((i) => (Array.isArray(i.categories) ? (i.categories as string[]) : [])))];
  const explicitInterests = (input.interests ?? []).map((s) => s.trim()).filter(Boolean);
  const upsertResult = await upsertRetailCustomer({
    phone: normalizePhone(input.phone),
    name: input.customerName.trim(),
    interests: [...new Set([...autoInterests, ...explicitInterests])],
    isSubscriber: input.isSubscriber ?? false,
    wishNote: input.wishNote?.trim() || undefined,
    referredBy: usedReferralCode ?? undefined,
  }).catch((err) => {
    logger.error(`[RetailCustomer] upsert failed: ${err}`);
    return null;
  });

  // Fire-and-forget notifications
  setImmediate(() => {
    notifyRetailOrderSubmitted(order.orderNumber, input.customerName.trim(), normalizePhone(input.phone), input.address, input.notes, orderItems, total)
      .catch((err) => logger.error(`[RetailOrder] notify failed: ${err}`));
  });

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    subtotal,
    discount,
    referralDiscount,
    total,
    // Private token so the customer can revisit their orders without exposing
    // them to anyone who knows the phone number (#5).
    ordersToken: upsertResult?.ordersToken ?? null,
  };
}

async function notifyRetailOrderSubmitted(
  orderNumber: string,
  customerName: string,
  customerPhone: string,
  address: string | undefined,
  notes: string | undefined,
  items: Array<{ title: string; quantity: number; unitPrice: number }>,
  total: number,
) {
  const settings = await getSettings().catch(() => null);
  const currency = settings?.currency ?? "د.ع";

  // Customer confirmation
  await safeSendWA(
    customerPhone,
    `مرحباً ${customerName} 🌹\nتم تثبيت طلبك رقم ${orderNumber} بنجاح.\nسوف يتم التجهيز بكل حب وإرساله إليك بأسرع وقت. شكراً لك ❤️`,
  );

  // Staff (preparation) numbers + admin
  const lines = items.map((i) => `- ${i.title}: ${i.quantity} قطعة × ${money(i.unitPrice)}`).join("\n");
  const staffMsg = [
    `🛍️ طلب جديد من كتلوك المفرد رقم ${orderNumber}`,
    "",
    `الزبون: ${customerName}`,
    `الهاتف: ${customerPhone}`,
    address ? `العنوان: ${address}` : "",
    notes ? `ملاحظات: ${notes}` : "",
    "",
    "المواد المطلوبة:",
    lines,
    "",
    `الإجمالي: ${money(total)} ${currency}`,
    "",
    "يرجى تجهيز الطلب ثم الضغط على (تم التجهيز) في صفحة كتلوك المفرد.",
  ].filter(Boolean).join("\n");

  const phones = preparationPhones(settings);
  const admin = adminPhone(settings);
  const targets = new Set<string>([...phones, admin].filter(Boolean));
  await Promise.all([...targets].map((phone) => safeSendWA(phone, staffMsg)));

  await prisma.notification.create({
    data: {
      type: "RETAIL_ORDER_PENDING",
      message: `طلب مفرد جديد ${orderNumber} من ${customerName} - ${items.length} صنف`,
    },
  }).catch(() => {});
}

// ── Admin: orders ─────────────────────────────────────────────────────────────

function serializeOrder(order: any) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    phone: order.phone,
    address: order.address ?? null,
    notes: order.notes ?? null,
    items: order.items ?? [],
    subtotal: toNumber(order.subtotal),
    discount: toNumber(order.discount),
    total: toNumber(order.total),
    couponCode: order.couponCode ?? null,
    status: order.status,
    invoiceId: order.invoiceId ?? null,
    preparedAt: order.preparedAt ?? null,
    createdAt: order.createdAt,
  };
}

export async function listRetailOrders(status?: string) {
  // The "PENDING" tab also surfaces orders that are mid-processing or failed,
  // so staff can see and retry them instead of having them vanish.
  const where =
    status === "PENDING"
      ? { status: { in: ["PENDING", "PROCESSING", "FAILED"] } }
      : status
        ? { status }
        : undefined;
  const orders = await prisma.retailOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return orders.map(serializeOrder);
}

export async function getRetailOrderPublic(id: string) {
  const order = await prisma.retailOrder.findUnique({ where: { id } });
  if (!order) throw new AppError("الطلب غير موجود", 404, "RETAIL_ORDER_NOT_FOUND");
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    total: toNumber(order.total),
    createdAt: order.createdAt,
    preparedAt: order.preparedAt ?? null,
  };
}

function serializeOwnOrder(order: {
  id: string; orderNumber: string; status: string; total: unknown;
  createdAt: Date; preparedAt: Date | null; items: unknown;
}) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    total: toNumber(order.total),
    createdAt: order.createdAt,
    preparedAt: order.preparedAt ?? null,
    items: order.items ?? [],
  };
}

// Public: a customer looks up their own orders by phone (no login).
export async function getRetailOrdersByPhone(phone: string) {
  const normalized = normalizePhone(phone);
  const orders = await prisma.retailOrder.findMany({
    where: { phone: normalized },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return orders.map(serializeOwnOrder);
}

// Public: a customer views their own orders via their private secret token (#5).
// Unguessable, so it doesn't expose orders to anyone who knows the phone number.
export async function getRetailOrdersByToken(token: string) {
  const trimmed = token?.trim();
  if (!trimmed) return null;
  const customer = await prisma.retailCustomer.findUnique({ where: { ordersToken: trimmed } });
  if (!customer) return null;
  const orders = await prisma.retailOrder.findMany({
    where: { phone: customer.phone },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return { name: customer.name, orders: orders.map(serializeOwnOrder) };
}

// ── Customers (subscriber database) ───────────────────────────────────────────

async function upsertRetailCustomer(input: {
  phone: string;
  name: string;
  interests: string[];
  isSubscriber: boolean;
  wishNote?: string;
  referredBy?: string;
}) {
  const existing = await prisma.retailCustomer.findUnique({ where: { phone: input.phone } });
  if (existing) {
    const merged = [...new Set([...(Array.isArray(existing.interests) ? (existing.interests as string[]) : []), ...input.interests])];
    // Generate a referral code for existing customers who don't have one yet
    let newReferralCode: string | undefined;
    if (!existing.referralCode) {
      for (let i = 0; i < 10; i++) {
        const candidate = generateReferralCode();
        const conflict = await prisma.retailCustomer.findUnique({ where: { referralCode: candidate } });
        if (!conflict) { newReferralCode = candidate; break; }
      }
    }
    const ordersToken = existing.ordersToken ?? (await uniqueOrdersToken());
    await prisma.retailCustomer.update({
      where: { phone: input.phone },
      data: {
        name: input.name || existing.name,
        interests: merged,
        isSubscriber: existing.isSubscriber || input.isSubscriber,
        wishNote: input.wishNote ?? existing.wishNote,
        ordersCount: { increment: 1 },
        lastOrderAt: new Date(),
        ...(newReferralCode ? { referralCode: newReferralCode } : {}),
        ...(existing.ordersToken ? {} : { ordersToken }),
      },
    });
    return { ordersToken };
  } else {
    // Generate a unique referral code for new customers (retry on collision)
    let referralCode: string | null = null;
    for (let i = 0; i < 10; i++) {
      const candidate = generateReferralCode();
      const conflict = await prisma.retailCustomer.findUnique({ where: { referralCode: candidate } });
      if (!conflict) { referralCode = candidate; break; }
    }
    const ordersToken = await uniqueOrdersToken();
    await prisma.retailCustomer.create({
      data: {
        phone: input.phone,
        name: input.name,
        interests: input.interests,
        isSubscriber: input.isSubscriber,
        wishNote: input.wishNote ?? null,
        ordersCount: 1,
        lastOrderAt: new Date(),
        referralCode,
        referredBy: input.referredBy ?? null,
        ordersToken,
      },
    });
    return { ordersToken };
  }
}

export async function getRetailCustomerReferral(phone: string) {
  const normalized = normalizePhone(phone);
  let customer = await prisma.retailCustomer.findUnique({
    where: { phone: normalized },
    select: { referralCode: true, ordersCount: true },
  });
  if (!customer) return null;
  // Generate a code on-the-fly for existing customers who don't have one
  if (!customer.referralCode) {
    let code: string | null = null;
    for (let i = 0; i < 10; i++) {
      const candidate = generateReferralCode();
      const conflict = await prisma.retailCustomer.findUnique({ where: { referralCode: candidate } });
      if (!conflict) { code = candidate; break; }
    }
    if (code) {
      await prisma.retailCustomer.update({ where: { phone: normalized }, data: { referralCode: code } });
      customer = { referralCode: code, ordersCount: customer.ordersCount };
    }
  }
  if (!customer.referralCode) return null;
  const pct = await getReferralDiscountPercent();
  return { referralCode: customer.referralCode, discountPercent: pct };
}

export async function listRetailCustomers(filter?: { category?: string; categories?: string[]; subscribersOnly?: boolean }) {
  const where: Record<string, unknown> = {};
  if (filter?.subscribersOnly) where.isSubscriber = true;
  // categories[] (any-of match) takes precedence — used when targeting an item's
  // categories; falls back to a single category for the manual filter.
  // SQLite: hasSome/has not supported on Json fields — filter in JS
  const allRetailCustomers = await prisma.retailCustomer.findMany({
    where,
    orderBy: [{ isSubscriber: "desc" }, { lastOrderAt: "desc" }],
    take: 1000,
  });
  const filterCategories = filter?.categories?.length ? filter.categories : filter?.category ? [filter.category] : null;
  const customers = filterCategories
    ? allRetailCustomers.filter((c) => {
        const interests = Array.isArray(c.interests) ? (c.interests as string[]) : [];
        return filterCategories.some((cat) => interests.includes(cat));
      })
    : allRetailCustomers;
  return customers.map((c) => ({
    id: c.id,
    phone: c.phone,
    name: c.name,
    isSubscriber: c.isSubscriber,
    interests: c.interests,
    wishNote: c.wishNote ?? null,
    ordersCount: c.ordersCount,
    lastOrderAt: c.lastOrderAt,
  }));
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

export async function broadcastToRetailCustomers(input: {
  message: string;
  images?: string[];
  category?: string;
  categories?: string[];
  subscribersOnly?: boolean;
}) {
  const customers = await listRetailCustomers({ category: input.category, categories: input.categories, subscribersOnly: input.subscribersOnly });
  if (customers.length === 0) return { sent: 0, failed: 0, total: 0 };

  const settings = await getSettings().catch(() => null);
  const shopUrl = (settings?.catalogPublicUrl?.replace(/\/catalog.*$/, "") || "").replace(/\/$/, "");
  const link = shopUrl ? `${shopUrl}/shop` : "";
  const caption = link ? `${input.message}\n\n🛍️ تسوّق الآن: ${link}` : input.message;

  const images = (input.images ?? [])
    .map(dataUrlToBuffer)
    .filter((x): x is { buffer: Buffer; mime: string } => x !== null)
    .slice(0, 3);

  let sent = 0;
  let failed = 0;
  // Sequential with a small delay to reduce ban risk.
  for (const customer of customers) {
    try {
      if (images.length > 0) {
        for (let idx = 0; idx < images.length; idx++) {
          // Only the first image carries the caption.
          await sendWhatsAppImage(customer.phone, idx === 0 ? caption : "", images[idx].buffer, images[idx].mime);
          await new Promise((r) => setTimeout(r, 400));
        }
      } else {
        await sendWhatsAppText(customer.phone, caption);
      }
      sent++;
    } catch (err) {
      failed++;
      logger.warn(`[RetailBroadcast] failed to ${customer.phone}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return { sent, failed, total: customers.length };
}

async function getOrCreateRetailCustomer() {
  const existing = await prisma.customer.findFirst({ where: { name: RETAIL_CUSTOMER_NAME } });
  if (existing) return existing;
  return prisma.customer.create({
    data: {
      name: RETAIL_CUSTOMER_NAME,
      phone: RETAIL_CUSTOMER_PHONE,
      openingBalance: 0,
      currentBalance: 0,
    },
  });
}

type RetailOrderRow = NonNullable<Awaited<ReturnType<typeof prisma.retailOrder.findUnique>>>;

// Creates the SALE invoice (which deducts stock atomically inside its own
// transaction) and links it to the order. Persists invoiceId IMMEDIATELY after
// the invoice exists so a retry can never create a second invoice. Throws on
// failure so the caller can roll the order back to PENDING.
async function createRetailInvoice(order: RetailOrderRow, userId: string): Promise<void> {
  if (order.invoiceId) return; // already invoiced — idempotent

  const items = (order.items as unknown as Array<{ productId: string; quantity: number; unitPrice: number }>) ?? [];
  const customer = await getOrCreateRetailCustomer();
  logger.info(`[RetailPrepare] creating invoice for order ${order.orderNumber}`);

  const invoice = await createInvoice(
    {
      customerId: customer.id,
      type: "SALE",
      discount: toNumber(order.discount),
      tax: 0,
      paidAmount: toNumber(order.total),
      paymentType: "CASH",
      items: items.map((i) => ({
        productId: i.productId,
        unit: Unit.PIECE,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
    },
    userId,
  );

  // Link the invoice to the order first — protects against a second invoice on retry.
  await prisma.retailOrder.update({ where: { id: order.id }, data: { invoiceId: invoice.id } });

  const noteParts = [
    `طلب كتلوك المفرد ${order.orderNumber}`,
    `الزبون: ${order.customerName}`,
    `الهاتف: ${order.phone}`,
    order.address ? `العنوان: ${order.address}` : "",
    order.notes ? `ملاحظات: ${order.notes}` : "",
  ].filter(Boolean);
  await prisma.invoice.update({ where: { id: invoice.id }, data: { notes: noteParts.join("\n") } }).catch(() => {});
  logger.info(`[RetailPrepare] invoice ${invoice.invoiceNumber} created for order ${order.orderNumber}`);
}

export async function markRetailOrderPrepared(orderId: string, userId: string) {
  logger.info(`[RetailPrepare] start order=${orderId}`);
  await ensureConnected().catch(() => {});

  // ── Atomic claim: only one caller can move PENDING → PROCESSING. This is the
  // idempotency guard — repeated clicks / parallel requests cannot both proceed,
  // so we never create two invoices or deduct stock twice.
  const claim = await prisma.retailOrder.updateMany({
    where: { id: orderId, status: { in: ["PENDING", "FAILED"] } },
    data: { status: "PROCESSING" },
  });

  if (claim.count !== 1) {
    const existing = await prisma.retailOrder.findUnique({ where: { id: orderId } });
    if (!existing) throw new AppError("الطلب غير موجود", 404, "RETAIL_ORDER_NOT_FOUND");
    if (existing.status === "PROCESSING") throw new AppError("الطلب قيد المعالجة حالياً، انتظر لحظة", 409, "RETAIL_ORDER_PROCESSING");
    if (existing.status === "PREPARED") throw new AppError("الطلب مجهز مسبقاً", 400, "RETAIL_ALREADY_PREPARED");
    if (existing.status === "CANCELLED") throw new AppError("الطلب ملغي", 400, "RETAIL_ORDER_CANCELLED");
    throw new AppError("تعذّر تجهيز الطلب بهذه الحالة", 400, "RETAIL_ORDER_BAD_STATE");
  }

  try {
    const order = await prisma.retailOrder.findUniqueOrThrow({ where: { id: orderId } });

    // Create the invoice + deduct stock synchronously. Throws on insufficient
    // stock (prevents overselling) or any failure.
    await createRetailInvoice(order, userId);

    const finalized = await prisma.retailOrder.update({
      where: { id: orderId },
      data: { status: "PREPARED", preparedAt: new Date(), preparedById: userId },
    });
    logger.info(`[RetailPrepare] order ${order.orderNumber} prepared + invoiced`);

    // Notify the customer only after the invoice + stock deduction succeeded.
    setImmediate(() => {
      safeSendWA(order.phone, `طلبك رقم ${order.orderNumber} تم تجهيزه وهو في طريقه إليك 🚗💨\nشكراً لثقتك بنا ❤️`).catch(() => {});
    });

    return { id: finalized.id, orderNumber: finalized.orderNumber };
  } catch (err) {
    // If the invoice was actually created (failure happened after), finalize as
    // PREPARED so we don't lose the linkage. Otherwise roll back to FAILED so the
    // order can be retried without leaving it stuck in PROCESSING.
    const after = await prisma.retailOrder.findUnique({ where: { id: orderId } }).catch(() => null);
    if (after?.invoiceId) {
      await prisma.retailOrder.update({
        where: { id: orderId },
        data: { status: "PREPARED", preparedAt: new Date(), preparedById: userId },
      }).catch(() => {});
      setImmediate(() => {
        safeSendWA(after.phone, `طلبك رقم ${after.orderNumber} تم تجهيزه وهو في طريقه إليك 🚗💨\nشكراً لثقتك بنا ❤️`).catch(() => {});
      });
      return { id: after.id, orderNumber: after.orderNumber };
    }
    await prisma.retailOrder.updateMany({
      where: { id: orderId, status: "PROCESSING" },
      data: { status: "FAILED" },
    }).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[RetailPrepare] failed order=${orderId}: ${msg}`);
    if (err instanceof AppError) throw err;
    throw new AppError("تعذّر إنشاء الفاتورة وخصم المخزون. أُعيد الطلب لحالة الانتظار، حاول مرة أخرى.", 500, "RETAIL_INVOICE_FAILED");
  }
}

export async function cancelRetailOrder(orderId: string) {
  const order = await prisma.retailOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError("الطلب غير موجود", 404, "RETAIL_ORDER_NOT_FOUND");
  if (order.status === "PREPARED") throw new AppError("لا يمكن إلغاء طلب مجهز", 400, "RETAIL_ALREADY_PREPARED");
  if (order.status === "PROCESSING") throw new AppError("الطلب قيد المعالجة، لا يمكن إلغاؤه الآن", 409, "RETAIL_ORDER_PROCESSING");
  if (order.status === "CANCELLED") return { id: order.id }; // idempotent

  await prisma.$transaction(async (tx) => {
    await tx.retailOrder.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
    // Release the coupon use reserved at submit time so a cancelled order does
    // not permanently consume a coupon (floor the counter at 0).
    if (order.couponCode) {
      await tx.retailCoupon.updateMany({
        where: { code: order.couponCode, usedCount: { gt: 0 } },
        data: { usedCount: { decrement: 1 } },
      });
    }
  });
  return { id: order.id };
}
