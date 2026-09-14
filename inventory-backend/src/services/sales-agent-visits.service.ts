/**
 * «خريطة الزيارات» — the rep's round for the day.
 *
 * Privacy rules this file exists to keep:
 *  - The rep's own position is NEVER stored. A position may be passed in once,
 *    per request, to sort their customers by distance; it is used and dropped.
 *  - Coordinates belong to the CUSTOMER's shop, entered deliberately (by the
 *    owner, or by the rep standing at the door). There is no trail, no
 *    background tracking and no history of where the rep has been.
 *  - A rep sees only customers stamped with their id, so a map can never show
 *    another rep's round.
 *
 * «اليوم» is the shop's day, not the server's: the existing Baghdad-aware
 * helpers decide the boundaries, so a visit at 01:00 local is not filed under
 * yesterday because the server runs in UTC.
 */
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { assistantTimezone, todayStr, zonedDayRange } from "./daily-assistant.service";
import { assertOwnCustomer } from "./sales-agent.service";
import { createAuditLog } from "./audit-log.service";
import { isShopDateKey } from "../utils/shop-day";

/** The outcomes the rep can file. Free string in the database, closed here. */
export const VISIT_OUTCOMES = {
  ORDERED: "أخذ طلب",
  NO_ORDER: "ما طلب",
  CLOSED: "المحل مغلق",
  NEEDS_FOLLOW_UP: "يحتاج متابعة",
  NOTE: "ملاحظة فقط",
} as const;

export type VisitOutcome = keyof typeof VISIT_OUTCOMES;

export function isVisitOutcome(value: unknown): value is VisitOutcome {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(VISIT_OUTCOMES, value);
}

/** Plan states. Free text in the database, closed here. */
export const PLAN_STATUSES = {
  PLANNED: "مخطط",
  STARTED: "بدأت",
  DONE: "اكتملت",
  CANCELLED: "أُلغيت",
} as const;

export type PlanStatus = keyof typeof PLAN_STATUSES;

export function isPlanStatus(value: unknown): value is PlanStatus {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PLAN_STATUSES, value);
}

/**
 * Shop-local `YYYY-MM-DD` — today when nothing was asked for, and a REFUSAL
 * when what was asked for is not a real day.
 *
 * The old version tested the shape with a regex, so `2026-99-99` passed and
 * `2026-02-30` passed, and either one silently became a plan nobody could
 * ever see. Falling back to today would be worse still: the owner would think
 * they had planned next week.
 */
function planDateOf(value?: string): string {
  const tz = assistantTimezone();
  const asked = value?.trim();
  if (!asked) return todayStr(tz);
  if (!isShopDateKey(asked)) {
    throw new AppError("تاريخ خطة الزيارة غير صحيح", 400, "VISIT_PLAN_DATE_INVALID");
  }
  return asked;
}

const EARTH_RADIUS_KM = 6371;

/** Straight-line distance in km. Enough to sort a round; not a driving route. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function validCoordinate(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  // Exactly 0,0 is in the Atlantic. It is what a broken client sends, not a shop.
  if (latitude === 0 && longitude === 0) return null;
  return { lat: latitude, lng: longitude };
}

/**
 * The rep's customers for the map and the round list.
 *
 * Customers without coordinates are NOT hidden: they come back with their
 * address and area so the screen can offer «حدد الموقع» or open the address in
 * a map app. Hiding them would quietly shrink the rep's round.
 */
export async function listVisitCustomers(
  agentId: string,
  opts?: {
    area?: string;
    search?: string;
    /** The rep's current position, for distance sorting. Never stored. */
    fromLat?: unknown;
    fromLng?: unknown;
    page?: number;
    limit?: number;
    withCoordinatesOnly?: boolean;
  },
) {
  const page = Math.max(1, opts?.page ?? 1);
  const limit = Math.min(Math.max(1, opts?.limit ?? 200), 500);
  const term = opts?.search?.trim();
  const from = validCoordinate(opts?.fromLat, opts?.fromLng);

  const where = {
    deletedAt: null,
    salesAgentId: agentId,
    ...(opts?.area ? { area: opts.area } : {}),
    ...(opts?.withCoordinatesOnly ? { latitude: { not: null }, longitude: { not: null } } : {}),
    ...(term
      ? { OR: [{ name: { contains: term, mode: "insensitive" as const } }, { phone: { contains: term } }] }
      : {}),
  };

  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      select: {
        id: true,
        name: true,
        phone: true,
        address: true,
        area: true,
        latitude: true,
        longitude: true,
        currentBalance: true,
        lastTransactionAt: true,
      },
      orderBy: [{ area: "asc" }, { name: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const { start, end } = zonedDayRange(todayStr(), assistantTimezone());
  const ids = customers.map((c) => c.id);
  // One query for today's visits across the whole page.
  const todayVisits = ids.length
    ? await prisma.salesAgentVisit.findMany({
        where: { salesAgentId: agentId, customerId: { in: ids }, startedAt: { gte: start, lte: end } },
        orderBy: { startedAt: "desc" },
        select: { id: true, customerId: true, startedAt: true, endedAt: true, outcome: true, note: true },
      })
    : [];
  const visitByCustomer = new Map<string, (typeof todayVisits)[number]>();
  for (const visit of todayVisits) {
    if (!visitByCustomer.has(visit.customerId)) visitByCustomer.set(visit.customerId, visit);
  }

  const rows = customers.map((customer) => {
    const lat = customer.latitude == null ? null : Number(customer.latitude);
    const lng = customer.longitude == null ? null : Number(customer.longitude);
    const point = lat != null && lng != null ? { lat, lng } : null;
    const visit = visitByCustomer.get(customer.id) ?? null;
    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      area: customer.area,
      latitude: lat,
      longitude: lng,
      currentBalance: Number(customer.currentBalance),
      lastTransactionAt: customer.lastTransactionAt,
      distanceKm: from && point ? Math.round(distanceKm(from, point) * 100) / 100 : null,
      todayVisit: visit
        ? {
            id: visit.id,
            startedAt: visit.startedAt,
            endedAt: visit.endedAt,
            outcome: visit.outcome,
            outcomeLabel: isVisitOutcome(visit.outcome) ? VISIT_OUTCOMES[visit.outcome] : null,
            note: visit.note,
          }
        : null,
    };
  });

  // Distance sorting only when a position was supplied; customers with no
  // coordinates keep their area/name order at the end of the list rather than
  // being dropped.
  if (from) {
    rows.sort((a, b) => {
      if (a.distanceKm == null && b.distanceKm == null) return 0;
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm;
    });
  }

  return { total, page, limit, hasMore: page * limit < total, customers: rows };
}

/** Today's visits, in the shop's timezone. */
export async function listTodayVisits(agentId: string, dateKey?: string) {
  const tz = assistantTimezone();
  // Same rule as the plan: a date that does not exist is refused, not rounded
  // to today, so a mistyped URL cannot quietly show the wrong day's visits.
  const asked = dateKey?.trim();
  if (asked && !isShopDateKey(asked)) {
    throw new AppError("تاريخ خطة الزيارة غير صحيح", 400, "VISIT_PLAN_DATE_INVALID");
  }
  const key = asked || todayStr(tz);
  const { start, end } = zonedDayRange(key, tz);
  const visits = await prisma.salesAgentVisit.findMany({
    where: { salesAgentId: agentId, startedAt: { gte: start, lte: end } },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      outcome: true,
      note: true,
      customer: { select: { id: true, name: true, phone: true, area: true, address: true } },
    },
  });
  return {
    date: key,
    timezone: tz,
    visits: visits.map((visit) => ({
      id: visit.id,
      startedAt: visit.startedAt,
      endedAt: visit.endedAt,
      outcome: visit.outcome,
      outcomeLabel: isVisitOutcome(visit.outcome) ? VISIT_OUTCOMES[visit.outcome] : null,
      note: visit.note,
      customerId: visit.customer.id,
      customerName: visit.customer.name,
      customerPhone: visit.customer.phone,
      area: visit.customer.area,
      address: visit.customer.address,
    })),
  };
}

/**
 * «بدء زيارة». Idempotent on `clientRequestId`, so a double tap on a weak
 * connection cannot open two visits, and an open visit for the same customer
 * today is returned instead of a second one being started.
 */
export async function startVisit(
  agentId: string,
  input: { customerId: string; clientRequestId?: string; planId?: string },
) {
  const customer = await assertOwnCustomer(agentId, input.customerId);
  const key = input.clientRequestId?.trim();

  // A plan entry may only be started by the rep it belongs to, for the customer
  // it names. Anything else is another rep's round.
  let planId: string | null = null;
  if (input.planId) {
    const plan = await prisma.salesAgentVisitPlan.findFirst({
      where: { id: input.planId, salesAgentId: agentId, customerId: customer.id },
      select: { id: true },
    });
    if (!plan) throw new AppError("خطة الزيارة غير موجودة", 404, "VISIT_PLAN_NOT_FOUND");
    planId = plan.id;
  }

  if (key) {
    const prior = await prisma.salesAgentVisit.findFirst({
      where: { clientRequestId: key, salesAgentId: agentId },
      select: { id: true, startedAt: true, endedAt: true, outcome: true },
    });
    if (prior) return { ...prior, customerId: customer.id, duplicate: true };
  }

  // An unfinished visit to the same customer is the visit the rep is on.
  const open = await prisma.salesAgentVisit.findFirst({
    where: { salesAgentId: agentId, customerId: customer.id, endedAt: null },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true, endedAt: true, outcome: true },
  });
  if (open) return { ...open, customerId: customer.id, duplicate: true };

  try {
    const visit = await prisma.salesAgentVisit.create({
      data: { salesAgentId: agentId, customerId: customer.id, clientRequestId: key || null, planId },
      select: { id: true, startedAt: true, endedAt: true, outcome: true },
    });
    if (planId) {
      // Best effort: the visit is the fact, the plan status is a convenience.
      await prisma.salesAgentVisitPlan
        .updateMany({ where: { id: planId, status: "PLANNED" }, data: { status: "STARTED" } })
        .catch(() => undefined);
    }
    return { ...visit, customerId: customer.id, planId, duplicate: false };
  } catch (err) {
    // Two taps raced past the read and the unique index caught the second.
    if (key && (err as { code?: string })?.code === "P2002") {
      const prior = await prisma.salesAgentVisit.findFirst({
        where: { clientRequestId: key, salesAgentId: agentId },
        select: { id: true, startedAt: true, endedAt: true, outcome: true },
      });
      if (prior) return { ...prior, customerId: customer.id, duplicate: true };
    }
    throw err;
  }
}

/** «إنهاء زيارة» with its outcome. Re-closing an already closed visit is refused. */
export async function endVisit(
  agentId: string,
  visitId: string,
  input: { outcome: unknown; note?: string },
) {
  if (!isVisitOutcome(input.outcome)) {
    throw new AppError("اختر نتيجة الزيارة", 400, "VISIT_OUTCOME_INVALID");
  }
  const visit = await prisma.salesAgentVisit.findFirst({
    where: { id: visitId, salesAgentId: agentId },
    select: { id: true, endedAt: true },
  });
  if (!visit) throw new AppError("الزيارة غير موجودة", 404, "VISIT_NOT_FOUND");
  if (visit.endedAt) {
    throw new AppError("هذي الزيارة منتهية أصلاً", 409, "VISIT_ALREADY_ENDED");
  }
  const updated = await prisma.salesAgentVisit.update({
    where: { id: visitId },
    data: { endedAt: new Date(), outcome: input.outcome, note: input.note?.trim() || null },
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      outcome: true,
      note: true,
      planId: true,
      orderApprovalId: true,
    },
  });

  if (updated.planId) {
    await prisma.salesAgentVisitPlan
      .updateMany({ where: { id: updated.planId }, data: { status: "DONE" } })
      .catch(() => undefined);
  }

  return {
    ...updated,
    outcomeLabel: isVisitOutcome(updated.outcome) ? VISIT_OUTCOMES[updated.outcome] : null,
    /**
     * «أخذ طلب» with no order behind it is a MANUAL result, and says so.
     *
     * The rep is not stopped from recording it — the order may genuinely be
     * written later — but nothing may present it as a documented sale.
     */
    orderLinked: Boolean(updated.orderApprovalId),
    manualOutcome: updated.outcome === "ORDERED" && !updated.orderApprovalId,
  };
}

/**
 * Attach a freshly sent order to the visit the rep is on, if any.
 *
 * Called after an order is accepted, and deliberately best-effort: an order
 * that succeeded must never fail because a visit row could not be stamped. Only
 * an OPEN visit for the SAME rep and SAME customer is touched, so one
 * customer's order can never land on another customer's visit.
 */
export async function linkOrderToOpenVisit(
  agentId: string,
  customerId: string,
  approvalId: string,
): Promise<{ visitId: string } | null> {
  const open = await prisma.salesAgentVisit.findFirst({
    where: { salesAgentId: agentId, customerId, endedAt: null, orderApprovalId: null },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (!open) return null;
  await prisma.salesAgentVisit.update({ where: { id: open.id }, data: { orderApprovalId: approvalId } });
  return { visitId: open.id };
}

/* ── «خطة زيارات اليوم» ──────────────────────────────────────────────── */

const PLAN_SELECT = {
  id: true,
  salesAgentId: true,
  customerId: true,
  planDate: true,
  sortOrder: true,
  note: true,
  status: true,
  createdAt: true,
  customer: {
    select: {
      id: true,
      name: true,
      phone: true,
      address: true,
      area: true,
      latitude: true,
      longitude: true,
      currentBalance: true,
    },
  },
} as const;

type PlanRow = {
  id: string;
  salesAgentId: string;
  customerId: string;
  planDate: string;
  sortOrder: number | null;
  note: string | null;
  status: string;
  createdAt: Date;
  customer: {
    id: string;
    name: string;
    phone: string;
    address: string | null;
    area: string | null;
    latitude: unknown;
    longitude: unknown;
    currentBalance: unknown;
  };
};

function presentPlan(row: PlanRow) {
  return {
    id: row.id,
    salesAgentId: row.salesAgentId,
    customerId: row.customerId,
    customerName: row.customer.name,
    customerPhone: row.customer.phone,
    address: row.customer.address,
    area: row.customer.area,
    latitude: row.customer.latitude == null ? null : Number(row.customer.latitude),
    longitude: row.customer.longitude == null ? null : Number(row.customer.longitude),
    currentBalance: Number(row.customer.currentBalance),
    planDate: row.planDate,
    sortOrder: row.sortOrder,
    note: row.note,
    status: row.status,
    statusLabel: isPlanStatus(row.status) ? PLAN_STATUSES[row.status] : row.status,
    createdAt: row.createdAt,
  };
}

/**
 * One day's plan for one rep, with the visit filed against each entry.
 *
 * `agentId` is always the rep whose plan it is — an owner reads another rep's
 * plan by passing that rep's id through an admin route, never by widening this
 * query.
 */
export async function listVisitPlan(agentId: string, dateKey?: string) {
  const tz = assistantTimezone();
  const planDate = planDateOf(dateKey);
  const rows = (await prisma.salesAgentVisitPlan.findMany({
    where: { salesAgentId: agentId, planDate },
    select: PLAN_SELECT,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  })) as unknown as PlanRow[];

  const { start, end } = zonedDayRange(planDate, tz);
  const visits = rows.length
    ? await prisma.salesAgentVisit.findMany({
        where: {
          salesAgentId: agentId,
          startedAt: { gte: start, lte: end },
          customerId: { in: rows.map((r) => r.customerId) },
        },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          customerId: true,
          planId: true,
          startedAt: true,
          endedAt: true,
          outcome: true,
          note: true,
          orderApprovalId: true,
        },
      })
    : [];
  const visitByCustomer = new Map<string, (typeof visits)[number]>();
  for (const visit of visits) {
    if (!visitByCustomer.has(visit.customerId)) visitByCustomer.set(visit.customerId, visit);
  }

  return {
    date: planDate,
    timezone: tz,
    entries: rows.map((row) => {
      const visit = visitByCustomer.get(row.customerId) ?? null;
      return {
        ...presentPlan(row),
        visit: visit
          ? {
              id: visit.id,
              startedAt: visit.startedAt,
              endedAt: visit.endedAt,
              outcome: visit.outcome,
              outcomeLabel: isVisitOutcome(visit.outcome) ? VISIT_OUTCOMES[visit.outcome] : null,
              note: visit.note,
              orderLinked: Boolean(visit.orderApprovalId),
              manualOutcome: visit.outcome === "ORDERED" && !visit.orderApprovalId,
            }
          : null,
      };
    }),
  };
}

/**
 * Put a customer on a rep's plan for a day.
 *
 * `agentScope` is the rep doing it, or null for an owner assigning work. A rep
 * may only plan their OWN customers; an owner may plan a customer for the rep
 * that customer belongs to — planning someone else's customer for a rep would
 * hand them an account they cannot even open.
 */
export async function addToVisitPlan(
  actor: { id: string },
  agentScope: string | null,
  input: { salesAgentId?: string; customerId: string; planDate?: string; note?: string; sortOrder?: number },
) {
  const planDate = planDateOf(input.planDate);
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, deletedAt: null },
    select: { id: true, salesAgentId: true, name: true },
  });
  if (!customer) throw new AppError("الزبون غير موجود", 404, "CUSTOMER_NOT_FOUND");

  const salesAgentId = agentScope ?? input.salesAgentId ?? customer.salesAgentId ?? null;
  if (!salesAgentId) {
    throw new AppError("هذا الزبون ما عنده مندوب", 400, "CUSTOMER_HAS_NO_AGENT");
  }
  // Same answer for "not yours" as everywhere else in this feature: not found,
  // so a rep cannot probe for another rep's customers.
  if (customer.salesAgentId !== salesAgentId) {
    throw new AppError("الزبون غير موجود", 404, "CUSTOMER_NOT_IN_SCOPE");
  }

  try {
    const row = (await prisma.salesAgentVisitPlan.create({
      data: {
        salesAgentId,
        customerId: customer.id,
        planDate,
        note: input.note?.trim() || null,
        sortOrder: Number.isFinite(Number(input.sortOrder)) ? Math.trunc(Number(input.sortOrder)) : null,
        createdBy: actor.id,
      },
      select: PLAN_SELECT,
    })) as unknown as PlanRow;
    return presentPlan(row);
  } catch (err) {
    // The unique index is the "no duplicate stop in one day" rule.
    if ((err as { code?: string })?.code === "P2002") {
      throw new AppError("هذا الزبون موجود بخطة نفس اليوم", 409, "VISIT_PLAN_DUPLICATE");
    }
    throw err;
  }
}

/** Change one plan entry: its order in the day, its note, or its status. */
export async function updateVisitPlanEntry(
  agentScope: string | null,
  planId: string,
  input: { status?: unknown; note?: string; sortOrder?: number },
) {
  const existing = await prisma.salesAgentVisitPlan.findFirst({
    where: { id: planId, ...(agentScope ? { salesAgentId: agentScope } : {}) },
    select: { id: true },
  });
  if (!existing) throw new AppError("خطة الزيارة غير موجودة", 404, "VISIT_PLAN_NOT_FOUND");
  if (input.status !== undefined && !isPlanStatus(input.status)) {
    throw new AppError("حالة الخطة غير صحيحة", 400, "VISIT_PLAN_STATUS_INVALID");
  }
  const row = (await prisma.salesAgentVisitPlan.update({
    where: { id: planId },
    data: {
      ...(input.status !== undefined ? { status: input.status as PlanStatus } : {}),
      ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
      ...(input.sortOrder !== undefined
        ? { sortOrder: Number.isFinite(Number(input.sortOrder)) ? Math.trunc(Number(input.sortOrder)) : null }
        : {}),
    },
    select: PLAN_SELECT,
  })) as unknown as PlanRow;
  return presentPlan(row);
}

/**
 * Pin a customer's shop on the map.
 *
 * This is the CUSTOMER's location, saved once, and the only location this
 * feature ever writes. Passing null clears it.
 */
export async function setCustomerLocation(
  actor: { id: string },
  agentScope: string | null,
  customerId: string,
  input: { latitude: unknown; longitude: unknown },
) {
  // A rep may only pin THEIR customers. An owner (agentScope null) may correct
  // any customer's shop, which is what makes a wrong pin fixable at all.
  const customer = agentScope
    ? await assertOwnCustomer(agentScope, customerId)
    : await prisma.customer.findFirst({
        where: { id: customerId, deletedAt: null },
        select: { id: true, name: true, latitude: true, longitude: true },
      });
  if (!customer) throw new AppError("الزبون غير موجود", 404, "CUSTOMER_NOT_FOUND");

  const clearing = input.latitude == null && input.longitude == null;
  const point = clearing ? null : validCoordinate(input.latitude, input.longitude);
  if (!clearing && !point) {
    throw new AppError("الموقع غير صحيح", 400, "LOCATION_INVALID");
  }

  const before = {
    latitude: customer.latitude == null ? null : Number(customer.latitude),
    longitude: customer.longitude == null ? null : Number(customer.longitude),
  };

  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: { latitude: point ? point.lat : null, longitude: point ? point.lng : null },
    select: { id: true, latitude: true, longitude: true },
  });

  const after = {
    latitude: updated.latitude == null ? null : Number(updated.latitude),
    longitude: updated.longitude == null ? null : Number(updated.longitude),
  };

  // Who moved a shop, from where to where, and when. This is the CUSTOMER's
  // location only — the rep's own position is never written anywhere, so there
  // is no movement history of a person in this log.
  await createAuditLog({
    userId: actor.id,
    action: clearing ? "CUSTOMER_LOCATION_CLEARED" : before.latitude == null ? "CUSTOMER_LOCATION_SET" : "CUSTOMER_LOCATION_CORRECTED",
    entity: "Customer",
    recordId: customer.id,
    before,
    after,
    metadata: { customerName: customer.name },
  }).catch(() => undefined);

  return { id: updated.id, ...after };
}

/**
 * One rep's customers, for the owner's plan screen.
 *
 * A separate read from the rep's own `listMyCustomers` because the OWNER is
 * asking, and about a rep they name. `GET /customers` deliberately refuses to
 * take `salesAgentId` from the query string — a rep could widen their own
 * scope by editing a URL — so this admin-only path exists instead of loosening
 * that rule.
 */
export async function listCustomersOfAgent(opts: {
  salesAgentId: string;
  search?: string;
  area?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
  const term = opts.search?.trim();
  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      salesAgentId: opts.salesAgentId,
      ...(opts.area ? { area: opts.area } : {}),
      ...(term
        ? { OR: [{ name: { contains: term, mode: "insensitive" as const } }, { phone: { contains: term } }] }
        : {}),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      area: true,
      address: true,
      currentBalance: true,
      latitude: true,
      longitude: true,
    },
    orderBy: [{ area: "asc" }, { name: "asc" }],
    take: limit,
  });
  return customers.map((customer) => ({
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    area: customer.area,
    address: customer.address,
    currentBalance: Number(customer.currentBalance),
    hasLocation: customer.latitude != null && customer.longitude != null,
  }));
}
