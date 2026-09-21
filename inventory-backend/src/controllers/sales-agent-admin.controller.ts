/**
 * «المندوب» — owner-only endpoints: cash handovers and the commission screen.
 *
 * Everything here is behind `adminOnly`. The commission figure in particular is
 * something the rep must never see, so it is served from a router the rep cannot
 * reach at all rather than from a shared route that filters by role.
 */
import { getAgentDay, getAgentsOverview, getAreaPerformance } from "../services/sales-agent-day.service";
import { shopDateKey, shopDayEndExclusive, shopDayStart } from "../utils/shop-day";
import {
  agentActivityCounts,
  listAgentActivity,
  markAgentActivityRead,
  type ActivityFilter,
} from "../services/sales-agent-activity.service";
import { listRepEditModes, setRepEditModes } from "../services/sales-agent-documents.service";
import { asyncHandler } from "../utils/async-handler";
import {
  addToVisitPlan,
  listCustomersOfAgent,
  listVisitPlan,
  setCustomerLocation,
  updateVisitPlanEntry,
} from "../services/sales-agent-visits.service";
import { AppError } from "../utils/app-error";
import {
  getCommission,
  getIssueReports,
  getLiabilityHealth,
  listAgentLiability,
  listHandovers,
  listIssues,
  listSettlements,
  recordHandover,
  reopenMonth,
  settleMonth,
} from "../services/sales-agent-admin.service";

export const getLiability = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listAgentLiability() });
});

export const postHandover = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  const body = (req.body ?? {}) as {
    agentId?: string; amount?: number; notes?: string; date?: string; clientRequestId?: string;
  };
  if (!body.agentId) throw new AppError("المندوب مطلوب", 400, "AGENT_REQUIRED");

  const result = await recordHandover(
    {
      agentId: String(body.agentId),
      amount: Number(body.amount),
      notes: body.notes,
      date: body.date,
      clientRequestId: body.clientRequestId,
    },
    req.user.id,
  );

  res.status(201).json({ success: true, message: "تم تسجيل الاستلام", data: result });
});

export const getHandovers = asyncHandler(async (req, res) => {
  const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
  res.json({ success: true, data: await listHandovers(agentId) });
});

export const getCommissionCtrl = asyncHandler(async (req, res) => {
  const agentId = String(req.query.agentId ?? "");
  const month = String(req.query.month ?? "");
  if (!agentId) throw new AppError("المندوب مطلوب", 400, "AGENT_REQUIRED");

  // The rate is optional: the screen opens showing the two totals with no rate
  // typed yet, and recomputes once the owner enters one.
  const raw = req.query.ratePercent;
  const ratePercent = raw === undefined || raw === "" ? undefined : Number(raw);
  if (ratePercent !== undefined && (!Number.isFinite(ratePercent) || ratePercent < 0)) {
    throw new AppError("النسبة غير صحيحة", 400, "RATE_INVALID");
  }

  res.json({ success: true, data: await getCommission(agentId, month, ratePercent) });
});

/* ── «المشاكل المسجّلة» ──────────────────────────────────────────────── */

function dateWindow(req: { query: Record<string, unknown> }) {
  const str = (k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string) : undefined);
  return { from: str("from"), to: str("to"), agentId: str("agentId") };
}

export const getIssueReportsCtrl = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getIssueReports(dateWindow(req)) });
});

/* ── «تثبيت الشهر» ───────────────────────────────────────────────────── */

export const postSettlement = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  const body = (req.body ?? {}) as {
    agentId?: string; month?: string; basis?: string; ratePercent?: number; notes?: string;
  };
  if (!body.agentId) throw new AppError("المندوب مطلوب", 400, "AGENT_REQUIRED");
  if (!body.month) throw new AppError("الشهر مطلوب", 400, "MONTH_REQUIRED");
  if (!body.basis) throw new AppError("أساس المحاسبة مطلوب", 400, "BASIS_REQUIRED");

  const data = await settleMonth(
    {
      agentId: String(body.agentId),
      month: String(body.month),
      basis: String(body.basis),
      ratePercent: Number(body.ratePercent),
      notes: body.notes,
    },
    req.user.id,
  );
  res.status(201).json({ success: true, message: "تم تثبيت الشهر", data });
});

export const deleteSettlement = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  const agentId = String(req.query.agentId ?? "");
  const month = String(req.query.month ?? "");
  if (!agentId || !month) throw new AppError("المندوب والشهر مطلوبان", 400, "PARAMS_REQUIRED");
  res.json({ success: true, message: "انفتح الشهر", data: await reopenMonth(agentId, month, req.user.id) });
});

export const getSettlements = asyncHandler(async (req, res) => {
  const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
  res.json({ success: true, data: await listSettlements(agentId) });
});

/* ── «صحة الذمة» ─────────────────────────────────────────────────────── */

export const getHealth = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getLiabilityHealth() });
});

/** The raw refusal log, for when the aggregated reports are not enough. */
export const getIssuesCtrl = asyncHandler(async (req, res) => {
  const reason = typeof req.query.reason === "string" ? req.query.reason : undefined;
  res.json({ success: true, data: await listIssues({ ...dateWindow(req), reason }) });
});

/* ── «خطة زيارات المندوب» — the owner assigning the round ────────────── */

/** One rep's plan for a day. The owner names the rep explicitly. */
export const getAgentVisitPlan = asyncHandler(async (req, res) => {
  const salesAgentId = String(req.query.salesAgentId ?? "");
  if (!salesAgentId) throw new AppError("حدد المندوب", 400, "SALES_AGENT_REQUIRED");
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  res.json({ success: true, data: await listVisitPlan(salesAgentId, date) });
});

/**
 * Assign a customer to a rep's plan.
 *
 * `agentScope` is null here — the owner is not a rep — but the service still
 * refuses to plan a customer for a rep the customer does not belong to.
 */
export const postAgentVisitPlanEntry = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const customerId = String(body.customerId ?? "");
  if (!customerId) throw new AppError("الزبون مطلوب", 400, "CUSTOMER_REQUIRED");
  const created = await addToVisitPlan({ id: req.user.id }, null, {
    salesAgentId: body.salesAgentId == null ? undefined : String(body.salesAgentId),
    customerId,
    planDate: body.planDate == null ? undefined : String(body.planDate),
    note: body.note == null ? undefined : String(body.note),
    sortOrder: body.sortOrder == null ? undefined : Number(body.sortOrder),
  });
  res.status(201).json({ success: true, message: "انضاف لخطة المندوب", data: created });
});

export const patchAgentVisitPlanEntry = asyncHandler(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  res.json({
    success: true,
    data: await updateVisitPlanEntry(null, String(req.params.id), {
      status: body.status,
      note: body.note == null ? undefined : String(body.note),
      sortOrder: body.sortOrder == null ? undefined : Number(body.sortOrder),
    }),
  });
});

/**
 * Correct any customer's shop location.
 *
 * The rep can only pin their own customers, so a wrong pin on a customer who
 * changed rep — or a rep who is gone — would otherwise be stuck. Written to the
 * audit log with the previous and the new point, like the rep's own change.
 */
export const putAnyCustomerLocation = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  const body = (req.body ?? {}) as { latitude?: unknown; longitude?: unknown };
  res.json({
    success: true,
    data: await setCustomerLocation({ id: req.user.id }, null, String(req.params.id), {
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
    }),
  });
});

/**
 * The customers of ONE rep, for the owner's plan screen.
 *
 * The owner names the rep; the query is scoped to that rep's customers only, so
 * the screen physically cannot offer someone else's customer to plan.
 */
export const getAgentCustomers = asyncHandler(async (req, res) => {
  const salesAgentId = String(req.query.salesAgentId ?? "");
  if (!salesAgentId) throw new AppError("حدد المندوب", 400, "SALES_AGENT_REQUIRED");
  const limit = Number(req.query.limit);
  res.json({
    success: true,
    data: await listCustomersOfAgent({
      salesAgentId,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      area: typeof req.query.area === "string" && req.query.area.trim() ? req.query.area.trim() : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    }),
  });
});

/* ── «صفحة تحكم المندوب» ──────────────────────────────────────────────── */

/**
 * A default window for the comparison screens: the last 30 days, shop time.
 *
 * Validated rather than trusted — an unparsable `from` would otherwise become
 * an Invalid Date and every range query would silently return nothing, which
 * reads on screen exactly like a rep who did no work.
 */
function rangeFromQuery(query: Record<string, unknown>) {
  const key = (value: unknown) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  const to = key(query.to) ?? shopDateKey(new Date());
  const from = key(query.from) ?? shopDateKey(new Date(Date.now() - 29 * 86_400_000));
  // A reversed range is a typo, not a request for nothing.
  return from <= to ? { from, to } : { from: to, to: from };
}

/** One rep's day: what they filed, when, and where they were. */
export const getAgentDayCtrl = asyncHandler(async (req, res) => {
  const salesAgentId = String(req.query.salesAgentId ?? "");
  if (!salesAgentId) throw new AppError("حدد المندوب", 400, "SALES_AGENT_REQUIRED");
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  res.json({ success: true, data: await getAgentDay(salesAgentId, date) });
});

/** Every rep side by side over a window. */
export const getAgentsOverviewCtrl = asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query as Record<string, unknown>);
  res.json({ success: true, data: { from, to, agents: await getAgentsOverview(from, to) } });
});

/** Which neighbourhoods produce and which are dead. */
export const getAreaPerformanceCtrl = asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query as Record<string, unknown>);
  res.json({ success: true, data: { from, to, areas: await getAreaPerformance(from, to) } });
});

/* ── «إشعارات المندوبين» ──────────────────────────────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The owner's filters, validated: a garbage value is ignored, never an error. */
function activityFilter(query: Record<string, unknown>): ActivityFilter {
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const agentId = text(query.agentId);
  const day = (v: unknown) => {
    const s = text(v);
    return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
  };
  const from = day(query.from);
  const to = day(query.to);
  const limit = Number(query.limit);
  return {
    agentId: agentId && UUID_RE.test(agentId) ? agentId : undefined,
    kind: text(query.kind)?.toUpperCase().replace(/[^A-Z_]/g, "") || undefined,
    importantOnly: String(query.important) === "1",
    unreadOnly: String(query.unread) === "1",
    from: from ? shopDayStart(from) : undefined,
    to: to ? shopDayEndExclusive(to) : undefined,
    before: text(query.before) && UUID_RE.test(String(query.before)) ? String(query.before) : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  };
}

export const getAgentActivityCtrl = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listAgentActivity(activityFilter(req.query as Record<string, unknown>)) });
});

/** Just the two numbers, for a badge that must not fetch the whole feed. */
export const getAgentActivityCountsCtrl = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await agentActivityCounts() });
});

export const postAgentActivityReadCtrl = asyncHandler(async (req, res) => {
  const body = (req.body ?? {}) as { ids?: unknown; filter?: Record<string, unknown> };
  res.json({
    success: true,
    data: await markAgentActivityRead({
      ids: body.ids,
      filter: body.filter ? activityFilter(body.filter) : undefined,
    }),
  });
});

/* ── rep settings: what they may change without asking ──────────────── */

export const getRepEditModesCtrl = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listRepEditModes() });
});

export const putRepEditModesCtrl = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await setRepEditModes(String(req.params.id), req.body ?? {}) });
});
