/**
 * «عروض خاصة بالزبون» — the owner's screen for standing customer prices.
 *
 * Writes need `MANAGE_CUSTOMER_OFFERS` (an ADMIN passes by role, as everywhere
 * else). A rep reaching these endpoints is confined to their own customers by
 * `salesAgentScopeFor`, whether they are reading or writing, so the explicit
 * permission grants the ACTION and never widens whose customers it applies to.
 *
 * Dates arrive as the day the owner picked (`YYYY-MM-DD`) and are turned into
 * instants in the SHOP's timezone here — see `utils/shop-day.ts` for why that
 * matters. A full ISO timestamp is still accepted so an older client keeps
 * working.
 */
import { DiscountType } from "@prisma/client";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import { salesAgentScopeFor } from "../middleware/permission.middleware";
import {
  createCustomerOffer,
  listCustomerOffers,
  setCustomerOfferActive,
  updateCustomerOffer,
} from "../services/sales-agent-offers.service";
import { AgentPriceMode } from "../utils/sales-agent-pricing";
import { isShopDateKey, shopDayEndExclusive, shopDayStart } from "../utils/shop-day";

function actorOf(reqUser: Express.User | undefined) {
  if (!reqUser) throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  return { id: reqUser.id, name: reqUser.name ?? undefined };
}

/** The first instant of the picked start day, shop time. */
function parseStart(value: unknown): Date {
  if (isShopDateKey(value)) return shopDayStart(String(value).trim());
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) {
    throw new AppError("تاريخ البداية غير صحيح", 400, "OFFER_DATE_INVALID");
  }
  return date;
}

/**
 * The EXCLUSIVE end: the picked end day is included in full, so the stored
 * instant is the start of the following day, shop time.
 */
function parseEndExclusive(value: unknown): Date {
  if (isShopDateKey(value)) return shopDayEndExclusive(String(value).trim());
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) {
    throw new AppError("تاريخ النهاية غير صحيح", 400, "OFFER_DATE_INVALID");
  }
  return date;
}

function parseDiscountType(value: unknown): DiscountType {
  if (value === DiscountType.PERCENT || value === DiscountType.AMOUNT) return value;
  throw new AppError("نوع الخصم لازم يكون نسبة أو سعر ثابت", 400, "OFFER_DISCOUNT_TYPE_INVALID");
}

function parseMode(value: unknown): AgentPriceMode {
  if (value === "CARTON") return "CARTON";
  if (value === "WHOLESALE" || value == null) return "WHOLESALE";
  throw new AppError("نوع السعر لازم يكون جملة أو توزيع كراتين", 400, "OFFER_PRICE_MODE_INVALID");
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const getCustomerOffersList = asyncHandler(async (req, res) => {
  actorOf(req.user);
  const page = Number(req.query.page);
  const limit = Number(req.query.limit);
  res.json({
    success: true,
    data: await listCustomerOffers({
      agentScope: salesAgentScopeFor(req.user),
      customerId: typeof req.query.customerId === "string" && req.query.customerId ? req.query.customerId : undefined,
      productId: typeof req.query.productId === "string" && req.query.productId ? req.query.productId : undefined,
      liveOnly: String(req.query.liveOnly) === "true",
      page: Number.isFinite(page) ? page : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    }),
  });
});

export const postCustomerOffer = asyncHandler(async (req, res) => {
  const actor = actorOf(req.user);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const created = await createCustomerOffer(actor, salesAgentScopeFor(req.user), {
    customerId: String(body.customerId ?? ""),
    productId: String(body.productId ?? ""),
    unit: body.unit as never,
    priceMode: parseMode(body.priceMode),
    discountType: parseDiscountType(body.discountType),
    fixedPrice: numberOrNull(body.fixedPrice),
    discountPercent: numberOrNull(body.discountPercent),
    startsAt: parseStart(body.startsAt),
    endsAt: parseEndExclusive(body.endsAt),
    isActive: body.isActive == null ? true : Boolean(body.isActive),
    note: body.note == null ? null : String(body.note),
    // A fixed price above the shelf price is allowed — some agreements really
    // are dearer — but only when the owner said so deliberately.
    confirmAboveCatalog: body.confirmAboveCatalog === true,
  });
  res.status(201).json({ success: true, message: "تم إنشاء العرض", data: created });
});

export const putCustomerOffer = asyncHandler(async (req, res) => {
  const actor = actorOf(req.user);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const updated = await updateCustomerOffer(actor, salesAgentScopeFor(req.user), String(req.params.id), {
    // Target customer/product/unit/mode are ignored by the service — moving an
    // offer to a different customer would rewrite whose price it was.
    customerId: "",
    productId: "",
    unit: "PIECE" as never,
    priceMode: "WHOLESALE",
    discountType: parseDiscountType(body.discountType),
    fixedPrice: numberOrNull(body.fixedPrice),
    discountPercent: numberOrNull(body.discountPercent),
    startsAt: parseStart(body.startsAt),
    endsAt: parseEndExclusive(body.endsAt),
    isActive: body.isActive == null ? undefined : Boolean(body.isActive),
    note: body.note == null ? null : String(body.note),
    confirmAboveCatalog: body.confirmAboveCatalog === true,
  });
  res.json({ success: true, message: "تم تحديث العرض", data: updated });
});

export const patchCustomerOfferActive = asyncHandler(async (req, res) => {
  const actor = actorOf(req.user);
  const body = (req.body ?? {}) as { isActive?: unknown };
  if (typeof body.isActive !== "boolean") {
    throw new AppError("حدّد تشغيل أو إيقاف", 400, "OFFER_ACTIVE_REQUIRED");
  }
  const updated = await setCustomerOfferActive(
    actor,
    salesAgentScopeFor(req.user),
    String(req.params.id),
    body.isActive,
  );
  res.json({
    success: true,
    message: body.isActive ? "تم تشغيل العرض" : "تم إيقاف العرض",
    data: updated,
  });
});
