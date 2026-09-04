/**
 * «المندوب» — owner-only endpoints: cash handovers and the commission screen.
 *
 * Everything here is behind `adminOnly`. The commission figure in particular is
 * something the rep must never see, so it is served from a router the rep cannot
 * reach at all rather than from a shared route that filters by role.
 */
import { asyncHandler } from "../utils/async-handler";
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
