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
  listAgentLiability,
  listHandovers,
  recordHandover,
} from "../services/sales-agent-admin.service";

export const getLiability = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listAgentLiability() });
});

export const postHandover = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  const body = (req.body ?? {}) as { agentId?: string; amount?: number; notes?: string; date?: string };
  if (!body.agentId) throw new AppError("المندوب مطلوب", 400, "AGENT_REQUIRED");

  const result = await recordHandover(
    {
      agentId: String(body.agentId),
      amount: Number(body.amount),
      notes: body.notes,
      date: body.date,
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
