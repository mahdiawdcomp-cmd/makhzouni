/**
 * «عروض خاصة بالزبون» — the owner's standing, time-boxed price for one customer.
 *
 * This is NOT a second pricing engine. It is one more input to the single
 * resolver in `utils/sales-agent-pricing.ts`, which documents where an offer
 * sits relative to an approved price request and the ordinary catalog price.
 * Nothing here ever prices an order: the order path reads these rows itself and
 * runs them through that resolver, so a client cannot hand us a price.
 *
 * Who may write:
 *  - an ADMIN, like every other owner action, or
 *  - a user (rep included) carrying `MANAGE_CUSTOMER_OFFERS` explicitly.
 * A rep without it can only READ the offers of their own customers. That is why
 * this is an ALLOW permission and not one of the `AGENT_DENY` markers: those are
 * default-on by absence, and an offer must not be default-on for a rep.
 */
import { DiscountType, Unit } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { createAuditLog } from "./audit-log.service";
import {
  AgentOfferRow,
  AgentPriceMode,
  catalogUnitPrice,
  offerIsLive,
  offerUnitPrice,
  priceKey,
} from "../utils/sales-agent-pricing";
import { shopDateKey, shopInclusiveEndKey } from "../utils/shop-day";

const AUDIT_ENTITY = "SalesAgentCustomerOffer";

/**
 * How soon an ending offer counts as «قرب ينتهي».
 *
 * Exported because the follow-up FILTER (in the customers query) and the
 * follow-up REASON (shown on the row) must use the same window — otherwise a
 * customer is listed by the filter and then shows no reason for being there.
 */
export const OFFER_ENDING_SOON_DAYS = 7;

/**
 * Did the database refuse this write because it would overlap a live offer?
 *
 * The rule is a Postgres EXCLUDE constraint, so the refusal arrives as SQLSTATE
 * 23P01. Prisma wraps that differently depending on whether the statement came
 * from the query engine or a raw call, so all the shapes are checked here in
 * one place instead of at three call sites.
 */
function isOverlapViolation(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string; constraint?: string }; message?: string };
  if (e?.code === "23P01" || e?.meta?.code === "23P01") return true;
  if (e?.meta?.constraint === "sales_agent_offers_no_overlap") return true;
  return /23P01|sales_agent_offers_no_overlap|exclusion constraint/i.test(String(e?.message ?? ""));
}

const OVERLAP_MESSAGE =
  "يوجد عرض فعّال لنفس المادة والوحدة ونوع السعر لهذا الزبون بفترة متقاطعة — عدّل تواريخه أو أوقفه قبل إضافة عرض جديد";

export type OfferActor = { id: string; name?: string };

export type OfferWriteInput = {
  customerId: string;
  productId: string;
  unit: Unit;
  priceMode: AgentPriceMode;
  discountType: DiscountType;
  fixedPrice?: number | null;
  discountPercent?: number | null;
  startsAt: Date;
  /** EXCLUSIVE: the first instant the offer is no longer in force. */
  endsAt: Date;
  isActive?: boolean;
  note?: string | null;
  /**
   * The owner deliberately set a fixed price ABOVE the shelf price.
   *
   * Allowed — some agreements are genuinely dearer — but never by accident: the
   * write is refused without this, and the screen asks first.
   */
  confirmAboveCatalog?: boolean;
};

const OFFER_SELECT = {
  id: true,
  customerId: true,
  productId: true,
  unit: true,
  priceMode: true,
  discountType: true,
  fixedPrice: true,
  discountPercent: true,
  startsAt: true,
  endsAt: true,
  isActive: true,
  note: true,
  createdBy: true,
  updatedBy: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, name: true, phone: true, salesAgentId: true } },
  // Cost and profit never leave the server for a rep, so the product read is an
  // explicit select and not an include.
  product: {
    select: {
      id: true,
      name: true,
      salePrice: true,
      cartonPiecePrice: true,
      pcsPerCarton: true,
      boxPieces: true,
    },
  },
} as const;

type OfferRowWithRelations = {
  id: string;
  customerId: string;
  productId: string;
  unit: Unit;
  priceMode: string;
  discountType: DiscountType;
  fixedPrice: unknown;
  discountPercent: unknown;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  note: string | null;
  createdBy: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  customer: { id: string; name: string; phone: string; salesAgentId: string | null };
  product: {
    id: string;
    name: string;
    salePrice: unknown;
    cartonPiecePrice: unknown;
    pcsPerCarton: number;
    boxPieces: number | null;
  };
};

function toOfferPricingRow(row: OfferRowWithRelations): AgentOfferRow {
  return {
    id: row.id,
    productId: row.productId,
    unit: row.unit,
    priceMode: row.priceMode,
    discountType: row.discountType === DiscountType.PERCENT ? "PERCENT" : "AMOUNT",
    fixedPrice: row.fixedPrice == null ? null : Number(row.fixedPrice),
    discountPercent: row.discountPercent == null ? null : Number(row.discountPercent),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    isActive: row.isActive,
    note: row.note,
  };
}

/**
 * The shape every screen shows: the normal price, the offer price, and whether
 * the offer is in force right now. Computed on the server so the two numbers on
 * the rep's screen are the two numbers the order will actually use.
 */
function presentOffer(row: OfferRowWithRelations, now: Date) {
  const pricing = toOfferPricingRow(row);
  const mode: AgentPriceMode = row.priceMode === "CARTON" ? "CARTON" : "WHOLESALE";
  const catalogPrice = catalogUnitPrice(row.product, row.unit, mode);
  const price = offerUnitPrice(pricing, catalogPrice);
  const live = offerIsLive(pricing, now);
  return {
    id: row.id,
    customerId: row.customerId,
    customerName: row.customer.name,
    productId: row.productId,
    productName: row.product.name,
    unit: row.unit,
    priceMode: mode,
    discountType: row.discountType,
    fixedPrice: row.fixedPrice == null ? null : Number(row.fixedPrice),
    discountPercent: row.discountPercent == null ? null : Number(row.discountPercent),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    // The DAYS the owner picked, resolved in the shop's timezone, so no screen
    // has to turn an exclusive instant back into a date in the browser's zone.
    startsOnDate: shopDateKey(row.startsAt),
    endsOnDate: shopInclusiveEndKey(row.endsAt),
    isActive: row.isActive,
    note: row.note,
    catalogPrice,
    /// null when the stored numbers cannot produce a usable price (e.g. a fixed
    /// price of 0). The screen says «غير قابل للتطبيق» instead of showing 0.
    offerPrice: price,
    /// Dearer than the shelf price: allowed, but the screen says so plainly.
    aboveCatalog: price !== null && catalogPrice > 0 && price > catalogPrice,
    isLive: live,
    /// Why it is not in force, so the screen never has to guess.
    state: live
      ? ("LIVE" as const)
      : !row.isActive
        ? ("PAUSED" as const)
        : row.startsAt.getTime() > now.getTime()
          ? ("SCHEDULED" as const)
          : ("EXPIRED" as const),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type PresentedOffer = ReturnType<typeof presentOffer>;

function assertMode(value: string): AgentPriceMode {
  if (value !== "WHOLESALE" && value !== "CARTON") {
    throw new AppError("نوع السعر لازم يكون جملة أو توزيع كراتين", 400, "OFFER_PRICE_MODE_INVALID");
  }
  return value;
}

/**
 * Validate one offer's numbers and window.
 *
 * Distribution sells whole cartons only, everywhere else in this feature; an
 * offer on a piece in CARTON mode would be a price nobody can order at.
 */
function validateOfferInput(input: OfferWriteInput) {
  const mode = assertMode(input.priceMode);
  if (!Object.values(Unit).includes(input.unit)) {
    throw new AppError("وحدة غير صحيحة", 400, "OFFER_UNIT_INVALID");
  }
  if (mode === "CARTON" && input.unit !== Unit.CARTON) {
    throw new AppError("عرض توزيع الكراتين يكون بوحدة الكارتون فقط", 400, "OFFER_UNIT_NOT_CARTON");
  }
  if (!(input.startsAt instanceof Date) || Number.isNaN(input.startsAt.getTime())) {
    throw new AppError("تاريخ بداية العرض غير صحيح", 400, "OFFER_START_INVALID");
  }
  if (!(input.endsAt instanceof Date) || Number.isNaN(input.endsAt.getTime())) {
    throw new AppError("تاريخ نهاية العرض غير صحيح", 400, "OFFER_END_INVALID");
  }
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw new AppError("تاريخ النهاية لازم يكون بعد تاريخ البداية", 400, "OFFER_WINDOW_INVALID");
  }
  if (input.discountType === DiscountType.AMOUNT) {
    const fixed = Number(input.fixedPrice);
    if (!Number.isFinite(fixed) || fixed <= 0) {
      throw new AppError("السعر الخاص لازم يكون أكبر من صفر", 400, "OFFER_FIXED_PRICE_INVALID");
    }
  } else {
    const percent = Number(input.discountPercent);
    if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
      throw new AppError("نسبة الخصم لازم تكون بين 1 و99", 400, "OFFER_PERCENT_INVALID");
    }
  }
  return mode;
}

/**
 * Confirm the customer and product exist, and that a rep is not reaching past
 * their own customers. `agentScope` is the rep's id, or null for an owner.
 */
async function assertOfferTargets(input: { customerId: string; productId: string }, agentScope: string | null) {
  const [customer, product] = await Promise.all([
    prisma.customer.findFirst({
      where: {
        id: input.customerId,
        deletedAt: null,
        ...(agentScope ? { salesAgentId: agentScope } : {}),
      },
      select: { id: true, name: true },
    }),
    prisma.product.findFirst({
      where: { id: input.productId, deletedAt: null },
      // Prices are needed to tell the owner their fixed price is above the
      // shelf price before it is stored.
      select: {
        id: true,
        name: true,
        salePrice: true,
        cartonPiecePrice: true,
        pcsPerCarton: true,
        boxPieces: true,
      },
    }),
  ]);
  // Same reasoning as `scopeCustomerParamToSalesAgent`: a customer that exists
  // but is not this rep's answers "not found", so the rep cannot probe for it.
  if (!customer) throw new AppError("الزبون غير موجود", 404, "CUSTOMER_NOT_FOUND");
  if (!product) throw new AppError("المادة غير موجودة", 404, "PRODUCT_NOT_FOUND");
  return { customer, product };
}

export async function listCustomerOffers(opts: {
  agentScope: string | null;
  customerId?: string;
  productId?: string;
  /** Only offers in force right now. */
  liveOnly?: boolean;
  page?: number;
  limit?: number;
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);

  const where = {
    ...(opts.customerId ? { customerId: opts.customerId } : {}),
    ...(opts.productId ? { productId: opts.productId } : {}),
    // A rep only ever sees offers for customers stamped with their id — the
    // filter is here, in the query, not on the screen.
    ...(opts.agentScope ? { customer: { salesAgentId: opts.agentScope, deletedAt: null } } : {}),
    ...(opts.liveOnly ? { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } } : {}),
    // An offer on a deleted product is a price nobody can order at.
    product: { deletedAt: null },
  };

  const [total, rows] = await Promise.all([
    prisma.salesAgentCustomerOffer.count({ where }),
    prisma.salesAgentCustomerOffer.findMany({
      where,
      select: OFFER_SELECT,
      // Newest window first, so the live and scheduled offers sit above the
      // finished ones the owner is keeping as history.
      orderBy: [{ startsAt: "desc" }, { endsAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    total,
    page,
    limit,
    hasMore: page * limit < total,
    offers: (rows as unknown as OfferRowWithRelations[]).map((row) => presentOffer(row, now)),
  };
}

/**
 * A fixed price dearer than the shelf price is a real thing, not a typo to
 * block — but it must be a decision. Refused once, with the two numbers, until
 * the owner confirms; then stored exactly as they typed it, never adjusted.
 *
 * A PERCENT offer cannot produce a dearer price, so this only concerns AMOUNT.
 */
function assertAboveCatalogConfirmed(
  input: OfferWriteInput,
  product: { salePrice: unknown; cartonPiecePrice: unknown; pcsPerCarton: number; boxPieces?: number | null },
  mode: AgentPriceMode,
) {
  if (input.discountType !== DiscountType.AMOUNT) return;
  const fixed = Number(input.fixedPrice);
  const catalogPrice = catalogUnitPrice(product, input.unit, mode);
  if (!Number.isFinite(catalogPrice) || catalogPrice <= 0) return;
  if (fixed <= catalogPrice) return;
  if (input.confirmAboveCatalog) return;
  throw new AppError(
    `السعر الخاص (${Math.round(fixed)}) أعلى من سعر الكتلوگ (${Math.round(catalogPrice)}) — أكّد إذا هذا مقصود`,
    409,
    "OFFER_ABOVE_CATALOG_UNCONFIRMED",
  );
}

export async function createCustomerOffer(actor: OfferActor, agentScope: string | null, input: OfferWriteInput) {
  const mode = validateOfferInput(input);
  const { customer, product } = await assertOfferTargets(input, agentScope);
  assertAboveCatalogConfirmed(input, product, mode);

  const data = {
    customerId: input.customerId,
    productId: input.productId,
    unit: input.unit,
    priceMode: mode,
    discountType: input.discountType,
    fixedPrice: input.discountType === DiscountType.AMOUNT ? Number(input.fixedPrice) : null,
    discountPercent: input.discountType === DiscountType.PERCENT ? Number(input.discountPercent) : null,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    isActive: input.isActive ?? true,
    note: input.note?.trim() || null,
    createdBy: actor.id,
  };

  let row;
  try {
    row = await prisma.salesAgentCustomerOffer.create({ data, select: OFFER_SELECT });
  } catch (err) {
    // Two concurrent creates both pass an application-level check; only the
    // database can refuse the second one. Turn its SQLSTATE into plain Arabic
    // instead of leaking a constraint name to the screen.
    if (isOverlapViolation(err)) {
      throw new AppError(OVERLAP_MESSAGE, 409, "OFFER_PERIOD_OVERLAP");
    }
    throw err;
  }

  await createAuditLog({
    userId: actor.id,
    action: "CREATE",
    entity: AUDIT_ENTITY,
    recordId: row.id,
    after: data,
    metadata: { customerName: customer.name, productName: product.name },
  });

  return presentOffer(row as unknown as OfferRowWithRelations, new Date());
}

export async function updateCustomerOffer(
  actor: OfferActor,
  agentScope: string | null,
  id: string,
  input: OfferWriteInput,
) {
  const existing = (await prisma.salesAgentCustomerOffer.findFirst({
    where: {
      id,
      ...(agentScope ? { customer: { salesAgentId: agentScope } } : {}),
    },
    select: OFFER_SELECT,
  })) as unknown as OfferRowWithRelations | null;
  if (!existing) throw new AppError("العرض غير موجود", 404, "OFFER_NOT_FOUND");

  // The target customer/product of an existing offer cannot be swapped: that is
  // a different offer, and moving it would rewrite who a price belonged to.
  const target: OfferWriteInput = {
    ...input,
    customerId: existing.customerId,
    productId: existing.productId,
    unit: existing.unit,
    priceMode: existing.priceMode === "CARTON" ? "CARTON" : "WHOLESALE",
  };
  validateOfferInput(target);
  assertAboveCatalogConfirmed(target, existing.product, target.priceMode);

  const data = {
    discountType: target.discountType,
    fixedPrice: target.discountType === DiscountType.AMOUNT ? Number(target.fixedPrice) : null,
    discountPercent: target.discountType === DiscountType.PERCENT ? Number(target.discountPercent) : null,
    startsAt: target.startsAt,
    endsAt: target.endsAt,
    isActive: target.isActive ?? existing.isActive,
    note: target.note?.trim() || null,
    updatedBy: actor.id,
  };

  let row;
  try {
    row = await prisma.salesAgentCustomerOffer.update({ where: { id }, data, select: OFFER_SELECT });
  } catch (err) {
    // Moving an offer's dates can push it onto a live one.
    if (isOverlapViolation(err)) {
      throw new AppError(OVERLAP_MESSAGE, 409, "OFFER_PERIOD_OVERLAP");
    }
    throw err;
  }

  await createAuditLog({
    userId: actor.id,
    action: "UPDATE",
    entity: AUDIT_ENTITY,
    recordId: id,
    before: {
      discountType: existing.discountType,
      fixedPrice: existing.fixedPrice == null ? null : Number(existing.fixedPrice),
      discountPercent: existing.discountPercent == null ? null : Number(existing.discountPercent),
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
      isActive: existing.isActive,
      note: existing.note,
    },
    after: data,
    metadata: { customerName: existing.customer.name, productName: existing.product.name },
  });

  return presentOffer(row as unknown as OfferRowWithRelations, new Date());
}

/** «إيقاف / تشغيل» — kept separate so pausing an offer is one tap and one audit row. */
export async function setCustomerOfferActive(
  actor: OfferActor,
  agentScope: string | null,
  id: string,
  isActive: boolean,
) {
  const existing = (await prisma.salesAgentCustomerOffer.findFirst({
    where: { id, ...(agentScope ? { customer: { salesAgentId: agentScope } } : {}) },
    select: OFFER_SELECT,
  })) as unknown as OfferRowWithRelations | null;
  if (!existing) throw new AppError("العرض غير موجود", 404, "OFFER_NOT_FOUND");

  let row;
  try {
    row = await prisma.salesAgentCustomerOffer.update({
      where: { id },
      data: { isActive, updatedBy: actor.id },
      select: OFFER_SELECT,
    });
  } catch (err) {
    // Resuming a paused offer whose window overlaps a live one: refused by the
    // database, explained here. Pausing can never conflict.
    if (isOverlapViolation(err)) {
      throw new AppError(
        "ما نكدر نشغّل هذا العرض: فترته تتقاطع مع عرض فعّال لنفس المادة والوحدة ونوع السعر — أوقف الثاني أو عدّل التواريخ",
        409,
        "OFFER_PERIOD_OVERLAP",
      );
    }
    throw err;
  }

  await createAuditLog({
    userId: actor.id,
    action: isActive ? "OFFER_RESUME" : "OFFER_PAUSE",
    entity: AUDIT_ENTITY,
    recordId: id,
    before: { isActive: existing.isActive },
    after: { isActive },
    metadata: { customerName: existing.customer.name, productName: existing.product.name },
  });

  return presentOffer(row as unknown as OfferRowWithRelations, new Date());
}

/**
 * The offer in force for each (product, unit) of one customer, keyed for the
 * price resolver.
 *
 * A customer now keeps a TIMELINE per product/unit/basis — finished offers,
 * a scheduled one, paused ones — so this picks the row that is live at `now`
 * and the caller passes ONE instant for a whole order. The database guarantees
 * at most one active row can cover any instant, so "the live one" is never a
 * guess; `resolveAgentUnitPrice` still re-checks liveness as a second pair of
 * eyes, and a key with no live row simply falls back to the catalog price.
 */
export async function offerMapForCustomer(
  customerId: string,
  productIds: string[],
  now: Date,
  priceMode: AgentPriceMode,
) {
  if (productIds.length === 0) return new Map<string, AgentOfferRow>();
  const rows = await prisma.salesAgentCustomerOffer.findMany({
    where: {
      customerId,
      productId: { in: productIds },
      product: { deletedAt: null },
      // The order's own price basis. Without this, a customer holding both a
      // wholesale and a distribution offer for the same product and unit would
      // have one of them overwrite the other on the map key, and the resolver
      // would then reject the survivor for being the wrong basis — quietly
      // losing a valid offer.
      priceMode,
      // Narrowed in SQL: a customer with years of offer history must not ship
      // all of it to price one cart.
      isActive: true,
      startsAt: { lte: now },
      endsAt: { gt: now },
    },
    select: {
      id: true,
      productId: true,
      unit: true,
      priceMode: true,
      discountType: true,
      fixedPrice: true,
      discountPercent: true,
      startsAt: true,
      endsAt: true,
      isActive: true,
      note: true,
    },
  });
  const map = new Map<string, AgentOfferRow>();
  for (const row of rows) {
    map.set(
      priceKey(row.productId, row.unit),
      {
        id: row.id,
        productId: row.productId,
        unit: row.unit,
        priceMode: row.priceMode,
        discountType: row.discountType === DiscountType.PERCENT ? "PERCENT" : "AMOUNT",
        fixedPrice: row.fixedPrice == null ? null : Number(row.fixedPrice),
        discountPercent: row.discountPercent == null ? null : Number(row.discountPercent),
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        isActive: row.isActive,
        note: row.note,
      },
    );
  }
  return map;
}

/**
 * Offers about to run out, for «يحتاجون متابعة».
 *
 * Grouped per customer so the follow-up list can say «عرض ينتهي بعد يومين»
 * without a query per customer.
 */
export async function offersEndingSoon(opts: {
  agentScope: string | null;
  withinDays: number;
  now?: Date;
  customerIds?: string[];
}) {
  const now = opts.now ?? new Date();
  const until = new Date(now.getTime() + Math.max(1, opts.withinDays) * 86_400_000);
  const rows = await prisma.salesAgentCustomerOffer.findMany({
    where: {
      isActive: true,
      startsAt: { lte: now },
      endsAt: { gt: now, lte: until },
      product: { deletedAt: null },
      ...(opts.customerIds ? { customerId: { in: opts.customerIds } } : {}),
      ...(opts.agentScope
        ? { customer: { salesAgentId: opts.agentScope, deletedAt: null } }
        : { customer: { deletedAt: null } }),
    },
    select: {
      id: true,
      customerId: true,
      endsAt: true,
      product: { select: { name: true } },
    },
    orderBy: [{ endsAt: "asc" }],
    take: 500,
  });
  const byCustomer = new Map<string, { count: number; firstEndsAt: Date; productName: string }>();
  for (const row of rows) {
    const current = byCustomer.get(row.customerId);
    if (current) current.count += 1;
    else byCustomer.set(row.customerId, { count: 1, firstEndsAt: row.endsAt, productName: row.product.name });
  }
  return byCustomer;
}
