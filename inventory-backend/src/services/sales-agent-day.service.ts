/**
 * «شنو سوّى المندوب اليوم» — the owner's read of one rep's working day.
 *
 * Built from actions the rep already files, not from anything new they have to
 * remember to press. Two independent layers, deliberately:
 *
 *   1. THE TIMELINE — every order, receipt, visit, logged refusal and new
 *      customer, with its timestamp. This needs no GPS at all and works
 *      retroactively over data the shop already has. First action is when the
 *      rep started, last is when they stopped, and the holes in between are
 *      the holes in between. Most of what an owner actually wants is here.
 *
 *   2. THE POSITIONS — `SalesAgentStamp` rows, which only exist from the day
 *      location stamping shipped and only for actions filed since. They answer
 *      «was he at the shop» and nothing else.
 *
 * Layer 2 being empty must never make layer 1 look empty: a shop that has not
 * deployed the new client yet still gets a full day report, just without the
 * map. Every caller here assumes positions are missing and renders anyway.
 *
 * WHAT THIS DELIBERATELY IS NOT: a movement trace. There is no path between
 * actions because none is recorded. A gap in the timeline is a gap in FILED
 * WORK, which is a different claim from «he was sitting at home», and the
 * wording of everything built on top of this has to keep that distinction —
 * a rep driving 40 minutes between two districts files nothing and is working.
 */
import prisma from "../config/database";
import { approvalRequestTypes } from "./approval.service";
import { shopDateKey, shopDayEndExclusive, shopDayStart } from "../utils/shop-day";

const toNumber = (v: unknown): number => (v == null ? 0 : Number(v));

/** One thing the rep did, with when and (when known) where. */
export type DayEvent = {
  at: Date;
  action: "ORDER" | "RECEIPT" | "VISIT" | "NEW_CUSTOMER" | "ISSUE";
  customerId: string | null;
  customerName: string | null;
  /** Order subtotal or receipt amount; null for actions that carry no money. */
  amount: number | null;
  /** Free text the row already carried — an order's status, a visit's outcome. */
  detail: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  /** Metres from the customer's own shop position, when both are known. */
  distanceM: number | null;
  locationStatus: string | null;
  /**
   * Minutes between the position being read and the row being written. Large
   * on an order filled offline and sent later, which is normal and is exactly
   * why it is surfaced rather than hidden.
   */
  sendLagMin: number | null;
};

export type AgentDay = {
  date: string;
  agentId: string;
  agentName: string;
  events: DayEvent[];
  /** First and last FILED action, shop time. Null on a day with no work. */
  startedAt: Date | null;
  endedAt: Date | null;
  /** Minutes between first and last action. */
  spanMin: number;
  /** Stretches with no filed action at all, longer than the gap threshold. */
  gaps: Array<{ fromAt: Date; toAt: Date; minutes: number }>;
  idleMin: number;
  counts: {
    orders: number;
    rejectedOrders: number;
    receipts: number;
    visits: number;
    issues: number;
    newCustomers: number;
    customersVisited: number;
  };
  money: { sold: number; collected: number; rejectedValue: number };
  /** Positions: how many actions carried one, and how they came out. */
  location: {
    withFix: number;
    denied: number;
    unavailable: number;
    /** Actions filed more than `farMetres` from the shop, precise fix only. */
    far: number;
    /** Readings too vague to judge, counted but never held against the rep. */
    vague: number;
  };
  areas: Array<{ area: string; actions: number }>;
};

/**
 * How long a hole in the timeline has to be before it is worth naming.
 *
 * 90 minutes, not 30: a rep driving between two districts, eating, or sitting
 * with a shopkeeper who talks files nothing for a long stretch and is working
 * the whole time. Flagging every half hour would produce a report the owner
 * learns to scroll past, which is worse than no report.
 */
const GAP_MIN = 90;

/**
 * Past this, an action is «بعيد عن المحل».
 *
 * 500 m covers a rep standing across a wide street, a fix drifting between
 * buildings, and a shop whose pin was dropped at its back entrance. Below that
 * the number means nothing.
 */
const FAR_METRES = 500;

/**
 * A fix vaguer than this cannot support any distance claim at all.
 *
 * Kept separate from FAR_METRES on purpose: «far» and «we could not tell» are
 * different findings, and collapsing them is how an owner ends up accusing a
 * rep over a bad signal indoors.
 */
const VAGUE_METRES = 200;

/** Minutes between two instants, rounded. */
const minutesBetween = (a: Date, b: Date) =>
  Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));

export async function getAgentDay(agentId: string, dateKey?: string): Promise<AgentDay> {
  const day = dateKey && /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : shopDateKey(new Date());
  const start = shopDayStart(day);
  const end = shopDayEndExclusive(day);
  const window = { gte: start, lt: end };

  const [agent, orders, receipts, visits, issues, newCustomers, stamps] = await Promise.all([
    prisma.user.findUnique({ where: { id: agentId }, select: { id: true, name: true } }),
    prisma.pendingApproval.findMany({
      where: { requestedBy: agentId, requestType: approvalRequestTypes.CATALOG_ORDER, createdAt: window },
      select: { id: true, createdAt: true, status: true, requestData: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.paymentVoucher.findMany({
      where: { salesAgentId: agentId, type: "RECEIPT", archivedAt: null, date: window },
      select: {
        id: true,
        date: true,
        amount: true,
        cancelledAt: true,
        customerId: true,
        customer: { select: { name: true, area: true } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.salesAgentVisit.findMany({
      where: { salesAgentId: agentId, startedAt: window },
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        outcome: true,
        customerId: true,
        customer: { select: { name: true, area: true } },
      },
      orderBy: { startedAt: "asc" },
    }),
    prisma.salesAgentIssue.findMany({
      where: { salesAgentId: agentId, createdAt: window },
      select: {
        id: true,
        createdAt: true,
        customerId: true,
        customer: { select: { name: true, area: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.customer.findMany({
      where: { salesAgentId: agentId, deletedAt: null, createdAt: window },
      select: { id: true, name: true, area: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.salesAgentStamp.findMany({
      where: { salesAgentId: agentId, createdAt: window },
      select: {
        action: true,
        referenceId: true,
        customerId: true,
        latitude: true,
        longitude: true,
        accuracyM: true,
        status: true,
        distanceM: true,
        capturedAt: true,
        createdAt: true,
      },
    }),
  ]);

  // Stamps are matched to their action by referenceId. A stamp whose write
  // failed simply leaves the event without a position, which every consumer
  // already handles — the action itself is never hidden for want of one.
  const stampByRef = new Map<string, (typeof stamps)[number]>();
  for (const s of stamps) if (s.referenceId) stampByRef.set(s.referenceId, s);

  // Customer names for orders, whose customerId lives inside the payload rather
  // than in a column. One read for the whole day instead of one per order.
  const orderCustomerIds = new Set<string>();
  for (const o of orders) {
    const d = (o.requestData ?? {}) as { customerId?: string };
    if (d.customerId) orderCustomerIds.add(d.customerId);
  }
  const orderCustomers = orderCustomerIds.size
    ? await prisma.customer.findMany({
        where: { id: { in: [...orderCustomerIds] } },
        select: { id: true, name: true, area: true },
      })
    : [];
  const customerById = new Map(orderCustomers.map((c) => [c.id, c]));

  const events: DayEvent[] = [];
  const areaCounts = new Map<string, number>();
  const visited = new Set<string>();

  const push = (
    at: Date,
    action: DayEvent["action"],
    refId: string | null,
    customerId: string | null,
    customerName: string | null,
    area: string | null,
    amount: number | null,
    detail: string | null,
  ) => {
    const stamp = refId ? stampByRef.get(refId) : undefined;
    events.push({
      at,
      action,
      customerId,
      customerName,
      amount,
      detail,
      latitude: stamp?.latitude == null ? null : toNumber(stamp.latitude),
      longitude: stamp?.longitude == null ? null : toNumber(stamp.longitude),
      accuracyM: stamp?.accuracyM ?? null,
      distanceM: stamp?.distanceM ?? null,
      locationStatus: stamp?.status ?? null,
      sendLagMin: stamp ? minutesBetween(stamp.capturedAt, stamp.createdAt) : null,
    });
    if (customerId) visited.add(customerId);
    const key = area?.trim() || "بدون منطقة";
    areaCounts.set(key, (areaCounts.get(key) ?? 0) + 1);
  };

  let sold = 0;
  let rejectedValue = 0;
  let rejectedOrders = 0;
  for (const o of orders) {
    const d = (o.requestData ?? {}) as { customerId?: string; subtotal?: number };
    const customer = d.customerId ? customerById.get(d.customerId) : undefined;
    const subtotal = Number(d.subtotal ?? 0);
    const refused = o.status === "REJECTED";
    if (refused) {
      rejectedOrders += 1;
      rejectedValue += subtotal;
    } else {
      sold += subtotal;
    }
    push(
      o.createdAt,
      "ORDER",
      o.id,
      d.customerId ?? null,
      customer?.name ?? null,
      customer?.area ?? null,
      subtotal,
      refused ? "مرفوض" : o.status === "APPROVED" ? "موافق عليه" : "بانتظار الموافقة",
    );
  }

  let collected = 0;
  for (const r of receipts) {
    // A cancelled receipt still happened — the rep did stand in that shop — but
    // its money is not theirs to be credited with. Counted as an action,
    // excluded from the total.
    if (!r.cancelledAt) collected += toNumber(r.amount);
    push(
      r.date,
      "RECEIPT",
      r.id,
      r.customerId,
      r.customer?.name ?? null,
      r.customer?.area ?? null,
      toNumber(r.amount),
      r.cancelledAt ? "ملغي" : null,
    );
  }

  for (const v of visits) {
    push(
      v.startedAt,
      "VISIT",
      v.id,
      v.customerId,
      v.customer?.name ?? null,
      v.customer?.area ?? null,
      null,
      v.outcome ?? (v.endedAt ? null : "مفتوحة"),
    );
  }

  for (const i of issues) {
    push(i.createdAt, "ISSUE", i.id, i.customerId, i.customer?.name ?? null, i.customer?.area ?? null, null, null);
  }

  for (const c of newCustomers) {
    push(c.createdAt, "NEW_CUSTOMER", c.id, c.id, c.name, c.area, null, null);
  }

  events.sort((a, b) => a.at.getTime() - b.at.getTime());

  const startedAt = events.length > 0 ? events[0].at : null;
  const endedAt = events.length > 0 ? events[events.length - 1].at : null;

  const gaps: AgentDay["gaps"] = [];
  for (let i = 1; i < events.length; i += 1) {
    const minutes = minutesBetween(events[i - 1].at, events[i].at);
    if (minutes >= GAP_MIN) {
      gaps.push({ fromAt: events[i - 1].at, toAt: events[i].at, minutes });
    }
  }

  const location = { withFix: 0, denied: 0, unavailable: 0, far: 0, vague: 0 };
  for (const e of events) {
    if (e.locationStatus == null) continue;
    if (e.locationStatus === "DENIED") location.denied += 1;
    else if (e.locationStatus === "OK") {
      location.withFix += 1;
      if (e.accuracyM != null && e.accuracyM > VAGUE_METRES) location.vague += 1;
      else if (e.distanceM != null && e.distanceM > FAR_METRES) location.far += 1;
    } else location.unavailable += 1;
  }

  return {
    date: day,
    agentId,
    agentName: agent?.name ?? "المندوب",
    events,
    startedAt,
    endedAt,
    spanMin: startedAt && endedAt ? minutesBetween(startedAt, endedAt) : 0,
    gaps,
    idleMin: gaps.reduce((sum, g) => sum + g.minutes, 0),
    counts: {
      orders: orders.length - rejectedOrders,
      rejectedOrders,
      receipts: receipts.length,
      visits: visits.length,
      issues: issues.length,
      newCustomers: newCustomers.length,
      customersVisited: visited.size,
    },
    money: { sold, collected, rejectedValue },
    location,
    areas: [...areaCounts.entries()]
      .map(([area, actions]) => ({ area, actions }))
      .sort((a, b) => b.actions - a.actions),
  };
}

export type AgentSummary = {
  agentId: string;
  agentName: string;
  daysWorked: number;
  orders: number;
  rejectedOrders: number;
  receipts: number;
  visits: number;
  issues: number;
  newCustomers: number;
  sold: number;
  collected: number;
  /** Actions filed with a precise fix more than FAR_METRES from the shop. */
  farActions: number;
  deniedLocations: number;
};

/**
 * Every rep side by side over a window.
 *
 * `daysWorked` counts DISTINCT days on which the rep filed anything, not days
 * in the range: a rep off sick for a week should not read as one who worked
 * every day and sold nothing.
 */
export async function getAgentsOverview(fromKey: string, toKey: string): Promise<AgentSummary[]> {
  const start = shopDayStart(fromKey);
  const end = shopDayEndExclusive(toKey);
  const window = { gte: start, lt: end };

  const agents = await prisma.user.findMany({
    // Same predicate the liability screen uses, so the two never disagree
    // about who counts as a rep.
    where: { isActive: true, permissions: { has: "SALES_AGENT" } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (agents.length === 0) return [];
  const ids = agents.map((a) => a.id);

  const [orders, receipts, visits, issues, customers, stamps] = await Promise.all([
    prisma.pendingApproval.findMany({
      where: { requestedBy: { in: ids }, requestType: approvalRequestTypes.CATALOG_ORDER, createdAt: window },
      select: { requestedBy: true, createdAt: true, status: true, requestData: true },
    }),
    prisma.paymentVoucher.findMany({
      where: { salesAgentId: { in: ids }, type: "RECEIPT", archivedAt: null, cancelledAt: null, date: window },
      select: { salesAgentId: true, date: true, amount: true },
    }),
    prisma.salesAgentVisit.findMany({
      where: { salesAgentId: { in: ids }, startedAt: window },
      select: { salesAgentId: true, startedAt: true },
    }),
    prisma.salesAgentIssue.findMany({
      where: { salesAgentId: { in: ids }, createdAt: window },
      select: { salesAgentId: true, createdAt: true },
    }),
    prisma.customer.findMany({
      where: { salesAgentId: { in: ids }, deletedAt: null, createdAt: window },
      select: { salesAgentId: true, createdAt: true },
    }),
    prisma.salesAgentStamp.findMany({
      where: { salesAgentId: { in: ids }, createdAt: window },
      select: { salesAgentId: true, status: true, accuracyM: true, distanceM: true },
    }),
  ]);

  const blank = (): Omit<AgentSummary, "agentId" | "agentName"> & { days: Set<string> } => ({
    daysWorked: 0,
    orders: 0,
    rejectedOrders: 0,
    receipts: 0,
    visits: 0,
    issues: 0,
    newCustomers: 0,
    sold: 0,
    collected: 0,
    farActions: 0,
    deniedLocations: 0,
    days: new Set<string>(),
  });
  const acc = new Map(agents.map((a) => [a.id, blank()]));

  const mark = (id: string | null, at: Date) => {
    if (!id) return null;
    const row = acc.get(id);
    if (!row) return null;
    row.days.add(shopDateKey(at));
    return row;
  };

  for (const o of orders) {
    const row = mark(o.requestedBy, o.createdAt);
    if (!row) continue;
    const subtotal = Number(((o.requestData ?? {}) as { subtotal?: number }).subtotal ?? 0);
    if (o.status === "REJECTED") row.rejectedOrders += 1;
    else {
      row.orders += 1;
      row.sold += subtotal;
    }
  }
  for (const r of receipts) {
    const row = mark(r.salesAgentId, r.date);
    if (!row) continue;
    row.receipts += 1;
    row.collected += toNumber(r.amount);
  }
  for (const v of visits) {
    const row = mark(v.salesAgentId, v.startedAt);
    if (row) row.visits += 1;
  }
  for (const i of issues) {
    const row = mark(i.salesAgentId, i.createdAt);
    if (row) row.issues += 1;
  }
  for (const c of customers) {
    const row = mark(c.salesAgentId, c.createdAt);
    if (row) row.newCustomers += 1;
  }
  for (const s of stamps) {
    const row = acc.get(s.salesAgentId);
    if (!row) continue;
    if (s.status === "DENIED") row.deniedLocations += 1;
    // A vague fix is never counted as far: see VAGUE_METRES.
    else if (
      s.status === "OK" &&
      s.distanceM != null &&
      s.distanceM > FAR_METRES &&
      (s.accuracyM == null || s.accuracyM <= VAGUE_METRES)
    ) {
      row.farActions += 1;
    }
  }

  return agents.map((a) => {
    const row = acc.get(a.id)!;
    const { days, ...rest } = row;
    return { agentId: a.id, agentName: a.name, ...rest, daysWorked: days.size };
  });
}

/**
 * Which neighbourhoods are actually producing, and which are dead.
 *
 * Grouped by the customer's area, which is the only place that link exists —
 * an order does not carry a neighbourhood of its own, and inventing one from
 * the rep's position would attribute a sale to wherever they happened to have
 * signal.
 */
export async function getAreaPerformance(
  fromKey: string,
  toKey: string,
): Promise<Array<{ area: string; customers: number; orders: number; sold: number; collected: number }>> {
  const start = shopDayStart(fromKey);
  const end = shopDayEndExclusive(toKey);
  const window = { gte: start, lt: end };

  const [customers, orders, receipts] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null, NOT: { salesAgentId: null } },
      select: { id: true, area: true },
    }),
    prisma.pendingApproval.findMany({
      where: { requestType: approvalRequestTypes.CATALOG_ORDER, createdAt: window, NOT: { status: "REJECTED" } },
      select: { requestData: true },
    }),
    prisma.paymentVoucher.findMany({
      where: { type: "RECEIPT", archivedAt: null, cancelledAt: null, date: window, NOT: { salesAgentId: null } },
      select: { customerId: true, amount: true },
    }),
  ]);

  const areaOf = new Map(customers.map((c) => [c.id, c.area?.trim() || "بدون منطقة"]));
  const rows = new Map<string, { area: string; customers: number; orders: number; sold: number; collected: number }>();
  const row = (area: string) => {
    let found = rows.get(area);
    if (!found) {
      found = { area, customers: 0, orders: 0, sold: 0, collected: 0 };
      rows.set(area, found);
    }
    return found;
  };

  for (const c of customers) row(areaOf.get(c.id)!).customers += 1;

  for (const o of orders) {
    const d = (o.requestData ?? {}) as { customerId?: string; subtotal?: number };
    // An order whose customer is not one of a rep's is a storefront order, not
    // this report's subject.
    if (!d.customerId || !areaOf.has(d.customerId)) continue;
    const r = row(areaOf.get(d.customerId)!);
    r.orders += 1;
    r.sold += Number(d.subtotal ?? 0);
  }

  for (const v of receipts) {
    if (!v.customerId || !areaOf.has(v.customerId)) continue;
    row(areaOf.get(v.customerId)!).collected += toNumber(v.amount);
  }

  return [...rows.values()].sort((a, b) => b.sold - a.sold || b.customers - a.customers);
}
